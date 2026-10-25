/* The narrative component, executed in a DOM.

   This is the layer Phase 5 could not have. That phase's deliverable was browser code and
   every gate it had read the source as text; the honest statement in its record was that
   no test ran a line of the bundle. `jsdom` closes that gap for the one component this
   phase changes, and for the one contract this phase deletes.

   Two things are asserted. That the schema no longer accepts a `streaming` prop — the key
   that no caller could set true, removed from the wire in the same change — and that the
   component's own behaviour still holds without it: prose rendered, every marker resolved
   to a control, `revealCitation` finding its own node and taking the highlight back.

   The component's props normally arrive from an A2UI surface through a bound context.
   Here they are assigned directly, which skips the surface and exercises the part under
   test — the render, the marker decoration and the reveal — without standing up a
   renderer. */

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

// jsdom does not implement matchMedia or scrolling. The component reads the first to
// decide between smooth and instant and calls the second on its own marker; both are
// stubbed rather than asserted, because neither is this component's logic.
if (!dom.window.matchMedia) {
  dom.window.matchMedia = () => ({
    matches: false, addEventListener() {}, removeEventListener() {},
  });
}
dom.window.Element.prototype.scrollIntoView = function scrollIntoView() {};

const bundle = await import('../../static/js/a2ui_clinical_components.js');

const CITATIONS = [
  { index: 1, source: 'Discharge note', title: 'Hospital course', excerpt: 'Improved.' },
  { index: 2, source: 'Discharge note', title: 'Medications' },
];

function mount(text, citations = CITATIONS) {
  const element = document.createElement('a2ui-cited-narrative');
  // The markdown provider normally arrives from the surface's context. Here it is a
  // stand-in that wraps the text in one paragraph: enough for the component to reach its
  // rendered-DOM path, which is the part under test. The markers survive it and are then
  // decorated exactly as they would be in the page.
  element._markdown = { value: (source) => Promise.resolve(`<p>${source}</p>`) };
  element.controller = { props: { text, citations } };
  document.body.appendChild(element);
  return element;
}

/* Two updates: the first draws the shell, the async render resolves and asks for the
   second, which is the one that has prose in it. */
async function settle(element) {
  await element.updateComplete;
  await element.updateComplete;
}

test('the narrative no longer accepts a streaming prop', () => {
  const schema = bundle.CitedNarrative.schema;

  assert.equal(schema.safeParse({ text: 'A', citations: [] }).success, true);
  // The key is gone from the contract, not merely ignored: the schema is strict, so a
  // payload still carrying it fails here rather than in a browser.
  assert.equal(schema.safeParse({ text: 'A', citations: [], streaming: false }).success,
               false);
});

test('the prose is rendered and every marker becomes a control', async () => {
  const element = mount('Admitted^[1] and treated^[2]');
  await settle(element);

  const prose = element.shadowRoot.querySelector('.prose');
  assert.ok(prose, 'no prose was rendered');
  // The provider is absent in this harness, so the component draws its source text —
  // which is exactly what the marker decoration operates on.
  assert.match(prose.textContent, /Admitted/);

  const markers = element.shadowRoot.querySelectorAll('button.cite');
  assert.equal(markers.length, 2);
  assert.deepEqual([...markers].map((node) => node.dataset.cite), ['1', '2']);
  assert.equal(prose.textContent.includes('^['), false, 'raw marker syntax on screen');
});

test('an unresolvable marker is drawn disabled rather than dropped', async () => {
  const element = mount('Admitted^[1] and nothing^[7]');
  await settle(element);

  const missing = element.shadowRoot.querySelector('button.cite.missing');
  assert.ok(missing, 'a marker with no citation behind it was dropped');
  assert.equal(missing.disabled, true);
});

test('revealCitation highlights its own marker and reports having done so', async () => {
  const element = mount('Admitted^[1] and treated^[2]');
  await settle(element);

  assert.equal(element.revealCitation(1), true);

  const marker = element.shadowRoot.querySelector('button.cite[data-cite="1"]');
  assert.ok(marker.classList.contains('is-target'));
  // The highlight belongs to a class this component's own stylesheet defines, so nothing
  // is written into the node's style attribute.
  assert.equal(marker.getAttribute('style'), null);

  assert.equal(element.revealCitation(99), false, 'a marker that does not exist');
});

test('the highlight is taken back on the component\'s own timer', async () => {
  const element = mount('Admitted^[1]');
  await settle(element);
  element.revealCitation(1);

  const marker = element.shadowRoot.querySelector('button.cite[data-cite="1"]');
  assert.ok(marker.classList.contains('is-target'));

  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(marker.classList.contains('is-target'), false);
});

test('the component announces itself once, across both shadow boundaries', async () => {
  const seen = [];
  document.body.addEventListener('a2ui-cited-narrative-ready', (event) => {
    seen.push(event);
  });

  const element = mount('Admitted^[1]');
  await settle(element);
  element.requestUpdate();
  await element.updateComplete;

  assert.equal(seen.length, 1, 'the ready event fired more than once');
  assert.equal(seen[0].bubbles, true);
  assert.equal(seen[0].composed, true);
  assert.equal(seen[0].detail.element, element);
});
