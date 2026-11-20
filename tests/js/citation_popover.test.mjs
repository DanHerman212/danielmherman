/* The citation card, opened the way a reader actually opens it.

   The card used to answer one gesture: a click. A footnote is read by resting on it,
   though, and by tabbing to it — and a card that a reader has to click is a card most
   readers never see. So the popover now opens on `pointerover` and `focusin`, closes on
   the pointer leaving, and waits 150 ms at each boundary.

   That delay is the substance of the change, not a detail of it. There are a few pixels
   between a marker and the card beneath it, and a card that closed the instant the
   pointer left the marker would be gone before the hand moving into it arrived. Three
   of the tests below are about that window: the card does NOT open on a crossing, it
   does NOT close while the pointer is inside it, and a click pins it against both.

   Also asserted: the card's own shape — an eyebrow, a way to the full list, the title
   numbered once, the source beneath it — and the whitespace seam, where a marker that
   arrived detached from its sentence-ending period is set back against it. */

import { JSDOM } from 'jsdom';
import test from 'node:test';
import assert from 'node:assert/strict';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://danielmherman.test/',
});

// Installed before the bundle is imported, because the bundle's module scope registers
// custom elements and its base class reads these the moment it is evaluated.
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

// Imported for its side effect: the module's scope registers the custom elements.
await import('../../static/js/a2ui_clinical_components.js');

const CITATIONS = [
  { index: 1, source: 'Discharge note', title: 'Hospital course', excerpt: 'Improved.' },
  { index: 2, source: 'Discharge note', title: 'Medications' },
];

function mount(text, citations = CITATIONS) {
  const element = document.createElement('a2ui-cited-narrative');
  element._markdown = { value: (source) => Promise.resolve(`<p>${source}</p>`) };
  element.controller = { props: { text, citations } };
  document.body.appendChild(element);
  return element;
}

async function settle(element) {
  await element.updateComplete;
  await element.updateComplete;
}

/** A gesture, as jsdom can express one: the type is what the listener matches on. */
function fire(node, type) {
  node.dispatchEvent(new dom.window.Event(type, { bubbles: true, cancelable: true }));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Longer than the component's intent and grace delays, so a pending one has run. */
const AFTER_DELAY = 220;

/** The rendered card, or null while the popover holds no citation. */
const cardOf = (popover) => popover.renderRoot.querySelector('.popover');

async function opened(text = 'Admitted^[1] and treated^[2]', citations = CITATIONS) {
  const element = mount(text, citations);
  await settle(element);
  const marker = element.shadowRoot.querySelector('button.cite[data-cite="1"]');
  const popover = element.shadowRoot.querySelector('citation-popover');
  return { element, marker, popover, card: () => cardOf(popover) };
}

test('a pointer crossing a marker does not open its card', async () => {
  const { marker, card } = await opened();

  fire(marker, 'pointerover');

  assert.equal(card(), null, 'the card opened on a pointer merely crossing the marker');
});

test('resting on a marker opens its card, and leaving closes it', async () => {
  const { marker, card } = await opened();

  fire(marker, 'pointerover');
  await wait(AFTER_DELAY);
  assert.ok(card(), 'the card never opened for a pointer that rested on the marker');
  assert.equal(marker.getAttribute('aria-expanded'), 'true');

  fire(marker, 'pointerout');
  await wait(AFTER_DELAY);
  assert.equal(card(), null, 'the card stayed open after the pointer left');
  assert.equal(marker.getAttribute('aria-expanded'), 'false');
});

test('the card survives the pointer moving off the marker and into it', async () => {
  const { marker, card } = await opened();

  fire(marker, 'pointerover');
  await wait(AFTER_DELAY);
  assert.ok(card());

  // The gesture that a naive `pointerout` handler destroys: off the marker, across the
  // gap, onto the card — all inside the grace period.
  fire(marker, 'pointerout');
  fire(card(), 'pointerenter');

  await wait(AFTER_DELAY);
  assert.ok(card(), 'the card closed while the pointer was inside it');
});

test('a click pins the card the pointer opened, and a second click dismisses it', async () => {
  const { element, marker, card } = await opened();

  fire(marker, 'pointerover');
  await wait(AFTER_DELAY);
  assert.ok(card());

  // Claiming a card that is already showing must not close it under the cursor.
  fire(marker, 'click');
  fire(marker, 'pointerout');
  await wait(AFTER_DELAY);
  assert.ok(card(), 'a claimed card closed when the pointer left it');

  fire(marker, 'click');
  await settle(element);
  assert.equal(card(), null, 'a second click did not dismiss the card');
});

test('focus opens the card without the intent delay', async () => {
  const { marker, card } = await opened();

  fire(marker, 'focusin');
  await wait(20);

  assert.ok(card(), 'focus did not open the card');
  assert.equal(marker.getAttribute('aria-expanded'), 'true');
});

test('the card names the reference, its source and the passage', async () => {
  const { marker, card } = await opened();

  fire(marker, 'focusin');
  await wait(20);

  const text = card().textContent;
  assert.match(text, /Reference/);
  assert.match(text, /See all references/);
  // Numbered once, here — the card is the only place the reader sees this number again.
  assert.match(text, /1\.\s*Hospital course/);
  assert.match(text, /Discharge note/);
  assert.match(text, /Improved\./);
});

test('the card hands the reader to the full list and gets out of the way', async () => {
  const { element, marker, popover, card } = await opened();
  const seen = [];
  element.addEventListener('citation-see-all', (event) => seen.push(event));

  fire(marker, 'focusin');
  await wait(20);
  card().querySelector('.see-all').click();
  await popover.updateComplete;

  assert.equal(seen.length, 1, 'the card did not announce the request');
  // Composed and bubbling, because it has two shadow boundaries to cross before the turn
  // that owns the list can hear it.
  assert.equal(seen[0].bubbles, true);
  assert.equal(seen[0].composed, true);
  assert.equal(card(), null, 'the card stayed open on top of the list it was sent to');
});

/* A passage long enough that the card is showing less than the record holds, which is the
   only case the foot of the card has anything to say. */
const LONG_EXCERPT = 'The patient was admitted with decompensated heart failure and '
  + 'diuresed to a net negative of four litres over three days, with conversion to oral '
  + 'diuretic therapy before discharge. Renal function remained stable throughout and '
  + 'potassium was repleted twice, the second time on the morning of discharge after a '
  + 'level of 3.1. She walked the length of the corridor unaided on the final day, was '
  + 'tolerating a regular diet, and was discharged home with a daily weight chart and a '
  + 'follow-up appointment in the heart failure clinic two weeks later.';

test('the foot of the card is the way to the full passage, not an instruction to find one',
     async () => {
       /* The footer used to be an italic sentence — "Excerpt shown — click ‘See all
          references’ for full text" — which tells the reader where the button is instead
          of being it. The card already knows the reader wants the rest of the passage, so
          the footer is now the control that takes them to it, and it lands on the row
          already open (2026-11-20). */
       const { element, marker, popover, card } = await opened('Admitted^[1]', [{
         index: 1,
         source: 'Discharge note',
         title: 'Hospital course',
         excerpt: LONG_EXCERPT,
       }]);

       fire(marker, 'focusin');
       await wait(20);

       const seen = [];
       element.addEventListener('citation-see-all', (event) => seen.push(event));

       const footer = card().querySelector('.disclosure');
       assert.ok(footer, 'a card showing an excerpt carried no way to the full passage');
       assert.equal(footer.tagName, 'BUTTON',
                    'the footer is a sentence where the action belongs');
       assert.match(footer.textContent, /full passage/i);

       footer.click();
       await popover.updateComplete;

       assert.equal(seen.length, 1, 'the footer did not announce the request');
       assert.equal(seen[0].detail.index, 1, 'the request named no citation');
       assert.equal(card(), null, 'the card stayed open on top of the list it was sent to');
     });

test('a passage shown whole carries no cue about truncation', async () => {
  const { marker, card } = await opened();

  fire(marker, 'focusin');
  await wait(20);

  assert.equal(card().querySelector('.disclosure'), null,
               'a caveat about truncation was shown over text that was never truncated');
});

test('a marker that arrived detached from its full stop is set back against it', async () => {
  const element = mount('Discontinued ^[1] . Next sentence.');
  await settle(element);

  const marker = element.shadowRoot.querySelector('button.cite[data-cite="1"]');
  assert.equal(marker.nextSibling.nodeValue, '. Next sentence.',
               'the gap between the pill and its period is still on screen');
});

test('whitespace that is a word gap is left alone', async () => {
  const element = mount('Admitted ^[1] and treated.');
  await settle(element);

  const marker = element.shadowRoot.querySelector('button.cite[data-cite="1"]');
  assert.equal(marker.nextSibling.nodeValue, ' and treated.');
});
