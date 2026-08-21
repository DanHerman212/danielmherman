/**
 * Custom A2UI components for the readmission-risk canvas (Q3 spike).
 *
 * Beyond the basic catalog we add three components that reproduce the custom
 * demo's widgets exactly (card, widget title, band pill, SHAP bars, cited
 * source with expand/collapse):
 *   - RiskBar     — RISK widget: big number + band pill + bar + threshold
 *   - FactorBars  — DRIVERS widget: horizontal SHAP bars
 *   - SourceCard  — SOURCE widget: cited passage + truncate/expand
 *
 * Authoring follows the official A2UI v0.9 recipe (upstream renderers/lit
 * README): define a ComponentApi (name + zod schema), implement a Lit element
 * that extends A2uiLitElement with createController()/render(), and export
 * { ...api, tagName }.
 *
 * The vendored bundles do NOT export the Catalog class, so instead of
 * `new Catalog(...)` we build a plain catalog object of the exact shape the
 * MessageProcessor/renderer consume (`id`, `components: Map`, `functions`):
 * a copy of the basic catalog's maps plus our custom components. One surface
 * can then use basic AND custom components together.
 *
 * The styles below are copied from demo_splitpane.css so the agent-composed
 * surface renders with the same design language as the hand-built demo.
 */

import { html, css, unsafeCSS, nothing } from './lit_3.2.1.js';
import { A2uiController, A2uiLitElement } from './a2ui_lit_0.10.2_v0_9_external_lit_zod.js';
import z from './zod_3.25.76.js';

const RISK_COLORS = { low: '#2e9e5b', borderline: '#e0a11b', high: '#d64545' };

/* Shared widget chrome (matches .widget in demo_splitpane.css). */
const WIDGET = `
  :host { display: block; }
  .widget { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; }
  .widget-title {
    font-size: 0.78rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.04em; color: #6b7280; margin-bottom: 10px;
  }
  .widget-fallback { font-size: 0.8rem; color: #6b7280; margin: 8px 0 0; }
`;

/* ---------------- RiskBar ---------------- */

const RiskBarApi = {
  name: 'RiskBar',
  schema: z.object({
    probability: z.number(),
    threshold: z.number(),
    band: z.string(),
  }).strict(),
};

class RiskBarElement extends A2uiLitElement {
  static styles = css`
    ${unsafeCSS(WIDGET)}
    .risk-row { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
    .risk-number { font-size: 2.4rem; font-weight: 700; line-height: 1; }
    .risk-decision { font-size: 0.75rem; font-weight: 600; padding: 3px 8px; border-radius: 999px; }
    .risk-decision.low { color: #2e9e5b; background: #e7f6ec; }
    .risk-decision.borderline { color: #8a5a00; background: #fdf0cf; }
    .risk-decision.high { color: #8c1d1d; background: #fde3e3; }
    .risk-bar { position: relative; height: 14px; border-radius: 999px; background: #eceef1; overflow: visible; }
    .risk-fill { position: absolute; top: 0; left: 0; bottom: 0; border-radius: 999px; }
    .risk-threshold { position: absolute; top: -4px; bottom: -4px; width: 2px; background: #111; border-radius: 2px; opacity: 0.7; }
    .risk-scale { display: flex; justify-content: space-between; font-size: 0.68rem; color: #6b7280; margin-top: 4px; }
  `;

  createController() {
    return new A2uiController(this, RiskBarApi);
  }

  render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const p = Number(props.probability);
    const t = Number(props.threshold);
    const band = props.band;
    const color = RISK_COLORS[band] || '#6b7280';
    const decision = `${p >= t ? 'above' : 'below'} threshold · ${band}`;
    return html`
      <div class="widget">
        <div class="widget-title">30-day unplanned readmission risk</div>
        <div class="risk-row">
          <div class="risk-number" style="color:${color}">${(p * 100).toFixed(1)}%</div>
          <div class="risk-decision ${band}">${decision}</div>
        </div>
        <div class="risk-bar">
          <div class="risk-fill" style="width:${Math.min(100, p * 100).toFixed(1)}%; background:${color}"></div>
          <div class="risk-threshold" style="left:${Math.min(100, t * 100).toFixed(1)}%" title="operating threshold ${t}"></div>
        </div>
        <div class="risk-scale"><span>0%</span><span>threshold ${t}</span><span>40%</span></div>
      </div>
    `;
  }
}

export const RiskBar = { ...RiskBarApi, tagName: 'a2ui-risk-bar' };
customElements.define('a2ui-risk-bar', RiskBarElement);

/* ---------------- FactorBars ---------------- */

const FactorBarsApi = {
  name: 'FactorBars',
  schema: z.object({
    factors: z.array(z.object({
      feature: z.string(),
      contribution: z.number(),
      direction: z.string(),
    })),
  }).strict(),
};

class FactorBarsElement extends A2uiLitElement {
  static styles = css`
    ${unsafeCSS(WIDGET)}
    .driver-row { display: grid; grid-template-columns: 150px 1fr 52px; align-items: center; gap: 8px; margin: 6px 0; font-size: 0.8rem; }
    .driver-name { text-align: right; color: #111827; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .driver-track { height: 10px; background: #eceef1; border-radius: 999px; }
    /* The fill is a <span> (inline by default) — without display:block its
       height:100% is ignored and the colored bar collapses to 0 height. */
    .driver-bar { display: block; height: 100%; border-radius: 999px; }
    .up { background: #d64545; }
    .down { background: #2e9e5b; }
    .driver-val { font-variant-numeric: tabular-nums; color: #6b7280; }
  `;

  createController() {
    return new A2uiController(this, FactorBarsApi);
  }

  render() {
    const props = this.controller?.props;
    const factors = props?.factors;
    if (!Array.isArray(factors) || factors.length === 0) {
      return html`
        <div class="widget">
          <div class="widget-title">What drives this estimate?</div>
          <p class="widget-fallback">No feature attributions returned.</p>
        </div>`;
    }
    const max = Math.max(...factors.map((f) => Math.abs(Number(f.contribution) || 0)));
    return html`
      <div class="widget">
        <div class="widget-title">What drives this estimate?</div>
        ${factors.map((f) => {
          const v = Number(f.contribution) || 0;
          const w = max > 0 ? (Math.abs(v) / max) * 100 : 0;
          return html`
            <div class="driver-row">
              <span class="driver-name">${f.feature}</span>
              <span class="driver-track">
                <span class="driver-bar ${f.direction === 'increases' ? 'up' : 'down'}" style="width:${w.toFixed(1)}%"></span>
              </span>
              <span class="driver-val">${v >= 0 ? '+' : ''}${v.toFixed(4)}</span>
            </div>`;
        })}
      </div>`;
  }
}

export const FactorBars = { ...FactorBarsApi, tagName: 'a2ui-factor-bars' };
customElements.define('a2ui-factor-bars', FactorBarsElement);

/* ---------------- SourceCard ---------------- */

const SourceCardApi = {
  name: 'SourceCard',
  schema: z.object({
    cite: z.number().int().positive().default(1),
    section: z.string(),
    text: z.string(),
    query: z.string().optional().default('discharge note'),
  }).strict(),
};

class SourceCardElement extends A2uiLitElement {
  static properties = { _expanded: { state: true } };

  static styles = css`
    ${unsafeCSS(WIDGET)}
    /* Pin the cited discharge notes to the bottom of the canvas so they stay
       in view however long the session gets. :host is inside the shadow DOM,
       so a light-DOM selector cannot reach it — the sticky lives here. */
    :host {
      display: block; position: sticky; bottom: 0; z-index: 2;
      background: #ffffff;
      box-shadow: 0 -1px 0 #e5e7eb;
    }
    .source-passage { border: 1px solid #2563eb; background: #f4f7ff; box-shadow: 0 0 0 1px #2563eb; border-radius: 8px; padding: 10px; }
    .source-head { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
    .source-cite { font-weight: 700; color: #2563eb; }
    .source-section { font-size: 0.76rem; font-weight: 600; text-transform: capitalize; }
    .source-text { font-size: 0.8rem; color: #374151; line-height: 1.5; white-space: pre-wrap; }
    .source-expand { font: inherit; font-size: 0.72rem; color: #2563eb; background: none; border: none; cursor: pointer; padding: 0; margin-top: 6px; text-decoration: underline; }
  `;

  createController() {
    return new A2uiController(this, SourceCardApi);
  }

  constructor() {
    super();
    this._expanded = false;
  }

  _toggle() {
    this._expanded = !this._expanded;
  }

  render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const full = String(props.text || '').trim();
    const preview = full.slice(0, 260).trim();
    const hasMore = full.length > preview.length;
    const body = this._expanded ? full : preview;
    return html`
      <div class="widget widget-source">
        <div class="widget-title">Source · ${String(props.section || props.query || 'discharge note').replace(/_/g, ' ')}</div>
        <div class="source-passage">
          <div class="source-head">
            <span class="source-cite">[${props.cite}]</span>
            <span class="source-section">${String(props.section || '').replace(/_/g, ' ')}</span>
          </div>
          <div class="source-text">${body}</div>
          ${hasMore
            ? html`<button type="button" class="source-expand" @click=${this._toggle}>
                ${this._expanded ? 'Collapse' : 'Show full section'}
              </button>`
            : nothing}
        </div>
      </div>`;
  }
}

export const SourceCard = { ...SourceCardApi, tagName: 'a2ui-source-card' };
customElements.define('a2ui-source-card', SourceCardElement);

/* ---------------- TraceCard (Screen 3) ---------------- */

const TraceCardApi = {
  name: 'TraceCard',
  schema: z.object({
    toolCalls: z.array(z.object({
      name: z.string(),
      args: z.unknown().optional().default({}),
      response: z.unknown().optional().default({}),
    })).default([]),
    fixtureNote: z.string().optional().default(''),
  }).strict(),
};

const R1_NOTE =
  'R1: cross-patient isolation is enforced server-side — rag_search restricts ' +
  'to the selected patient\u2019s hadm_id before retrieval, never as a post-filter.';

class TraceCardElement extends A2uiLitElement {
  static styles = css`
    ${unsafeCSS(WIDGET)}
    .trace-call { border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 8px; overflow: hidden; }
    .trace-head { font-size: 0.76rem; font-weight: 600; padding: 7px 10px; background: #f3f4f6; border-bottom: 1px solid #e5e7eb; }
    .trace-body { font-size: 0.72rem; margin: 0; padding: 8px 10px; overflow-x: auto; white-space: pre-wrap; font-family: 'SF Mono', ui-monospace, monospace; }
    .trace-r1 { font-family: 'Inter', sans-serif; }
  `;

  createController() {
    return new A2uiController(this, TraceCardApi);
  }

  render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const calls = props.toolCalls || [];
    const argsText = (a) => {
      try { return JSON.stringify(a); } catch { return String(a); }
    };
    const bodyText = (r) => {
      try { return JSON.stringify(r, null, 2).slice(0, 1200); } catch { return String(r); }
    };
    return html`
      <div class="widget widget-trace">
        <div class="widget-title">Trace — tool calls &amp; provenance</div>
        ${props.fixtureNote ? html`<p class="widget-fallback">${props.fixtureNote}</p>` : nothing}
        ${calls.length === 0
          ? html`<p class="widget-fallback">No tool calls yet.</p>`
          : calls.map((tc) => html`
            <div class="trace-call">
              <div class="trace-head">${tc.name}(${argsText(tc.args)})</div>
              <pre class="trace-body">${bodyText(tc.response)}</pre>
            </div>`)}
        <p class="widget-fallback trace-r1">${R1_NOTE}</p>
      </div>
    `;
  }
}

export const TraceCard = { ...TraceCardApi, tagName: 'a2ui-trace-card' };
customElements.define('a2ui-trace-card', TraceCardElement);

/* ---------------- Combined catalog ---------------- */

const CATALOG_ID = 'https://example.com/catalogs/readmission-risk-v1.json';

/**
 * Build a catalog object = basic catalog + our custom components.
 * Takes the basicCatalog instance so the maps can be shared (one surface can
 * use basic AND custom component types).
 */
export function buildRiskCatalog(basicCatalog) {
  return {
    id: CATALOG_ID,
    components: new Map([
      ...basicCatalog.components,
      ['RiskBar', RiskBar],
      ['FactorBars', FactorBars],
      ['SourceCard', SourceCard],
      ['TraceCard', TraceCard],
    ]),
    functions: basicCatalog.functions,
  };
}
