/** The readmission risk reading: score, band, threshold and the drivers behind it. */

import { html, css, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { A2uiController, A2uiLitElement } from '@a2ui/lit/v0_9';
import z from 'zod';

import { BAND_HUE, BLOCK_SETTLE, bandLabel, isAboveThreshold, percent } from './shared.js';

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
    /* 16px -> 12px (Phase 4C §1.2). This widget sits directly above the comparative
       matrix and the pair read as two cards stacked with a gap between them; the
       vertical rhythm inside is now ~30% tighter so they read as one panel. */
    padding: 12px;
  }
  /* Three slots on one baseline: score, badge, threshold. The score sets the row's
     height and the badge sits on its baseline rather than centred against it, which
     is what keeps a pill and a 30px number looking like one line of type. */
  .headline {
    display: flex;
    align-items: baseline;
    gap: 8px;
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
    padding: 3px 7px;
  }
  .threshold { margin-left: auto; font-size: 0.75rem; opacity: 0.7; }
  /* 18px -> 12px: the group headings are tucked up under the headline rather than
     starting a new block. They label the two halves of one reading, not two
     sections. */
  .group { margin-top: 12px; }
  .group-title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
                 letter-spacing: 0.04em; margin-bottom: 5px; opacity: 0.75; }
  /* 16px between factors -> 10px, and 6px between a label and its bar -> 4px. The
     rows still read as separate readings rather than a block of ink, which is what
     the wider spacing was for, at about 30% less height. */
  .factor { margin-bottom: 10px; }
  .factor:last-child { margin-bottom: 0; }
  .factor-label { font-size: 0.85rem; margin-bottom: 4px; }
  .bar-track { height: 5px; border-radius: 999px; background: rgba(100, 116, 139, 0.14); }
  /* Slate, not ink. A near-black fill at this width is the heaviest mark on the
     screen and pulls the eye off the score it is meant to explain. Still neutral:
     the bar carries magnitude only, so it must not borrow the band's colour and
     imply it is asserting direction or threshold state (see the UX rulings). */
  .bar-fill { height: 5px; border-radius: 999px; background: #64748b; }
  /* A driver is a control now. It stays a div carrying a button role rather than
     becoming a <button>, because the row's children are blocks and a button may hold
     only phrasing content — which would mean re-declaring the label and the bar as
     spans and rebuilding a layout this stylesheet already gets right. */
  .factor { cursor: pointer; border-radius: 6px; transition: background 120ms ease; }
  .factor:hover { background: rgba(100, 116, 139, 0.07); }
  .factor:focus-visible { outline: 2px solid #1f2937; outline-offset: 2px; }
  .mismatch { font-size: 0.75rem; font-style: italic; margin-top: 8px; opacity: 0.8; }
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

/* The question a clicked driver asks.

   Composed here because this is the only place that knows the factor's name. It asks
   what supports the driver rather than restating it: the bar already shows how much the
   factor moved the estimate, and a question built from that number would be arithmetic
   the reader did not ask for. */
function driverQuestion(label) {
  return `What in this patient's chart explains ${label} as a readmission risk driver?`;
}

class RiskInfluencersElement extends A2uiLitElement {
  static styles = [INFLUENCER_STYLES, BLOCK_SETTLE];

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
    const label = bandLabel(props);

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

    /* Each driver is a control, not a label. The number says how much a factor moved
       the estimate and the only useful next question is what stands behind it, so the
       row asks that question when it is clicked.

       The event is `composed` because it has to leave this shadow root. The composer
       is outside it, and the canvas listens for this rather than reaching in here for
       the click — the same direction of travel the citation markers use, for the same
       reason.

       `intent` is the driver declaration, not a second copy of the question. The
       wording above is written to be read on screen and cannot be asked to carry a
       machine meaning; the agent's own vocabulary is the place for that, and the
       declaration is what lets the turn be recognised as a drill-down on a score
       already in the transcript rather than as a fresh question that must search. */
    const ask = (row) => {
      this.dispatchEvent(new CustomEvent('a2ui-follow-up', {
        bubbles: true,
        composed: true,
        detail: { question: driverQuestion(row.label), intent: 'risk_driver' },
      }));
    };

    const group = (title, rows) => html`
      <div class="group">
        <div class="group-title">${title}</div>
        ${rows.length === 0
          ? html`<div class="empty">None.</div>`
          : rows.map((row) => html`
              <div class="factor" role="button" tabindex="0"
                   title="Ask what supports ${row.label} as a driver"
                   @click=${() => ask(row)}
                   @keydown=${(event) => {
                     if (event.key === 'Enter' || event.key === ' ') {
                       event.preventDefault();
                       ask(row);
                     }
                   }}>
                <div class="factor-label">${row.label}</div>
                <div class="bar-track">
                  <div class="bar-fill"
                       style="width:${widest ? (Math.abs(row.contribution) / widest) * 100 : 0}%"></div>
                </div>
              </div>
            `)}
      </div>
    `;

    const band = BAND_HUE[isAboveThreshold(props) ? 'above' : 'below'];

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
// hold the safety line. A marker is a control from the first frame — the surface is
// only ever mounted on a settled answer, and the draft that precedes it draws inert
// markers of its own in the page (`copilot_draft.js`), so a control never goes live
// while the sentence around it is still being written. And a marker with no citation
// behind it is drawn disabled rather than dropped, because a model can emit a marker
// the retrieval did not support, and a bare number reads as evidence the reader simply
// has not opened yet.

