/** Shared vocabulary for the clinical components.

    The catalog id, the formatting rules every widget agrees on, the settle animation a
    block arrives with, and the citation marker the prose and the comparative table both
    draw. Nothing here renders: a component imports what it needs and owns its own
    element, so the two citation surfaces cannot drift into two shapes for one idea.
    */

import { css } from 'lit';

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

// The citation pill, in one sheet because two surfaces draw it.
//
// It began as the inline marker's own style, defined inside the narrative's stylesheet. The
// comparative table now cites the cohort its own figures come from, and a pill there has to
// be the SAME pill: a reader who has learned that a rounded grey badge opens a source card
// must not meet a second shape for the same idea one component down.
const CITE_STYLES = css`
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

/**
 * Bind a shadow root's citation pills to one popover.
 *
 * Two surfaces draw the same control — the inline markers in an answer's prose, and the
 * pill beside the cohort a comparison table drew — and the gestures around it are not
 * obvious enough to be worth writing twice: a pointer that rests opens the card, a pointer
 * that crosses does not, a caret that arrives opens it without waiting, and a click pins
 * what the other two opened. Written once here, so a fix to any of that lands on both.
 *
 * `resolve(button)` returns the citation behind a pill, or null. What a pill NAMES differs
 * — a prose marker names a citation by position, a table pill names a registered source —
 * and that is the caller's business; everything after the lookup is identical.
 *
 * `popover()` returns the `citation-popover` element, or null before the first render.
 */
function bindCitationMarkers(root, popover, resolve) {
  const marker = (event) => event.target.closest?.('button.cite:not([disabled])') || null;
  const citationFor = (button) => (button ? resolve(button) : null);

  root.addEventListener('click', (event) => {
    const button = marker(event);
    const citation = citationFor(button);
    const card = popover();
    if (!citation || !card) return;
    card.toggle(citation, button);
  });

  root.addEventListener('pointerover', (event) => {
    const button = marker(event);
    const citation = citationFor(button);
    const card = popover();
    // The pointer is crossing a sentence on its way somewhere else more often than it is
    // stopping, so the card waits for the rest to become an intention.
    if (citation && card) card.scheduleOpen(citation, button, { via: 'hover' });
  });

  root.addEventListener('pointerout', (event) => {
    if (marker(event)) popover()?.scheduleClose();
  });

  root.addEventListener('focusin', (event) => {
    const button = marker(event);
    const citation = citationFor(button);
    const card = popover();
    // No intent delay on the keyboard: arriving by Tab already is the intent, and a card
    // that appeared 150 ms later would only look like it had lagged.
    if (citation && card) card.scheduleOpen(citation, button, { via: 'focus', delay: 0 });
  });

  root.addEventListener('focusout', (event) => {
    if (!marker(event)) return;
    // Focus moving INTO the card is a reader reading it. It retargets to the card's host on
    // the way out of that element's shadow tree, which is why the host is tested as well as
    // its descendants.
    const card = popover();
    const next = event.relatedTarget;
    if (next && (next === card || card?.contains(next))) return;
    card?.scheduleClose();
  });
}


export {
  BAND_HUE, BLOCK_SETTLE, CITE_STYLES, MARKER,
  bandLabel, bindCitationMarkers, isAboveThreshold, percent, pubmedUrl,
};
