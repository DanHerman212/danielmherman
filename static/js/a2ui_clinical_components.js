/**
 * Phase 2 clinical components — clean sheet.
 *
 * This file is the whole visual layer, and it is deliberately thin. Three rules,
 * each of them so the anonymous (fixture-driven) demo can lift these components
 * and their JSON fixtures without also lifting a page, a route or an agent:
 *
 *   1. A component takes props and renders them. No fixture import, no fetch, no
 *      literal clinical value, no knowledge of what produced the props.
 *   2. A fixture is an A2UI envelope — `createSurface` + `updateComponents` —
 *      ready for the renderer. Nothing here translates a domain payload into a
 *      surface, so a replay needs no logic beyond `mountSurfaces`.
 *   3. `mountSurfaces` is the only function that joins the two, and it is the
 *      only thing a page has to know.
 *
 * Colour: the basic catalog has no `danger`/`success` variant to select — its
 * vocabulary is typographic — so the threshold state is carried by a label, a
 * weight, and a hue this file owns. `BAND_HUE` is the only colour in the file and
 * it holds placeholders, so the polish pass replaces a palette, not a layout.
 */

import { html, css, nothing, LitElement } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { A2uiController, A2uiLitElement, basicCatalog, Context } from '@a2ui/lit/v0_9';
import { ContextConsumer, ContextProvider } from '@lit/context';
import { renderMarkdown } from '@a2ui/markdown-it';
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import z from 'zod';

/**
 * The catalog id the surfaces declare. Reused from the Phase 1 envelope rather
 * than invented, so a fixture stays a valid *production* shape: the day the
 * agent emits these component names, the same id resolves them.
 */
export const CATALOG_ID = 'https://example.com/catalogs/readmission-risk-v1.json';

/**
 * Both numbers on one scale and at one precision.
 *
 * The score was rendered as a whole percentage while the threshold was rendered
 * as a two-decimal logit, so a reader comparing them was doing arithmetic across
 * two formats — and at the boundary the two could print identically while the
 * band said otherwise. One decimal place is the narrowest that keeps a straddle
 * visible: at whole percentages two numbers a tenth of a point apart still read
 * the same.
 */
const percent = (value) => `${(Number(value) * 100).toFixed(1)}%`;

/**
 * The threshold state's palette. The hue writes the score and the badge's text, the
 * wash fills the badge. Both are deliberately desaturated: the emphasis this widget
 * earns is "look closer", not "alarm". Replace these two pairs in the polish pass and
 * nothing else in the file changes.
 */
const BAND_HUE = {
  above: { hue: '#b0492f', wash: 'rgba(194, 98, 77, 0.12)' },
  below: { hue: '#276a58', wash: 'rgba(47, 125, 106, 0.12)' },
};

/** A stacked group's heading, and the row that carries one factor. */
const INFLUENCER_STYLES = css`
  :host { display: block; }
  /* The widget IS the card. It used to be a bordered box inside the envelope's own
     outer box, which put two edges and two fills around one widget. The envelope's
     wrapper is gone (see compose_risk_canvas), so this is now the single surface
     resting on the canvas. */
  .widget {
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 16px;
  }
  /* Three slots on one baseline: score, badge, threshold. The score sets the row's
     height and the badge sits on its baseline rather than centred against it, which
     is what keeps a pill and a 30px number looking like one line of type. */
  .headline {
    display: flex;
    align-items: baseline;
    gap: 10px;
    white-space: nowrap;
  }
  .score { font-size: 1.9rem; font-weight: 700; line-height: 1; color: var(--band-hue); }
  .band {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--band-hue);
    background: var(--band-wash);
    border-radius: 9999px;
    padding: 4px 8px;
  }
  .threshold { margin-left: auto; font-size: 0.75rem; opacity: 0.7; }
  .group { margin-top: 18px; }
  .group-title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
                 letter-spacing: 0.04em; margin-bottom: 10px; opacity: 0.75; }
  /* 16px between factors, 6px between a label and its bar. The label used to sit
     directly on the bar and the rows touched each other, so the list read as a
     block of ink instead of a set of separate readings. */
  .factor { margin-bottom: 16px; }
  .factor:last-child { margin-bottom: 0; }
  .factor-label { font-size: 0.85rem; margin-bottom: 6px; }
  .bar-track { height: 8px; border-radius: 999px; background: rgba(100, 116, 139, 0.14); }
  /* Slate, not ink. A near-black fill at this width is the heaviest mark on the
     screen and pulls the eye off the score it is meant to explain. Still neutral:
     the bar carries magnitude only, so it must not borrow the band's colour and
     imply it is asserting direction or threshold state (see the UX rulings). */
  .bar-fill { height: 8px; border-radius: 999px; background: #64748b; }
  .mismatch { font-size: 0.75rem; font-style: italic; margin-top: 10px; opacity: 0.8; }
  /* An empty group is a state, not a fault. Italic and muted so it recedes instead
     of reading as a factor whose value failed to arrive. */
  .empty { font-size: 0.85rem; font-style: italic; color: #94a3b8; }
`;

/** Props: the risk estimate and its drivers, as the surface declares them. */
const RiskInfluencersApi = {
  name: 'RiskInfluencers',
  schema: z.object({
    probability: z.number(),
    threshold: z.number(),
    decision: z.number(),
    factors: z.array(z.object({
      label: z.string(),
      contribution: z.number(),
      // Optional, and only ever cross-checked: the signed contribution decides
      // which group a factor sits in, because the number is what the model was
      // scored on. A disagreement is reported rather than rendered away.
      direction: z.string().optional(),
    })),
  }).strict(),
};

class RiskInfluencersElement extends A2uiLitElement {
  static styles = INFLUENCER_STYLES;

  createController() {
    return new A2uiController(this, RiskInfluencersApi);
  }

  render() {
    const props = this.controller?.props;
    if (!props) return nothing;

    const probability = Number(props.probability);
    const threshold = Number(props.threshold);
    // The boundary rule is `>= threshold` is above, so the decision the model
    // already made and the comparison here cannot disagree. The threshold is read
    // from the payload, never pinned: a retrained model carrying a new threshold
    // must move this label with it.
    const above = Number(props.decision) === 1 || probability >= threshold;
    const label = above ? 'Above threshold' : 'Below threshold';

    const factors = (props.factors || []).map((factor) => ({
      label: factor.label,
      contribution: Number(factor.contribution),
      mismatch: factor.direction !== undefined
        && (factor.direction === 'increases') !== (Number(factor.contribution) > 0),
    }));
    const raising = factors.filter((f) => f.contribution > 0);
    const lowering = factors.filter((f) => f.contribution < 0);
    // One scale for both groups, so a bar's length means the same thing either
    // side of the heading. Within-group scaling would make the smallest driver of
    // one group look like the largest of the other.
    const widest = Math.max(...factors.map((f) => Math.abs(f.contribution)), 0);

    const group = (title, rows) => html`
      <div class="group">
        <div class="group-title">${title}</div>
        ${rows.length === 0
          ? html`<div class="empty">None.</div>`
          : rows.map((row) => html`
              <div class="factor">
                <div class="factor-label">${row.label}</div>
                <div class="bar-track">
                  <div class="bar-fill"
                       style="width:${widest ? (Math.abs(row.contribution) / widest) * 100 : 0}%"></div>
                </div>
              </div>
            `)}
      </div>
    `;

    const band = BAND_HUE[above ? 'above' : 'below'];

    return html`
      <div class="widget" style="--band-hue:${band.hue};--band-wash:${band.wash}">
        <div class="headline">
          <span class="score">${percent(probability)}</span>
          <span class="band">${label}</span>
          <span class="threshold">threshold ${percent(threshold)}</span>
        </div>
        ${group('Increasing risk', raising)}
        ${group('Decreasing risk', lowering)}
        ${factors.some((f) => f.mismatch)
          ? html`<div class="mismatch">
              A factor's direction disagrees with its contribution; the group shown
              is the one the contribution implies.
            </div>`
          : nothing}
      </div>
    `;
  }
}

export const RiskInfluencers = {
  ...RiskInfluencersApi, tagName: 'a2ui-risk-influencers',
};
customElements.define('a2ui-risk-influencers', RiskInfluencersElement);

// ---------------------------------------------------------------------------
// Citations
//
// Glance, then verify: the prose carries superscript markers, a marker is a
// control, and the control opens the evidence behind that sentence. Two rules
// hold the safety line. Markers are inert until the answer is complete, because
// a control that goes live while the text around it is still arriving invites a
// reader to open a citation for a sentence that is not finished being written.
// And a marker with no citation behind it is drawn disabled rather than dropped,
// because a model can emit a marker the retrieval did not support, and a bare
// number reads as evidence the reader simply has not opened yet.

// `^[2]` is the instructed form; `^[PMID: 35186616]` is the form the model reaches for
// anyway, because on a literature turn the marker it displays IS the identifier. Both are
// recognised: a marker this cannot read is drawn as literal text, which is what a reader
// saw in production instead of a citation (2026-10-13). The agent strips a marker naming
// a record the turn does not have — in either form — so nothing here points at nothing.
const MARKER = /\^\[\s*(?:PMID\s*[:#]?\s*)?(\d+)\s*\]/gi;

/**
 * The record a PMID addresses. One builder, so a marker and the card beneath it
 * cannot point at two different places for the same identifier.
 */
const pubmedUrl = (pmid) => `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;

const NARRATIVE_STYLES = css`
  :host { display: block; }
  .narrative { font-size: 0.95rem; line-height: 1.55; }
  .prose > :first-child { margin-top: 0; }
  .prose > :last-child { margin-bottom: 0; }
  .cite {
    font: inherit;
    font-size: 0.72em;
    line-height: 1;
    vertical-align: super;
    margin-left: 1px;
    padding: 1px 5px;
    border: 1px solid rgba(17, 24, 39, 0.4);
    border-radius: 999px;
    background: #ffffff;
    color: #1f2937;
    cursor: pointer;
  }
  .cite:hover { background: #eef1f5; }
  .cite:focus-visible { outline: 2px solid #1f2937; outline-offset: 1px; }
  .cite[aria-expanded='true'] { background: #1f2937; color: #ffffff; border-color: #1f2937; }
  /* A literature marker is an identifier rather than a control that opens a panel,
     so it keeps the badge's shape and loses the underline. */
  .cite-pmid { text-decoration: none; }
  .cite.inert { border-style: dashed; opacity: 0.6; cursor: default; }
  .cite.missing { border-style: dotted; opacity: 0.6; cursor: not-allowed; }
  .streaming-note { font-size: 0.75rem; opacity: 0.7; font-style: italic; margin-top: 8px; }
`;

const POPOVER_STYLES = css`
  :host {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 60;
    display: block;
    width: min(340px, calc(100vw - 24px));
  }
  /* :host sets display, which would otherwise beat the user agent's [hidden]
     rule and leave a closed popover sitting on the page. */
  :host([hidden]) { display: none; }
  .popover {
    background: #ffffff;
    color: #111827;
    border: 1px solid rgba(17, 24, 39, 0.18);
    border-radius: 10px;
    box-shadow: 0 14px 34px rgba(17, 24, 39, 0.18);
    padding: 12px 14px;
    font-size: 0.85rem;
    line-height: 1.45;
  }
  .popover:focus { outline: none; }
  .head { display: flex; align-items: center; gap: 8px; }
  .badge {
    flex: none;
    width: 18px;
    height: 18px;
    border-radius: 999px;
    background: #1f2937;
    color: #ffffff;
    font-size: 0.7rem;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .source {
    flex: 1;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.7;
  }
  .close {
    flex: none;
    border: 0;
    background: none;
    font: inherit;
    font-size: 1rem;
    line-height: 1;
    padding: 2px 4px;
    cursor: pointer;
    color: inherit;
    opacity: 0.6;
  }
  .close:hover { opacity: 1; }
  .title { font-weight: 600; margin-top: 8px; }
  .excerpt { margin: 6px 0 0; opacity: 0.85; }
  .link { display: inline-block; margin-top: 8px; color: #1d4ed8; }
`;

/**
 * The evidence card behind one marker, as a custom element so it owns its own
 * focus behaviour instead of inheriting whatever the host page does.
 *
 * Positioned `fixed` against the marker's rectangle, which is read on open, on
 * scroll and on resize — the anchor moves with the page, so a popover that was
 * placed once drifts away from the sentence it belongs to.
 */
class CitationPopoverElement extends LitElement {
  static properties = {
    citation: { attribute: false },
  };

  static styles = POPOVER_STYLES;

  constructor() {
    super();
    this.citation = null;
    this._anchor = null;
    this._isOpen = false;
    this._boundKeyDown = (event) => this._onKeyDown(event);
    this._boundPointerDown = (event) => this._onPointerDown(event);
    this._boundReposition = () => this.reposition();
  }

  open(citation, anchor) {
    if (this._anchor && this._anchor !== anchor) {
      this._anchor.setAttribute('aria-expanded', 'false');
    }
    this.citation = citation;
    this._anchor = anchor;
    this._isOpen = true;
    this.hidden = false;
    anchor.setAttribute('aria-expanded', 'true');

    document.addEventListener('keydown', this._boundKeyDown, true);
    document.addEventListener('pointerdown', this._boundPointerDown, true);
    window.addEventListener('scroll', this._boundReposition, true);
    window.addEventListener('resize', this._boundReposition);

    // Placed and focused after the render commits: before that the element has no
    // measured size, so it would be positioned as if it were empty.
    this.updateComplete.then(() => {
      if (!this._isOpen) return;
      this.reposition();
      this.renderRoot.querySelector('.popover')?.focus({ preventScroll: true });
    });
  }

  /** Re-clicking the marker that is already showing closes it. */
  toggle(citation, anchor) {
    if (this._isOpen && this._anchor === anchor) {
      this.close();
      return;
    }
    this.open(citation, anchor);
  }

  /**
   * Focus returns to the marker on Escape and on the close button, because the
   * reader ended the interaction without going anywhere else and would otherwise
   * be dropped at the top of the document. It does NOT return on a click outside:
   * the reader has already chosen where their attention goes, and pulling focus
   * back would undo that choice.
   */
  close({ returnFocus = true } = {}) {
    if (!this._isOpen) return;
    const anchor = this._anchor;
    this._isOpen = false;
    this._anchor = null;
    this.citation = null;
    this.hidden = true;
    anchor?.setAttribute('aria-expanded', 'false');

    document.removeEventListener('keydown', this._boundKeyDown, true);
    document.removeEventListener('pointerdown', this._boundPointerDown, true);
    window.removeEventListener('scroll', this._boundReposition, true);
    window.removeEventListener('resize', this._boundReposition);

    if (returnFocus) anchor?.focus({ preventScroll: true });
  }

  /** The narrative rebuilt its markers, so the anchor this was attached to is gone. */
  closeIfDetached() {
    if (this._isOpen && !this._anchor?.isConnected) this.close({ returnFocus: false });
  }

  reposition() {
    if (!this._isOpen || !this._anchor) return;
    const anchor = this._anchor.getBoundingClientRect();
    const box = this.getBoundingClientRect();
    const gap = 8;
    const height = box.height || 0;
    // Below the marker when it fits, above it when it does not, clamped to the
    // viewport either way.
    const top = anchor.bottom + gap + height > window.innerHeight - gap
      ? Math.max(gap, anchor.top - gap - height)
      : anchor.bottom + gap;
    const left = Math.max(gap, Math.min(anchor.left, window.innerWidth - box.width - gap));
    this.style.top = `${Math.round(top)}px`;
    this.style.left = `${Math.round(left)}px`;
  }

  _onKeyDown(event) {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.close();
      return;
    }
    if (event.key === 'Tab') this._trapTab(event);
  }

  /** Behaves like a dialog: Tab cycles inside the card instead of leaving it. */
  _trapTab(event) {
    const focusables = [...this.renderRoot.querySelectorAll('a[href], button:not([disabled])')];
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = this.renderRoot.activeElement;
    const onCard = active === this.renderRoot.querySelector('.popover');
    if (event.shiftKey && (onCard || active === first)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  _onPointerDown(event) {
    // composedPath, not target: the marker lives in another shadow tree, so by
    // the time this listener sees the event the target has been retargeted to the
    // narrative element and would never match the anchor.
    if (this.contains(event.target) || event.composedPath().includes(this._anchor)) return;
    this.close({ returnFocus: false });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.close({ returnFocus: false });
  }

  render() {
    const citation = this.citation;
    if (!citation) return nothing;

    return html`
      <div class="popover" tabindex="-1" role="dialog"
           aria-label="Citation ${citation.index}">
        <div class="head">
          <span class="badge">${citation.index}</span>
          <span class="source">${citation.source}</span>
          <button class="close" type="button" aria-label="Close citation"
                  @click=${() => this.close()}>×</button>
        </div>
        <div class="title">${citation.title}</div>
        ${citation.excerpt ? html`<p class="excerpt">${citation.excerpt}</p>` : nothing}
        ${citation.url
          ? html`<a class="link" href=${citation.url} target="_blank"
                   rel="noopener noreferrer">Open source</a>`
          : nothing}
      </div>
    `;
  }
}

customElements.define('citation-popover', CitationPopoverElement);

/** Props: the prose, and the evidence its markers point at. */
const CitedNarrativeApi = {
  name: 'CitedNarrative',
  schema: z.object({
    text: z.string(),
    citations: z.array(z.object({
      index: z.number(),
      source: z.string(),
      title: z.string(),
      // Present on a literature citation, which is the case where the marker shows an
      // identifier and links out instead of opening a panel.
      pmid: z.string().optional(),
      excerpt: z.string().optional(),
      url: z.string().optional(),
    })).default([]),
    // True while the answer is still arriving.
    streaming: z.boolean().default(false),
  }).strict(),
};

class CitedNarrativeElement extends A2uiLitElement {
  static styles = NARRATIVE_STYLES;

  createController() {
    return new A2uiController(this, CitedNarrativeApi);
  }

  constructor() {
    super();
    // The prose is markdown, so it needs the provider the basic catalog's Text
    // consumes. Read imperatively rather than with a decorator, to keep this
    // file's style uniform.
    this._markdown = new ContextConsumer(this, { context: Context.markdown, subscribe: true });
    this._popover = null;
    this._wired = false;
    this._source = null;   // the text `_body` was rendered from
    this._body = null;     // rendered html, or null while the provider is working
    this._failed = false;
  }

  /**
   * The provider is asynchronous — it returns a promise, not a string — so the
   * prose is rendered out of band into `_body`. Rendering it inside `render()`
   * hands Lit a promise, which draws as the literal text `[object Promise]`.
   *
   * Deliberately not done from `willUpdate()`: the A2UI base class uses that hook,
   * and overriding it without calling it left this component with no props at all.
   */
  _syncProse() {
    const text = this.controller?.props?.text || '';
    if (text !== this._source) {
      this._source = text;
      this._body = null;
      this._failed = false;
    }
    // Retried on every update until it lands: the provider arrives from context
    // and is not guaranteed to be there on the first update.
    if (this._body === null && !this._failed) this._renderMarkdown(text);
  }

  async _renderMarkdown(text) {
    const render = this._markdown.value;
    if (typeof render !== 'function') return;

    try {
      const body = await render(text);
      if (this._source !== text) return;   // a newer text arrived while waiting
      if (typeof body === 'string') this._body = body;
      else this._failed = true;
    } catch (error) {
      if (this._source === text) this._failed = true;
      console.error('[CitedNarrative] markdown render failed', error);
    }
    this.requestUpdate();
  }

  render() {
    const props = this.controller?.props;
    if (!props) return nothing;

    const streaming = props.streaming === true;

    return html`
      <div class="narrative">
        <div class="prose">${this._body ? unsafeHTML(this._body) : this._source}</div>
        ${streaming
          ? html`<div class="streaming-note">
              Markers are inert until the answer is complete.
            </div>`
          : nothing}
      </div>
      <citation-popover></citation-popover>
    `;
  }

  updated() {
    this._popover = this._popover || this.renderRoot.querySelector('citation-popover');
    if (!this._wired) {
      this._wired = true;
      // One delegated listener on the shadow root. The markers are created after
      // the render and replaced on every update, so per-button listeners would
      // have to be re-attached each time and would leak when they were not.
      this.renderRoot.addEventListener('click', (event) => this._onMarkerClick(event));
    }
    this._syncProse();
    this._decorate();
  }

  /**
   * Replaces `^[n]` in the rendered prose with real controls.
   *
   * Done on the rendered DOM rather than by splitting the markdown source, because
   * a marker sits mid-sentence: splitting the source would hand the renderer two
   * half-paragraphs and it would close each of them.
   */
  _decorate() {
    const prose = this.renderRoot.querySelector('.prose');
    if (!prose) return;

    const props = this.controller?.props || {};
    const citations = props.citations || [];
    const streaming = props.streaming === true;

    const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
    const targets = [];
    while (walker.nextNode()) {
      if (walker.currentNode.data.includes('^[')) targets.push(walker.currentNode);
    }

    for (const node of targets) {
      // Every match is collected from the original string before any of it is
      // consumed. Slicing while stepping through the same regex let `lastIndex`
      // drift ahead of the text it was indexing, so a marker went missing.
      const matches = [...node.data.matchAll(new RegExp(MARKER.source, MARKER.flags))];
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      for (const match of matches) {
        fragment.appendChild(document.createTextNode(node.data.slice(cursor, match.index)));
        fragment.appendChild(this._marker(match[1], citations, streaming));
        cursor = match.index + match[0].length;
      }
      fragment.appendChild(document.createTextNode(node.data.slice(cursor)));
      node.parentNode.replaceChild(fragment, node);
    }

    this._popover?.closeIfDetached();
  }

  _marker(digits, citations, streaming) {
    // A marker names its citation by position, or — when the model writes the identifier
    // instead — by PMID. Position is tried first: it is the instructed form, and an index
    // is far too small to be mistaken for an eight-digit identifier.
    const citation =
      citations.find((entry) => Number(entry.index) === Number(digits)) ||
      citations.find((entry) => String(entry.pmid || '') === String(digits));
    // What the marker says. On a literature turn it is the PMID, because the marker is
    // an identifier the reader can act on rather than a count of evidence; on a note
    // turn it is the index its popover answers to.
    const label = citation?.pmid || digits;

    if (streaming) {
      const inert = document.createElement('span');
      inert.className = 'cite inert';
      // Labelled with what it will become, not with the index: the text does not change
      // when the answer completes, so the sentence never reflows under the reader.
      inert.textContent = label;
      return inert;
    }

    if (citation?.pmid) {
      // Straight to the source. The record is the primary evidence, and a copy of its
      // abstract in a floating panel is a second place to read the same thing — with
      // the identifier already on screen, the shortest path is the useful one.
      const link = document.createElement('a');
      link.className = 'cite cite-pmid';
      link.href = pubmedUrl(citation.pmid);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = label;
      link.title = `PMID ${citation.pmid} — ${citation.title}`;
      link.setAttribute(
        'aria-label', `PMID ${citation.pmid}: ${citation.title} (opens PubMed)`);
      return link;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = citation ? 'cite' : 'cite missing';
    button.dataset.cite = digits;
    button.textContent = digits;
    if (citation) {
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-expanded', 'false');
      button.title = citation.title;
    } else {
      button.disabled = true;
      button.title = 'No matching citation in this response';
    }
    return button;
  }

  _onMarkerClick(event) {
    const button = event.target.closest?.('button.cite:not([disabled])');
    if (!button || !this._popover) return;

    const citations = this.controller?.props?.citations || [];
    const citation = citations.find(
      (entry) => Number(entry.index) === Number(button.dataset.cite));
    if (!citation) return;

    this._popover.toggle(citation, button);
  }
}

export const CitedNarrative = {
  ...CitedNarrativeApi, tagName: 'a2ui-cited-narrative',
};
customElements.define('a2ui-cited-narrative', CitedNarrativeElement);

// ---------------------------------------------------------------------------
// Literature
//
// A bibliography, not a reading pane: title, journal, date, and the PMID, which is
// the link a reader follows. The abstract was the heaviest thing on the canvas and
// the least used — a clinician checking a claim does so at the source — so the rows
// are now as short as the citation. The wire name and the props stay as they were;
// `abstract` is the one key this removed, and the agent stopped sending it in the
// same change, because a field nothing renders is a promise the component is no
// longer keeping.

const _LITERATURE_STYLES = css`
  :host { display: block; }
  .stack { display: flex; flex-direction: column; gap: 8px; }
  .record { border: 1px solid rgba(17, 24, 39, 0.15); border-radius: 10px;
            padding: 10px 13px; }
  .record-title { font-size: 0.9rem; font-weight: 600; line-height: 1.35; }
  .record-title a { color: inherit; }
  .record-meta { font-size: 0.75rem; opacity: 0.75; margin-top: 4px; }
  /* The identifier is the one thing in the row that is always actionable: it is what
     a reader copies, quotes and searches with. */
  .record-pmid { font-size: 0.75rem; letter-spacing: 0.03em; opacity: 0.75;
                 margin-top: 6px; }
  .record-pmid a { color: inherit; }
  .note { font-size: 0.88rem; opacity: 0.85; }
  .degraded { font-size: 0.75rem; font-style: italic; opacity: 0.75; margin-top: 4px; }
`;

const LiteratureListApi = {
  name: 'LiteratureList',
  schema: z.object({
    articles: z.array(z.object({
      pmid: z.string(),
      title: z.string(),
      journal: z.string(),
      pub_date: z.string(),
      url: z.string(),
    })).default([]),
    note: z.string().default(''),
    degraded: z.boolean().default(false),
  }).strict(),
};

class LiteratureListElement extends A2uiLitElement {
  static styles = _LITERATURE_STYLES;

  createController() {
    return new A2uiController(this, LiteratureListApi);
  }

  render() {
    const props = this.controller?.props;
    if (!props) return nothing;

    const articles = props.articles || [];
    // No records: the agent's own sentence says which of the two things that was —
    // matched nothing, or could not be searched. Not restated here, because a
    // second wording for the same fact is a second thing that can drift.
    if (articles.length === 0) {
      return html`
        <div class="note">${props.note}</div>
        ${props.degraded
          ? html`<div class="degraded">The search did not complete.</div>`
          : nothing}
      `;
    }

    return html`
      <div class="stack">
        ${articles.map((article) => html`
          <div class="record">
            <div class="record-title">
              ${article.url
                ? html`<a href=${article.url} target="_blank"
                          rel="noopener noreferrer">${article.title}</a>`
                : article.title}
            </div>
            ${article.journal || article.pub_date
              ? html`<div class="record-meta">${
                  [article.journal, article.pub_date].filter(Boolean).join(' · ')}</div>`
              : nothing}
            <div class="record-pmid">PMID <a href=${pubmedUrl(article.pmid)}
              target="_blank" rel="noopener noreferrer"
              >${article.pmid}</a></div>
          </div>
        `)}
      </div>
    `;
  }
}

export const LiteratureList = {
  ...LiteratureListApi, tagName: 'a2ui-literature-list',
};
customElements.define('a2ui-literature-list', LiteratureListElement);

// ---------------------------------------------------------------------------
// Source card
//
// The cited note passage. It is here because switching the console to this
// catalog would otherwise have taken the evidence card off /meds, /ehr and every
// free-text answer that cites a note: the agent still composes a `SourceCard`, and
// a component the catalog does not register draws nothing at all — no error, no
// warning, just a missing card. Phase 2 replaces it with citations in the
// narrative itself; until that lands, the card has to keep working.

const _SOURCE_STYLES = css`
  :host { display: block; }
  .source { border: 1px solid rgba(17, 24, 39, 0.15);
            border-left: 3px solid rgba(17, 24, 39, 0.35);
            border-radius: 8px; padding: 12px 14px;
            background: rgba(127, 127, 127, 0.04); }
  .head { font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.05em; opacity: 0.65; }
  /* pre-wrap: a note passage is a block of clinical text whose line structure
     carries meaning (drug lists, vitals rows). Reflowing it would make the
     evidence harder to check than the summary it supports. */
  .passage { font-size: 0.85rem; line-height: 1.5; margin-top: 8px;
             white-space: pre-wrap; }
  .query { font-size: 0.72rem; opacity: 0.6; margin-top: 8px; }
`;

const SourceCardApi = {
  name: 'SourceCard',
  schema: z.object({
    cite: z.number(),
    section: z.string(),
    text: z.string(),
    query: z.string().default(''),
  }).strict(),
};

class SourceCardElement extends A2uiLitElement {
  static styles = _SOURCE_STYLES;

  createController() {
    return new A2uiController(this, SourceCardApi);
  }

  render() {
    const props = this.controller?.props;
    if (!props) return nothing;

    return html`
      <div class="source">
        <div class="head">
          Cite ${props.cite} · ${props.section.replace(/_/g, ' ')}
        </div>
        <div class="passage">${props.text}</div>
        ${props.query ? html`<div class="query">retrieved for: ${props.query}</div>` : nothing}
      </div>
    `;
  }
}

export const SourceCard = {
  ...SourceCardApi, tagName: 'a2ui-source-card',
};
customElements.define('a2ui-source-card', SourceCardElement);

// ---------------------------------------------------------------------------
// Medications
//
// The grid, for `/meds`. A list of drugs in prose is what it replaces: a clinician
// scanning for one agent on one dose reads a column, not a paragraph. Every row was
// verified against the note text before it reached the surface, and the rows that
// failed verification are not drawn at all — but they are counted, because a list
// with a hole in it and a complete list must not look the same.

const _MEDS_STYLES = css`
  :host { display: block; }
  .grid { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px;
          overflow: hidden; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th { text-align: left; font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
       letter-spacing: 0.04em; color: #64748b; background: #f8fafc;
       padding: 9px 12px; border-bottom: 1px solid #e5e7eb; }
  td { padding: 9px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  tr:last-child td { border-bottom: 0; }
  .medication { font-weight: 600; }
  /* The columns a clinician scans down, rather than reads across: tabular figures so
     the digits line up, and no wrapping so a dose never breaks mid-value. */
  .dosage, .frequency { font-variant-numeric: tabular-nums; white-space: nowrap;
                        color: #334155; }
  .missing { font-size: 0.75rem; color: #94a3b8; }
  .incomplete { font-size: 0.75rem; color: #64748b; margin-top: 8px; }
`;

const MedicationGridApi = {
  name: 'MedicationGrid',
  schema: z.object({
    medications: z.array(z.object({
      medication: z.string(),
      dosage: z.string(),
      frequency: z.string(),
    })).default([]),
    dropped_count: z.number().default(0),
    returned_passages: z.number().default(0),
  }).strict(),
};

class MedicationGridElement extends A2uiLitElement {
  static styles = _MEDS_STYLES;

  createController() {
    return new A2uiController(this, MedicationGridApi);
  }

  render() {
    const props = this.controller?.props;
    if (!props) return nothing;

    const rows = props.medications || [];
    // No rows and no grid: the agent composes this component only when it has rows,
    // because an empty table reads as "this patient takes nothing". Rendering nothing
    // here keeps that true even if a fixture or a future composer sends one.
    if (rows.length === 0) return nothing;

    const dropped = Number(props.dropped_count) || 0;
    return html`
      <div class="grid">
        <table>
          <thead>
            <tr>
              <th scope="col">Medication</th>
              <th scope="col">Dosage</th>
              <th scope="col">Frequency</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => html`
              <tr>
                <td class="medication">${row.medication}</td>
                <td class="dosage">${row.dosage
                  || html`<span class="missing">not stated</span>`}</td>
                <td class="frequency">${row.frequency
                  || html`<span class="missing">not stated</span>`}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
      ${dropped > 0
        ? html`<div class="incomplete">
            ${dropped} further ${dropped === 1 ? 'row was' : 'rows were'} read from the
            note but could not be verified, and ${dropped === 1 ? 'is' : 'are'} not
            shown.
          </div>`
        : nothing}
    `;
  }
}

export const MedicationGrid = {
  ...MedicationGridApi, tagName: 'a2ui-medication-grid',
};
customElements.define('a2ui-medication-grid', MedicationGridElement);

/**
 * The clinical catalog: the basic one, plus this file's components.
 *
 * Built as a plain object of the shape the renderer consumes (`id`,
 * `components: Map`, `functions`) rather than with a `Catalog` instance, because
 * `@a2ui/lit` does not export the class — the same construction the Q3 spike uses.
 */
export function buildClinicalCatalog(basicCatalog) {
  return {
    id: CATALOG_ID,
    components: new Map([
      ...basicCatalog.components,
      ['RiskInfluencers', RiskInfluencers],
      ['CitedNarrative', CitedNarrative],
      ['LiteratureList', LiteratureList],
      ['SourceCard', SourceCard],
      ['MedicationGrid', MedicationGrid],
    ]),
    functions: basicCatalog.functions,
  };
}

/**
 * Render one or more envelopes into `host`, in order.
 *
 * The whole of the binding layer, and the only thing a page has to know. An
 * envelope is the fixture's `messages` array — `createSurface` then
 * `updateComponents` — so a fixture-driven demo replays surfaces with no domain
 * logic anywhere: the same call renders a pinned fixture and a live answer, which
 * is what makes the anonymous experience a replay rather than a second
 * implementation.
 *
 * Each envelope gets its own MessageProcessor, because a processor carries the
 * surface into the next message and reusing one would draw the previous surface's
 * components inside the new one.
 */
export function mountSurfaces(host, envelopes) {
  // The markdown provider must sit above the surface: the basic catalog's Text
  // renders markdown, and without it a heading shows its literal `## `.
  new ContextProvider(host, { context: Context.markdown, initialValue: renderMarkdown });

  for (const envelope of envelopes) {
    const processor = new MessageProcessor([buildClinicalCatalog(basicCatalog)]);
    processor.onSurfaceCreated((surface) => {
      const element = document.createElement('a2ui-surface');
      // Property binding, not an attribute: the surface object cannot be
      // serialised into markup, and setting it as an attribute renders nothing
      // and reports nothing.
      element.surface = surface;
      host.appendChild(element);
    });
    processor.processMessages(envelope.messages);
  }
}
