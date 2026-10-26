/* The comparison table's cohort, cited from inside the table.

   The matrix draws curated PubMed cohorts beside this patient's estimate. It named a
   journal, a year and a PMID on screen and the turn held no record of any of them: the
   references drawer listed the note sections and the cohort the whole comparison rests on
   could not be opened from the table that showed it.

   Phase B registers each benchmark as a source and stamps the row with the number it
   assigned. This is the surface half: the row renders the same pill the prose uses, bound
   to that number, opening the same card — title, identifier and tier as the subtitle, the
   cohort and the sentence the rate was read from as the passage — and its "See all
   references" link, which the turn answers by opening the drawer at row 5.

   Runs the real component in a DOM. The props normally arrive from an A2UI surface through
   a bound context; here they are assigned directly, which skips the surface and exercises
   the render and the gestures. */

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

const ROW = {
  pmid: '34793857',
  source: 'The Journal of Arthroplasty · 2022',
  reported_rate: '3.4%',
  cohort_summary: 'Elective primary total knee arthroplasty, single institution, 2015-2019.',
  evidence_tier: 'Retrospective Cohort',
  horizon_days: 30,
  url: 'https://pubmed.ncbi.nlm.nih.gov/34793857/',
  excerpt: 'The 30-day readmission rate was 3.4%.',
  source_index: 5,
  source_label: '5 · The Journal of Arthroplasty · 2022',
};

function mount(rows = [ROW]) {
  const element = document.createElement('a2ui-comparative-risk-matrix');
  element.controller = { props: { rows, baseline_note: '' } };
  document.body.appendChild(element);
  return element;
}

const settle = async (element) => {
  await element.updateComplete;
  await element.updateComplete;
};

const pillOf = (element) => element.shadowRoot.querySelector('button.cite');
const cardOf = (element) =>
  element.shadowRoot.querySelector('citation-popover').renderRoot
    .querySelector('.popover');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fire = (node, type) => node.dispatchEvent(
  new dom.window.Event(type, { bubbles: true, cancelable: true }));

test('a row with a registered source renders the pill for that source', async () => {
  const element = mount();
  await settle(element);

  const pill = pillOf(element);
  assert.ok(pill, 'the cohort that the table compares against has no citation pill');
  assert.equal(pill.dataset.cite, '5');
  assert.equal(pill.textContent, '5 · The Journal of Arthroplasty · 2022');
  assert.equal(pill.getAttribute('aria-haspopup'), 'dialog');
});

test('a row with no registered source renders no pill', async () => {
  const element = mount([{ ...ROW, source_index: undefined, source_label: undefined }]);
  await settle(element);

  assert.equal(pillOf(element), null,
               'a row the turn never numbered was given a pill anyway');
});

test('resting on the pill opens the cohort card', async () => {
  const element = mount();
  await settle(element);

  fire(pillOf(element), 'pointerover');
  await wait(220);

  const card = cardOf(element);
  assert.ok(card, 'the table pill opened no card');
  const text = card.textContent;
  assert.match(text, /5\.\s*The Journal of Arthroplasty · 2022/);
  assert.match(text, /PMID 34793857 · Retrospective Cohort/);
  assert.match(text, /Elective primary total knee arthroplasty/);
  assert.match(text, /30-day readmission rate was 3\.4%/);
});

test('the card\'s link asks the turn for the list, naming row 5', async () => {
  const element = mount();
  await settle(element);
  const seen = [];
  element.addEventListener('citation-see-all', (event) => seen.push(event));

  fire(pillOf(element), 'focusin');
  await wait(20);
  cardOf(element).querySelector('.see-all').click();

  assert.equal(seen.length, 1, 'the link announced nothing');
  assert.equal(seen[0].detail.index, 5, 'the request did not name the row to open');
  assert.equal(seen[0].composed, true);
});
