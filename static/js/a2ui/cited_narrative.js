/** The prose: a settled answer with its citation markers bound to controls. */

import { html, css, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { A2uiController, A2uiLitElement, Context } from '@a2ui/lit/v0_9';
import { ContextConsumer } from '@lit/context';
import z from 'zod';

import { CITE_STYLES, MARKER, bindCitationMarkers } from './shared.js';

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
`;

/** Props: the prose, and the evidence its markers point at. */
const CitedNarrativeApi = {
  name: 'CitedNarrative',
  schema: z.object({
    text: z.string(),
    citations: z.array(z.object({
      index: z.number(),
      source: z.string(),
      title: z.string(),
      // What the pill reads. Resolved on the server so the clinical and the bibliographic
      // vocabulary both live in one module; a payload without it falls back to the number.
      label: z.string().optional(),
      // The line under the title on a published record — `Journal. Year. Authors. · PMID`
      // — so the card can be read as a citation rather than as a headline.
      subtitle: z.string().optional(),
      authors: z.string().optional(),
      journal_citation: z.string().optional(),
      // Present on a literature citation, whose card links out to the record as well as
      // naming it. The marker itself no longer links out: one gesture, one surface.
      pmid: z.string().optional(),
      excerpt: z.string().optional(),
      url: z.string().optional(),
    })).default([]),
  }).strict(),
};

class CitedNarrativeElement extends A2uiLitElement {
  // The narrative's own sheet, then the pill's: the pill rules are shared with the
  // comparative table, and appending them keeps the cascade the same as it was when they
  // were written inline above.
  static styles = [NARRATIVE_STYLES, CITE_STYLES];

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
      // One delegated binding for the whole shadow root. The markers are created after the
      // render and replaced on every update, so per-button listeners would have to be
      // re-attached each time and would leak when they were not. The gestures themselves
      // live in `bindCitationMarkers`, because the comparison table draws the same pill.
      bindCitationMarkers(
        this.renderRoot,
        () => this._popover,
        (button) => this._citationBehind(button),
      );
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
    // module: `1 · Hospital Course` on a note turn, `1 · World neurosurgery · 2024` on a
    // literature turn. The fallbacks are for a payload from an agent that predates the
    // label — a bare number still answers its popover, so nothing breaks, it just reads
    // the way it used to.
    const label = citation?.label || citation?.pmid || digits;

    /* One control, whatever the citation is a citation to (Phase F, 2026-10-26).
     *
     * A published record used to be rendered as an anchor straight to PubMed, on the
     * reasoning that the record is the primary evidence and the shortest path is the
     * useful one. The cost was that a literature turn was the only turn in the product
     * whose pills did not open a card: the same `^[n]` gesture meant "read the passage
     * here" on a note turn and "leave the page" on a literature turn, and the reference
     * list at the foot of the turn never drew the papers it was summarising.
     *
     * The card is the destination now, and the trip to PubMed is inside it — the title is
     * the link, which is where a reader who wants the paper looks first. The marker keeps
     * its identifier so the gesture is still discoverable as "open this source". */
    const button = document.createElement('button');
    button.type = 'button';
    button.className = citation ? 'cite' : 'cite missing';
    button.dataset.cite = citation ? String(citation.index) : digits;
    button.textContent = label;
    if (citation) {
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-expanded', 'false');
      // A clickable label is not also a tooltip: a native `title` draws the browser's own
      // dark box over the card this pill opens, which is the tooltip a reader reported
      // seeing INSTEAD of the card. The accessible name still says what it opens.
      button.setAttribute('aria-label', citation.pmid
        ? `Reference ${citation.index}, PMID ${citation.pmid}: ${citation.title}`
        : `Reference ${citation.index}: ${citation.title}`);
    } else {
      button.disabled = true;
      button.setAttribute('aria-label', 'No matching citation in this response');
    }
    return button;
  }

  /** The citation a marker names, resolved by position as the marker itself is. */
  _citationBehind(button) {
    const citations = this.controller?.props?.citations || [];
    return citations.find(
      (entry) => Number(entry.index) === Number(button.dataset.cite)) || null;
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

