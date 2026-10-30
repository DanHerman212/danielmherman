/** The evidence card behind one citation marker. */

import { html, css, nothing, LitElement } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

import { pubmedUrl } from './shared.js';

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
  .title a { color: inherit; text-decoration: none; }
  .title a:hover { text-decoration: underline; }
  /* The card is 340px wide, so the citation line is allowed to read as a citation and
     wrap: a full journal name, its year, three authors and the identifier do not fit on
     one line, and truncating them would leave the reader unable to cite the paper. */
  .subtitle { margin: 3px 0 0; font-size: 0.76rem; color: #64748b; line-height: 1.4; }
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
    //: Where the card lives when it is not open, so it can be put back there.
    this._home = null;
    this._next = null;
    //: True for the instant a re-parenting is in flight.
    this._moving = false;
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
    // Out of the tree that would clip it, before it is measured.
    this._detach();

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
    this._reattach();

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
    // The PATH, not the target. A listener out here is handed the retargeted target —
    // for a click on this card's own button that is the `<citation-popover>` host, and a
    // node does not contain itself. Testing `this.contains(event.target)` therefore said
    // "outside" for every pointerdown INSIDE the card: the card closed on mousedown, the
    // button was unmounted before mouseup, and the click that would have taken the reader
    // to the reference list never happened. Reported as "the link does nothing".
    //
    // `composedPath()` is the real path — it names the inner button, this card and the
    // marker — and it is the only one that survives being three shadow trees deep.
    const path = event.composedPath();
    if (path.includes(this) || path.includes(this._anchor)) return;
    this.close({ returnFocus: false });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // A move, not a teardown: see `_detach`.
    if (this._moving) return;
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
  seeAll(event) {
    // The button is inside the card and the card sits inside a dialog the page listens
    // to; neither wants this click counted as "somewhere else".
    event?.preventDefault();
    event?.stopPropagation();
    // Raised from the ANCHOR, not from the card. While it is open the card is parented to
    // the document (see `_detach`), so an event raised here would travel body → html and
    // never pass through the turn that owns the reference list. The marker is still where
    // the reader clicked, and it is inside the shadow trees the event has to cross.
    const origin = this._anchor || this;
    origin.dispatchEvent(new CustomEvent('citation-see-all', {
      bubbles: true,
      composed: true,
      detail: { index: this.citation?.index ?? null },
    }));
    // Focus goes with the reader: the turn moves it to the list it has just opened, so
    // returning it to the marker first would be two moves for one intent.
    this.close({ returnFocus: false });
  }

  /**
   * Move the card out of whatever shadow tree it was rendered in, while it is open.
   *
   * A `position: fixed` box is positioned against the viewport — until an ancestor
   * establishes a containing block, at which point it is positioned against THAT box and
   * clipped by its overflow. Two ancestors here do exactly that: the block settle
   * animation runs a `transform` on every card as it mounts, and the comparison table
   * scrolls its own wrapper. A popover opened inside either one is drawn in the wrong
   * place or not drawn at all.
   *
   * Parenting the open card to the document body takes it out of every such ancestor at
   * once, which is the standard answer and the one that cannot be surprised by an
   * ancestor added later. It goes back where it came from on close: the component that
   * rendered it still owns it, and Lit holds a reference to this very node.
   */
  _detach() {
    if (this._home) return;
    this._home = this.parentNode;
    this._next = this.nextSibling;
    // Re-parenting is a disconnection as far as the element is concerned, and
    // `disconnectedCallback` closes the card. This is the one move that must not.
    this._moving = true;
    document.body.appendChild(this);
    this._moving = false;
  }

  _reattach() {
    if (!this._home) return;
    this._moving = true;
    this._home.insertBefore(this, this._next || null);
    this._moving = false;
    this._home = null;
    this._next = null;
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
                  @click=${(event) => this.seeAll(event)}>See all references ↓</button>
          <button class="close" type="button" aria-label="Close citation"
                  @click=${() => this.close()}>×</button>
        </div>
        <div class="body">
          <p class="title">${citation.index}. ${citation.url
            ? html`<a href=${citation.url} target="_blank"
                     rel="noopener noreferrer">${citation.title}</a>`
            : citation.title}</p>
          <p class="subtitle">${citation.source}</p>
          ${citation.excerpt ? html`<p class="excerpt">${citation.excerpt}</p>` : nothing}
        </div>
      </div>
    `;
  }
}

customElements.define('citation-popover', CitationPopoverElement);

