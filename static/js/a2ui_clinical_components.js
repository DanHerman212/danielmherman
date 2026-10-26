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

/** Which side of its threshold an estimate falls on, in words.
 *
 * `>= threshold` is the boundary, and the decision the model already made wins where the
 * two could disagree: this must not be able to overrule the call the score was actually
 * made under. Extracted the day the comparative matrix arrived, because its pinned row
 * labels the patient with the same rule — two renderings of one estimate disagreeing
 * about which side of the threshold it fell on is the failure this prevents.
 */
const isAboveThreshold = (props) =>
  Number(props.decision) === 1
  || Number(props.probability) >= Number(props.threshold);

const bandLabel = (props) =>
  isAboveThreshold(props) ? 'Above threshold' : 'Below threshold';

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

/**
 * How a block arrives on a canvas: the air around it, and the settle it animates in with.
 *
 * The layout component spaces its children by 8px, which is right between two short
 * paragraphs and too tight between a paragraph and a widget that already carries its
 * own padding — the two read as one crowded block. The extra space is declared at the
 * host and only for a block that follows something, so a widget that opens a surface
 * does not grow a leading gap above itself.
 *
 * The animation lives here because this is the only place that can reach these elements:
 * a card is a child of the surface's shadow root, so no rule in `demo_shell.css` and no
 * `querySelectorAll` from the page can select one. `:host(...)` matches the host against
 * its own position among its siblings, which is enough to stagger them, and the stagger
 * is what makes a canvas read as being laid out rather than pasted.
 *
 * The cited narrative is deliberately not on this list. It IS the prose, and it is
 * cross-faded with the draft the page has been reading (`copilot_canvas.js`, `settle`),
 * so animating it here as well would fade the same text twice.
 */
const BLOCK_SETTLE = css`
  :host(:not(:first-child)) { margin-top: 16px; }
  :host { animation: a2ui-settle 260ms ease-out both; }
  :host(:nth-child(2)) { animation-delay: 60ms; }
  :host(:nth-child(3)) { animation-delay: 120ms; }
  :host(:nth-child(4)) { animation-delay: 180ms; }
  :host(:nth-child(5)) { animation-delay: 240ms; }
  :host(:nth-child(6)) { animation-delay: 300ms; }
  @keyframes a2ui-settle {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    :host { animation: none; }
  }
`;

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

/**
 * The whitespace a marker leaves behind, tightened.
 *
 * A marker is set inside a sentence, and a gap between the pill and the punctuation that
 * ends its clause reads as a space that has drifted: `… discontinued [1 · Course] .`
 * rather than `… discontinued [1 · Course].` The prose is written by a model, so the gap
 * is the model's; this seam is the only place that can close it without asking the model
 * to be careful about spacing it cannot see. Only the whitespace immediately following a
 * marker is touched — between two words it is the word gap, and it is left alone.
 */
const DETACHED_PUNCTUATION = /^[ \t\u00a0]+([.,;:!?])/;

const tightenedAfterMarker = (text) => text.replace(DETACHED_PUNCTUATION, '$1');

const NARRATIVE_STYLES = css`
  :host { display: block; }
  .narrative { font-size: 1rem; line-height: 1.65; }
  /* The reading measure. A 68ch column is the editorial one: prose past it loses the
     return sweep, and this answer is read as prose rather than scanned as a table. */
  .prose { max-width: 68ch; }
  .prose > :first-child { margin-top: 0; }
  .prose > :last-child { margin-bottom: 0; }
  /* A section of the answer.

     The heading is a markdown heading, not a bold run. The first attempt keyed this on a
     paragraph whose only child was a <strong>, and the model promptly bolded an entire
     section — one strong holding the heading and every sentence under it — which that rule
     then set at 600 weight in its whole. A level-2 heading cannot be misread that way:
     markdown makes the heading a block element before this stylesheet ever sees it, so a
     heading and the prose beneath it can never end up as one run of text.

     The 2026-10-16 directive restates this as a bold-run rule on a class called
     .cp-narrative, in demo_shell.css, "to replace fragile markdown paragraph matching with
     an explicit block selector". Three things about that do not hold here, and the numbers
     below are the part of it that does. The class here is .prose, on an
     a2ui-cited-narrative element that draws into a shadow root demo_shell.css cannot
     reach — a rule written there would have styled nothing, and silently. The bold-run rule
     is the one described above, and it is gone deliberately. And the selector it names
     would have been narrower than the problem: the sections are real headings now, which is
     the stronger guarantee. What the directive asks for in effect — a heading at
     0.95rem/600 with 1.25rem above and 0.25rem below, and prose at a 1.6 line height — is
     what is applied here.

     No backticks anywhere in this block, and that is a rule rather than a preference: the
     whole stylesheet is a template literal, so one backtick in a comment ends it, and the
     parse error lands somewhere else entirely. That has now happened twice. */
  .prose > h1, .prose > h2, .prose > h3, .prose > h4 {
    font-size: 1.05rem;
    font-weight: 650;
    line-height: 1.4;
    color: #0f172a;
    margin: 1.5rem 0 0.35rem;
  }
  /* The heading that opens a turn sits flush with the top of the answer. */
  .prose > h1:first-child, .prose > h2:first-child,
  .prose > h3:first-child, .prose > h4:first-child { margin-top: 0; }
  /* Enough air that two paragraphs read as two readings rather than one block. */
  .prose > p { margin: 0 0 0.9rem; text-wrap: pretty; }
  .cite {
    font: inherit;
    font-size: 0.72em;
    line-height: 1;
    vertical-align: super;
    margin-left: 1px;
    padding: 1px 5px;
    /* Editorial, not chunky: a soft slate fill on a hairline border reads as a footnote
       marker beside the sentence rather than as a control competing with it. It is still
       a button with a popover, and still focusable — the softening is visual only. */
    border: 1px solid #cbd5e1;
    border-radius: 999px;
    background: #f1f5f9;
    color: #334155;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    /* A pill is one line, always. A button wraps its own text by default, so a long label
       broke the box across two lines and the rounded border read as a pill cut in half. The
       agent now bounds what a label may be length-wise, and this is the half that holds
       whatever it is handed. */
    white-space: nowrap;
  }
  .cite:hover { background: #e2e8f0; border-color: #94a3b8; }
  .cite:focus-visible { outline: 2px solid #1f2937; outline-offset: 1px; }
  /* The marker a drawer row has just opened, set by revealCitation. It lives here
     because this stylesheet already owns the marker's outline colour — the page used
     to write the same colour inline into a shadow node, at a different offset, which
     is two definitions of one highlight and only one of them could be adjusted. */
  .cite.is-target { outline: 2px solid #1f2937; outline-offset: 1px; }
  .cite[aria-expanded='true'] { background: #1f2937; color: #ffffff; border-color: #1f2937; }
  /* A literature marker is an identifier rather than a control that opens a panel,
     so it keeps the badge's shape and loses the underline. */
  .cite-pmid { text-decoration: none; }
  .cite.missing { border-style: dotted; opacity: 0.6; cursor: not-allowed; }
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
    /* The card is a header rule and a body, so the padding has moved into them; the
       overflow keeps the header's rule inside the rounded corner. */
    overflow: hidden;
    padding: 0;
    font-size: 0.85rem;
    line-height: 1.45;
  }
  .popover:focus { outline: none; }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 9px 10px 8px 14px;
    border-bottom: 1px solid #eef2f7;
  }
  /* The eyebrow says what the card is, quietly, because the marker already said which
     reference it opens. */
  .eyebrow { flex: 1; font-size: 0.72rem; font-style: italic; color: #94a3b8; }
  .see-all {
    flex: none;
    border: 0;
    background: none;
    font: inherit;
    font-size: 0.72rem;
    padding: 2px 4px;
    color: #1d4ed8;
    cursor: pointer;
  }
  .see-all:hover { text-decoration: underline; }
  .body { padding: 10px 14px 12px; }
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
  .title { margin: 0; font-weight: 650; color: #1d4ed8; }
  .subtitle { margin: 2px 0 0; font-size: 0.78rem; color: #64748b; }
  .excerpt { margin: 8px 0 0; color: #334155; }
  .link { display: inline-block; margin-top: 8px; color: #1d4ed8; }
`;

//: How long the pointer must rest on a marker before its card opens, and how long the
//: card lingers once the pointer leaves it.
//:
//: The delay is what makes the card reachable at all. There are a few pixels between a
//: marker and the card below it, and a card that closed the instant `pointerout` fired
//: would be gone before the hand moving into it arrived.
const HOVER_INTENT_MS = 150;
const HOVER_CLOSE_MS = 150;

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
    //: What opened the card — `hover`, `focus` or `click`. A card the pointer or the
    //: caret opened is transient and closes when they leave; a clicked one is pinned
    //: and closes only when it is dismissed.
    this._openedBy = null;
    this._openTimer = null;
    this._closeTimer = null;
    this._boundKeyDown = (event) => this._onKeyDown(event);
    this._boundPointerDown = (event) => this._onPointerDown(event);
    this._boundReposition = () => this.reposition();
  }

  /**
   * Open after the gesture has settled, rather than on the gesture itself.
   *
   * A pointer crossing a sentence should not leave a trail of opened cards behind it, so
   * the open waits for the rest to become an intent; a focus passes no delay, because
   * arriving by keyboard already IS the intent and a card 150 ms late reads as lag.
   */
  scheduleOpen(citation, anchor, { via = 'hover', delay = HOVER_INTENT_MS } = {}) {
    this._cancelTimers();
    if (this._isOpen && this._anchor === anchor) return;
    this._openTimer = setTimeout(() => {
      this._openTimer = null;
      this.open(citation, anchor, { via });
    }, delay);
  }

  /**
   * Close once the pointer has been away for the grace period.
   *
   * Cancelled by entering the card, which is the whole reason the delay exists. Refused
   * for a card that was clicked: the reader committed to it, and a pointer that wanders
   * off is not a dismissal.
   */
  scheduleClose(delay = HOVER_CLOSE_MS) {
    this._cancelTimers();
    if (!this._isOpen || this._openedBy === 'click') return;
    this._closeTimer = setTimeout(() => {
      this._closeTimer = null;
      this.close({ returnFocus: false });
    }, delay);
  }

  /** The pointer has come back — to the marker, or into the card itself. */
  cancelClose() {
    clearTimeout(this._closeTimer);
    this._closeTimer = null;
  }

  _cancelTimers() {
    clearTimeout(this._openTimer);
    clearTimeout(this._closeTimer);
    this._openTimer = null;
    this._closeTimer = null;
  }

  open(citation, anchor, { via = 'click' } = {}) {
    this._cancelTimers();
    if (this._isOpen && this._anchor === anchor) {
      // Already showing for this marker. Being clicked while open is a promotion, not a
      // reopen: see `toggle`.
      if (via === 'click') this._openedBy = 'click';
      return;
    }
    if (this._anchor && this._anchor !== anchor) {
      this._anchor.setAttribute('aria-expanded', 'false');
    }
    this.citation = citation;
    this._anchor = anchor;
    this._isOpen = true;
    this._openedBy = via;
    this.hidden = false;
    anchor.setAttribute('aria-expanded', 'true');

    document.addEventListener('keydown', this._boundKeyDown, true);
    document.addEventListener('pointerdown', this._boundPointerDown, true);
    window.addEventListener('scroll', this._boundReposition, true);
    window.addEventListener('resize', this._boundReposition);

    // Placed and focused after the render commits: before that the element has no
    // measured size, so it would be positioned as if it were empty.
    //
    // A card opened by the POINTER is not focused. Moving the cursor over a citation in
    // an answer must not take the caret out of the composer the reader is typing in.
    this.updateComplete.then(() => {
      if (!this._isOpen) return;
      this.reposition();
      if (via === 'hover') return;
      this.renderRoot.querySelector('.popover')?.focus({ preventScroll: true });
    });
  }

  /**
   * Re-clicking a marker that is already showing closes it.
   *
   * Unless the card was opened by the pointer or the keyboard: then the click is the
   * reader claiming a card they were already being shown, and closing it under their
   * cursor is the opposite of what they asked for. The next click dismisses it.
   */
  toggle(citation, anchor) {
    if (this._isOpen && this._anchor === anchor) {
      if (this._openedBy === 'click') {
        this.close();
        return;
      }
      this._openedBy = 'click';
      this._cancelTimers();
      return;
    }
    this.open(citation, anchor, { via: 'click' });
  }

  /**
   * Focus returns to the marker on Escape and on the close button, because the
   * reader ended the interaction without going anywhere else and would otherwise
   * be dropped at the top of the document. It does NOT return on a click outside:
   * the reader has already chosen where their attention goes, and pulling focus
   * back would undo that choice.
   */
  close({ returnFocus = true } = {}) {
    this._cancelTimers();
    if (!this._isOpen) return;
    const anchor = this._anchor;
    this._isOpen = false;
    this._openedBy = null;
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

  /**
   * Hand the reader to the whole evidence list, and get out of the way.
   *
   * The list belongs to the page — it is drawn by the turn, not by this card and not by
   * the narrative — so this announces the request and lets the turn answer it. Reaching
   * across two shadow boundaries to scroll an element this element cannot see would be
   * the page's job done in the wrong place.
   */
  seeAll() {
    this.dispatchEvent(new CustomEvent('citation-see-all', {
      bubbles: true,
      composed: true,
      detail: { index: this.citation?.index ?? null },
    }));
    // Focus goes with the reader: the turn moves it to the list it has just opened, so
    // returning it to the marker first would be two moves for one intent.
    this.close({ returnFocus: false });
  }

  render() {
    const citation = this.citation;
    if (!citation) return nothing;

    return html`
      <div class="popover" tabindex="-1" role="dialog"
           aria-label="Citation ${citation.index}"
           @pointerenter=${() => this.cancelClose()}
           @pointerleave=${() => this.scheduleClose()}>
        <div class="head">
          <span class="eyebrow">Reference</span>
          <button class="see-all" type="button"
                  @click=${() => this.seeAll()}>See all references ↓</button>
          <button class="close" type="button" aria-label="Close citation"
                  @click=${() => this.close()}>×</button>
        </div>
        <div class="body">
          <p class="title">${citation.index}. ${citation.title}</p>
          <p class="subtitle">${citation.source}</p>
          ${citation.excerpt ? html`<p class="excerpt">${citation.excerpt}</p>` : nothing}
          ${citation.url
            ? html`<a class="link" href=${citation.url} target="_blank"
                     rel="noopener noreferrer">Open source</a>`
            : nothing}
        </div>
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
    this._revealTimer = null;   // the highlight `revealCitation` is holding
    this._announced = false;    // the ready event is dispatched once
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

    return html`
      <div class="narrative">
        <div class="prose">${this._body ? unsafeHTML(this._body) : this._source}</div>
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
      // The card answers the pointer and the caret as well as the click. A marker is a
      // footnote, and a footnote is read by resting on it as often as by opening it —
      // the popover's own timers decide when the rest has become an intent.
      this.renderRoot.addEventListener('pointerover',
                                      (event) => this._onMarkerHover(event));
      this.renderRoot.addEventListener('pointerout',
                                      (event) => this._onMarkerUnhover(event));
      this.renderRoot.addEventListener('focusin', (event) => this._onMarkerFocus(event));
      this.renderRoot.addEventListener('focusout', (event) => this._onMarkerBlur(event));
    }
    this._syncProse();
    this._decorate();

    // Announced once, after the first render, so the page can hold a handle on this
    // element without selecting through two shadow roots it does not own — the A2UI
    // surface's and this one's. `composed` is what carries it across the surface's
    // boundary; `bubbles` is what carries it up to the turn.
    if (!this._announced) {
      this._announced = true;
      this.dispatchEvent(new CustomEvent('a2ui-cited-narrative-ready', {
        bubbles: true,
        composed: true,
        detail: { element: this },
      }));
    }
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
      let afterMarker = false;
      for (const match of matches) {
        // The gap before this marker belongs to the marker before it, so it is tightened
        // only when something was just replaced; the gap that opens the text node is
        // ordinary word spacing and is left as it was written.
        const gap = node.data.slice(cursor, match.index);
        fragment.appendChild(
          document.createTextNode(afterMarker ? tightenedAfterMarker(gap) : gap));
        fragment.appendChild(this._marker(match[1], citations));
        cursor = match.index + match[0].length;
        afterMarker = true;
      }
      const tail = node.data.slice(cursor);
      fragment.appendChild(
        document.createTextNode(afterMarker ? tightenedAfterMarker(tail) : tail));
      node.parentNode.replaceChild(fragment, node);
    }

    this._popover?.closeIfDetached();
  }

  _marker(digits, citations) {
    // A marker names its citation by position, or — when the model writes the identifier
    // instead — by PMID. Position is tried first: it is the instructed form, and an index
    // is far too small to be mistaken for an eight-digit identifier.
    const citation =
      citations.find((entry) => Number(entry.index) === Number(digits)) ||
      citations.find((entry) => String(entry.pmid || '') === String(digits));
    // What the marker says, resolved by the server so the clinical vocabulary lives in one
    // module: `1 · Hospital Course` on a note turn, the journal on a literature turn. The
    // fallbacks are for a payload from an agent that predates the label — a bare number
    // still answers its popover, so nothing breaks, it just reads the way it used to.
    const label = citation?.label || citation?.pmid || digits;

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
    button.textContent = label;
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
    const button = this._markerTarget(event);
    const citation = button ? this._citationBehind(button) : null;
    if (!citation || !this._popover) return;

    this._popover.toggle(citation, button);
  }

  /** The marker a pointer or focus event is about, or null for everything else. */
  _markerTarget(event) {
    return event.target.closest?.('button.cite:not([disabled])') || null;
  }

  /** The citation a marker names, resolved by position as the marker itself is. */
  _citationBehind(button) {
    const citations = this.controller?.props?.citations || [];
    return citations.find(
      (entry) => Number(entry.index) === Number(button.dataset.cite)) || null;
  }

  _onMarkerHover(event) {
    const button = this._markerTarget(event);
    if (!button || !this._popover) return;
    const citation = this._citationBehind(button);
    // The pointer is crossing a sentence on its way somewhere else more often than it is
    // stopping, so the card waits for the rest to become an intention.
    if (citation) this._popover.scheduleOpen(citation, button, { via: 'hover' });
  }

  _onMarkerUnhover(event) {
    if (!this._markerTarget(event)) return;
    this._popover?.scheduleClose();
  }

  _onMarkerFocus(event) {
    const button = this._markerTarget(event);
    if (!button || !this._popover) return;
    const citation = this._citationBehind(button);
    // No intent delay on the keyboard: arriving by Tab already is the intent, and a card
    // that appeared 150 ms later would only look like it had lagged.
    if (citation) this._popover.scheduleOpen(citation, button, { via: 'focus', delay: 0 });
  }

  _onMarkerBlur(event) {
    if (!this._markerTarget(event)) return;
    // Focus moving INTO the card is a reader reading it. It retargets to the card's host
    // on the way out of that element's shadow tree, which is why the host is tested as
    // well as its descendants.
    const next = event.relatedTarget;
    if (next && (next === this._popover || this._popover?.contains(next))) return;
    this._popover?.scheduleClose();
  }

  /**
   * Highlight the citation marker for `index` and bring it into view.
   *
   * The page's references drawer opens a row and then wants the reader shown which
   * sentence that passage supports. The marker is this component's own node inside
   * its own shadow root, so the drawing is done here: the outline is a class this
   * stylesheet defines, and the 1,400 ms belongs to the element that owns the timer
   * rather than to a `setTimeout` racing a node it cannot see replaced.
   *
   * Returns false when there is nothing to show — a turn whose prose the surface did
   * not draw, or a marker that is not a control because no citation resolved behind it
   * — so the caller can tell "revealed" from "nothing to reveal" without inspecting
   * this element.
   */
  revealCitation(index) {
    const marker = this.renderRoot.querySelector(
      `button.cite[data-cite="${String(index)}"]`);
    if (!marker) return false;

    const reduce = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    marker.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    marker.classList.add('is-target');

    clearTimeout(this._revealTimer);
    this._revealTimer = setTimeout(
      () => marker.classList.remove('is-target'), 1400);
    return true;
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
  static styles = [_LITERATURE_STYLES, BLOCK_SETTLE];

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
// Comparative risk matrix

//
// This patient's estimate against the cohorts the search returned that someone has
// curated a rate for. The difference from the list beneath it is the question being
// answered: the list says what was retrieved, this says where she sits among it.
//
// The pinned row is first and is the only row that is not a peer — a reader who cannot
// tell the patient's row from a cohort's has been handed a table about strangers and
// told it is about her. The band words come from `bandLabel`, the same function the
// widget uses, so the estimate cannot print one way in the row and another in the bar.
//
// The rate column is a string, not a number, and stays one: "≈20%" and "20%" are
// different claims about the same paper, and a column that could hold only the second
// would have to round the first into a certainty the abstract did not state.

const _MATRIX_STYLES = css`
  :host { display: block; }
  /* The table is allowed to be wider than the column rather than squeezed into it: five
     clinical columns compressed to a phone width are unreadable, and a reader who has to
     scroll one table has lost less than a reader who cannot read it at all.

     Nothing here sets a MINIMUM width, which is the distinction the first version missed.
     A minimum on the cohort column pushed the table past its container, and a table that
     overflows is one whose last column is clipped — a pill cut mid-word, which reads as a
     rendering fault rather than as a table that continues. Text columns wrap, so the
     browser sizes them from their longest word and the slack goes where it is useful. */
  .wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 0.82rem; }
  caption { caption-side: top; text-align: left; color: #64748b; font-size: 0.72rem;
            letter-spacing: 0.04em; text-transform: uppercase; padding: 0 0 6px; }
  th, td { text-align: left; vertical-align: top; padding: 8px 10px;
           border-bottom: 1px solid rgba(17, 24, 39, 0.12); }
  th { color: #64748b; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.04em;
       text-transform: uppercase; white-space: nowrap; }
  tr.baseline td { background: rgba(37, 99, 235, 0.06); }
  tr.baseline td:first-child { box-shadow: inset 3px 0 0 #2563eb; }
  .rate { font-weight: 600; white-space: nowrap; }
  .under { display: block; font-weight: 400; font-size: 0.72rem; color: #475569;
           margin-top: 2px; }
  .pills { display: flex; flex-wrap: wrap; gap: 4px; }
  .pill { border: 1px solid rgba(17, 24, 39, 0.18); border-radius: 999px;
          font-size: 0.72rem; padding: 1px 8px; white-space: nowrap; }
  /* The abstract sits under its cohort rather than in a fifth column, and is clamped to
     three lines. Five text columns do not fit this console: measured at 759px, the excerpt
     column squeezed the cohort summary into eleven lines and the provenance into six,
     which is a hedge maze rather than a table. The full excerpt is still in the payload and
     still in the export — only the drawing is clipped.

     The clamp lives here and not in the data, because a clamp is a layout decision; a
     reader who exports gets the whole text. */
  .excerpt { color: #475569; font-size: 0.78rem; margin-top: 6px;
             display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
             overflow: hidden; }
  .tier { color: #64748b; font-size: 0.72rem; margin-top: 4px; }
  /* An em dash, not an empty cell: the column is answered, and the answer is that the
     record names none of her drivers. A blank would read as a value that failed to load. */
  .none { color: #94a3b8; font-style: italic; }
  .pmid { font-size: 0.72rem; margin-top: 4px; white-space: nowrap; }
  .pmid a { color: inherit; }
  .note { color: #475569; font-size: 0.85rem; margin-bottom: 6px; }
`;

const ComparativeRiskMatrixApi = {
  name: 'ComparativeRiskMatrix',
  schema: z.object({
    // Absent when the turn had no estimate to pin. The row is then not drawn at all —
    // see `baseline_note` — because a pinned row with no figure in it is a claim about
    // this patient that says nothing.
    baseline: z.object({
      source: z.string(),
      probability: z.number(),
      threshold: z.number(),
      decision: z.number(),
      cohort: z.string(),
      provenance: z.string(),
    }).optional(),
    baseline_note: z.string().default(''),
    rows: z.array(z.object({
      pmid: z.string(),
      source: z.string(),
      reported_rate: z.string(),
      cohort_summary: z.string(),
      evidence_tier: z.string(),
      horizon_days: z.number(),
      url: z.string(),
      excerpt: z.string(),
    })).default([]),
  }).strict(),
};

class ComparativeRiskMatrixElement extends A2uiLitElement {
  static styles = [_MATRIX_STYLES, BLOCK_SETTLE];

  createController() {
    return new A2uiController(this, ComparativeRiskMatrixApi);
  }

  render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const baseline = props.baseline;
    const rows = props.rows || [];
    const horizon = rows.length ? `${rows[0].horizon_days}-day` : '';

    return html`
      ${baseline ? nothing : html`<div class="note">${props.baseline_note}</div>`}
      <div class="wrap">
        <table aria-label=${baseline
          ? `This patient and published ${horizon} readmission rates`
          : `Published ${horizon} readmission rates`}>
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Readmission rate</th>
              <th scope="col">Cohort</th>
            </tr>
          </thead>
          <tbody>
            ${baseline ? html`
              <tr class="baseline">
                <td>
                  ${baseline.source}
                  <div class="tier">${baseline.provenance}</div>
                </td>
                <td class="rate">
                  ${percent(baseline.probability)}
                  <span class="under">${bandLabel(baseline)}, threshold
                    ${percent(baseline.threshold)}</span>
                </td>
                <td>${baseline.cohort}</td>
              </tr>
            ` : nothing}
            ${rows.map((row) => html`
              <tr>
                <td>
                  ${row.source}
                  <div class="pmid">PMID <a href=${row.url || pubmedUrl(row.pmid)}
                    target="_blank" rel="noopener noreferrer">${row.pmid}</a></div>
                </td>
                <td class="rate">${row.reported_rate}
                  <span class="under">${row.horizon_days}-day</span></td>
                <td>
                  ${row.cohort_summary}
                  <div class="tier">${row.evidence_tier}</div>
                  <div class="excerpt">${row.excerpt}</div>
                </td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    `;
  }
}

export const ComparativeRiskMatrix = {
  ...ComparativeRiskMatrixApi, tagName: 'a2ui-comparative-risk-matrix',
};
customElements.define('a2ui-comparative-risk-matrix', ComparativeRiskMatrixElement);

// ---------------------------------------------------------------------------
// Lab trend card

//
// What a measurement did across the admission, one row per analyte. Phase 3 asks for a
// sparkline, a reference range, a delta and abnormal flags in a compact table, and the
// order they appear in is the order a reader needs them: what was measured, what normal is,
// where this patient sat against it, and how far they moved.
//
// The card is a GLANCE, not the record. Every value is in the export, and the row here
// carries the shape plus anything abnormal — because ten analytes times six timepoints is
// sixty numbers, and a card that printed all of them is one nobody reads.
//
// Provenance is stated once, by the turn rather than by the card. The reader sees
// the answer's own label — "Patient Chart Synthesis" — above this table, and the
// caveat that used to sit under it said the same thing a second time, while the
// per-row "scored"/"generated" markers asked the reader to decode two words that
// meant nothing to them. Provenance repeated three ways is not three guarantees; it
// is one guarantee and two distractions.
//
// The payload keeps `note` and `anchored`: the export and the eval read them, and
// which measures the model actually scored is a fact about the run. The card no
// longer draws either.

const _LAB_STYLES = css`
  :host { display: block; }
  table { border-collapse: collapse; width: 100%; font-size: 0.82rem; }
  th, td { text-align: left; vertical-align: middle; padding: 6px 10px;
           border-bottom: 1px solid rgba(17, 24, 39, 0.12); }
  th { color: #64748b; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.04em;
       text-transform: uppercase; white-space: nowrap; }
  .measure { font-weight: 600; white-space: nowrap; }
  .unit { display: block; font-weight: 400; font-size: 0.72rem; color: #64748b;
          margin-top: 2px; }
  .reference { white-space: nowrap; color: #475569; }
  .course { min-width: 12rem; }
  .spark { display: block; }
  .band { fill: rgba(37, 99, 235, 0.10); }
  .line { fill: none; stroke: #1f2937; stroke-width: 1.6;
          stroke-linejoin: round; stroke-linecap: round; }
  .dot { fill: #1f2937; }
  .dot.abnormal { fill: #b91c1c; }
  .delta { font-size: 0.72rem; color: #475569; margin-top: 4px; }
  .flags { display: flex; flex-wrap: wrap; gap: 4px; }
  .flag { border-radius: 4px; font-size: 0.68rem; font-weight: 600; padding: 1px 6px;
          white-space: nowrap; }
  .flag.low, .flag.high { background: rgba(180, 83, 9, 0.12); color: #92400e; }
  .flag.critical { background: rgba(185, 28, 28, 0.12); color: #b91c1c; }
  .normal { color: #64748b; font-size: 0.72rem; }
`;

const LabTrendCardApi = {
  name: 'LabTrendCard',
  schema: z.object({
    trends: z.array(z.object({
      key: z.string(),
      label: z.string(),
      unit: z.string(),
      reference_low: z.number(),
      reference_high: z.number(),
      decimals: z.number(),
      // The feature-row keys this series reproduces. Empty means the model never scored
      // this measure, which is what the row's marker reports.
      anchored: z.array(z.string()).default([]),
      series: z.array(z.object({
        day: z.number(),
        value: z.number(),
        flag: z.string(),
      })).default([]),
    })).default([]),
    synthetic: z.boolean().default(false),
    note: z.string().default(''),
  }).strict(),
};

/** The flag vocabulary, as the letter or word a reader is shown. */
const FLAG_TEXT = {
  low: 'L',
  high: 'H',
  critical_low: 'Critical low',
  critical_high: 'Critical high',
};

const _isAbnormal = (flag) => flag && flag !== 'normal';

/**
 * The course as a sparkline, with the reference interval shaded behind it.
 *
 * The vertical scale is the reference band UNION the values, never the band alone: a
 * critical value outside the interval has to be visible as a departure from the band rather
 * than clipped to the edge of the drawing, because the departure is the finding.
 */
function sparkline(series, low, high, decimals, label) {
  const values = series.map((point) => Number(point.value));
  const lo = Math.min(low, ...values);
  const hi = Math.max(high, ...values);
  const span = (hi - lo) || 1;
  const width = 104;
  const height = 26;
  const pad = 3;
  const x = (index) => pad + (index / Math.max(series.length - 1, 1)) * (width - 2 * pad);
  const y = (value) => height - pad - ((value - lo) / span) * (height - 2 * pad);
  const bandTop = y(high);
  const bandHeight = Math.max(y(low) - y(high), 1);
  const points = values.map((value, index) =>
    x(index).toFixed(1) + ',' + y(value).toFixed(1)).join(' ');
  const spoken = label + ' across ' + series.length + ' timepoints, from '
    + values[0].toFixed(decimals) + ' to ' + values[values.length - 1].toFixed(decimals);

  return html`
    <svg class="spark" viewBox=${'0 0 ' + width + ' ' + height}
         width=${width} height=${height} role="img" aria-label=${spoken}>
      <rect class="band" x="0" y=${bandTop} width=${width} height=${bandHeight}></rect>
      <polyline class="line" points=${points}></polyline>
      ${values.map((value, index) => html`
        <circle class="dot ${_isAbnormal(series[index].flag) ? 'abnormal' : ''}"
                cx=${x(index)} cy=${y(value)} r="1.8"></circle>`)}
    </svg>
  `;
}

class LabTrendCardElement extends A2uiLitElement {
  static styles = [_LAB_STYLES, BLOCK_SETTLE];

  createController() {
    return new A2uiController(this, LabTrendCardApi);
  }

  render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const trends = props.trends || [];
    if (!trends.length) return nothing;

    return html`
      <table>
        <thead>
          <tr>
            <th scope="col">Measurement</th>
            <th scope="col">Reference</th>
            <th scope="col">Course</th>
            <th scope="col">Flags</th>
          </tr>
        </thead>
        <tbody>
          ${trends.map((trend) => {
            const series = trend.series || [];
            const values = series.map((point) => Number(point.value));
            const first = values[0];
            const last = values[values.length - 1];
            const direction = last > first ? 'higher' : (last < first ? 'lower' : 'unchanged');
            const abnormal = series.filter((point) => _isAbnormal(point.flag));
            const counts = {};
            abnormal.forEach((point) => {
              const key = point.flag.startsWith('critical') ? 'critical' : point.flag;
              counts[key] = (counts[key] || 0) + 1;
            });
            return html`
              <tr>
                <td class="measure">
                  ${trend.label}
                  <span class="unit">${trend.unit}</span>
                </td>
                <td class="reference">${trend.reference_low}–${trend.reference_high}</td>
                <td class="course">
                  ${sparkline(series, trend.reference_low, trend.reference_high,
                              trend.decimals, trend.label)}
                  <div class="delta">
                    ${first.toFixed(trend.decimals)} → ${last.toFixed(trend.decimals)}
                    (${direction}), ${series.length} points over ${series[series.length - 1].day} days
                  </div>
                </td>
                <td>
                  ${abnormal.length
                    ? html`<div class="flags">${Object.keys(counts).map((key) => html`
                        <span class="flag ${key}">${FLAG_TEXT[key] || key}${
                          counts[key] > 1 ? ' ×' + counts[key] : ''}</span>`)}</div>`
                    : html`<span class="normal">Within range</span>`}
                </td>
              </tr>
            `;
          })}
        </tbody>
      </table>
    `;
  }
}

export const LabTrendCard = {
  ...LabTrendCardApi, tagName: 'a2ui-lab-trend',
};
customElements.define('a2ui-lab-trend', LabTrendCardElement);

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
  static styles = [_MEDS_STYLES, BLOCK_SETTLE];

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
      ['ComparativeRiskMatrix', ComparativeRiskMatrix],
      ['LabTrendCard', LabTrendCard],
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
