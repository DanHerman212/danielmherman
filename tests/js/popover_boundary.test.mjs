/* "See all references" has to leave the shadow trees it is rendered in.

   The link lives inside `<citation-popover>`, which lives inside the narrative's shadow
   root, which lives inside the turn. The event is composed, so the boundary was never the
   problem: the card was being CLOSED before the click ever landed. `_onPointerDown` runs
   on `document` in the capture phase, and it decided "outside" by testing
   `this.contains(event.target)` — but a listener outside a shadow tree is handed the
   RETARGETED target, i.e. the `<citation-popover>` host itself, and a node does not
   contain itself. Every pointerdown inside the card read as a click elsewhere, the card
   closed, the button was unmounted, and the click never happened.

   So this file drives the real path: a pointerdown on the real button, then the click,
   then a listener on the light-DOM container — the turn — standing in for
   `showReference`. It fails on the pointerdown alone, and that is the whole test. */

import { JSDOM } from 'jsdom';
import test from 'node:test';
import assert from 'node:assert/strict';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://danielmherman.test/',
});

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.NodeFilter = dom.window.NodeFilter;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;
globalThis.DocumentFragment = dom.window.DocumentFragment;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);

if (!dom.window.matchMedia) {
  dom.window.matchMedia = () => ({
    matches: false, addEventListener() {}, removeEventListener() {},
  });
}
dom.window.Element.prototype.scrollIntoView = function scrollIntoView() {};

await import('../../static/js/a2ui_clinical_components.js');

const CITATIONS = [
  { index: 1, source: 'Discharge note', title: 'Hospital course', excerpt: 'Improved.' },
];

/** A turn: the light-DOM container, a drawer, and the narrative inside it. */
async function turn() {
  const host = document.createElement('div');
  host.className = 'cp-turn';
  const drawer = document.createElement('details');
  drawer.className = 'cp-references';
  const list = document.createElement('ol');
  const row = document.createElement('li');
  row.className = 'cp-reference-item';
  row.dataset.referenceIndex = '1';
  const head = document.createElement('button');
  head.className = 'cp-reference-head';
  head.textContent = 'Hospital course';
  row.appendChild(head);
  list.appendChild(row);
  drawer.appendChild(list);
  host.appendChild(drawer);
  document.body.appendChild(host);

  // Exactly what `copilot_canvas.js` does with the event.
  const seen = [];
  host.addEventListener('citation-see-all', (event) => {
    const index = (event.detail || {}).index;
    seen.push(index);
    drawer.open = true;
    const target = drawer.querySelector(`[data-reference-index="${index}"]`);
    if (target) target.classList.add('is-target');
  });

  const narrative = document.createElement('a2ui-cited-narrative');
  narrative._markdown = { value: (source) => Promise.resolve(`<p>${source}</p>`) };
  narrative.controller = { props: { text: 'Admitted^[1]', citations: CITATIONS } };
  host.appendChild(narrative);
  await narrative.updateComplete;
  await narrative.updateComplete;

  const marker = narrative.shadowRoot.querySelector('button.cite[data-cite="1"]');
  const popover = narrative.shadowRoot.querySelector('citation-popover');
  return { host, drawer, row, seen, marker, popover };
}

const fire = (node, type) => node.dispatchEvent(
  new dom.window.Event(type, { bubbles: true, composed: true, cancelable: true }));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openCard(marker, popover) {
  fire(marker, 'pointerover');
  await wait(220);
  return popover.renderRoot.querySelector('.popover');
}

test('a pointerdown inside the card does not dismiss it', async () => {
  const { marker, popover } = await turn();
  const card = await openCard(marker, popover);
  assert.ok(card, 'the card never opened');

  const seeAll = card.querySelector('.see-all');
  fire(seeAll, 'pointerdown');

  assert.equal(popover.renderRoot.querySelector('.popover'), card,
               'the card was closed by a pointerdown on its own button');
});

test('the link opens the drawer and marks the row it named', async () => {
  const { drawer, row, seen, marker, popover } = await turn();
  const card = await openCard(marker, popover);

  const seeAll = card.querySelector('.see-all');
  fire(seeAll, 'pointerdown');
  seeAll.click();

  assert.deepEqual(seen, [1], 'the request never reached the turn');
  assert.equal(drawer.open, true, 'the drawer was left closed');
  assert.equal(row.classList.contains('is-target'), true,
               'the row it named was not marked');
  await popover.updateComplete;
  assert.equal(popover.renderRoot.querySelector('.popover'), null,
               'the card stayed open on top of the list it sent the reader to');
});

test('the card is moved out of its shadow tree while it is open', async () => {
  // A fixed-position card is positioned against the viewport — until an ancestor
  // establishes a containing block (the mount animation's transform does exactly that)
  // and the card is placed against THAT box and clipped by its overflow. Parenting the
  // open card to the document takes it out of every such ancestor at once.
  const { marker, popover } = await turn();

  assert.notEqual(popover.parentNode, document.body, 'the card was detached at rest');

  const card = await openCard(marker, popover);
  assert.ok(card);
  assert.equal(popover.parentNode, document.body,
               'the open card is still inside the tree that clips it');

  popover.close({ returnFocus: false });
  await popover.updateComplete;
  assert.notEqual(popover.parentNode, document.body,
                  'the card was not put back where it came from');
});
