/* The comparison table's cohort, cited from inside the table.

   The matrix draws curated PubMed cohorts beside this patient's estimate, in the shape a
   reader compares two populations in: who was studied, what happened to them, and the
   paper it came from. The paper is the third column and it is a citation — the same pill
   the prose uses, opening the same card.

   `ComparativeRiskMatrix` also has to survive the popover's own architecture: the card is
   parented to `document.body` while it is open (a fixed box inside a scrolling table
   wrapper and under a mount animation that applies a transform is a box that lands in the
   wrong place or not at all), so these tests capture it where it was rendered and then
   assert on what it draws. */

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
  title: 'The Impact of Pre-Operative Healthcare Utilization on Complications, '
    + 'Readmissions, and Post-Operative Healthcare Utilization Following Total Joint '
    + 'Arthroplasty.',
  authors: 'Creager AE, Kleven AD, Kesimoglu ZN, et al.',
  journal: 'The Journal of Arthroplasty',
  year: '2022',
  reported_rate: '3.4%',
  cohort_summary: 'Elective primary total knee arthroplasty, single institution, 2015-2019.',
  evidence_tier: 'Retrospective Cohort',
  horizon_days: 30,
  url: 'https://pubmed.ncbi.nlm.nih.gov/34793857/',
  excerpt: 'The 30-day readmission rate was 3.4%.',
  source_index: 5,
  source_label: '5 · The Journal of Arthroplasty · 2022',
};

const BASELINE = {
  source: 'Enterprise Clinical Copilot',
  probability: 0.09,
  threshold: 0.11,
  decision: 0,
  cohort: 'Index admission, this patient',
  provenance: 'Model readmission-final-20260917173317',
};

async function mount({ rows = [ROW], baseline = undefined } = {}) {
  const element = document.createElement('a2ui-comparative-risk-matrix');
  element.controller = {
    props: { rows, baseline_note: '', ...(baseline ? { baseline } : {}) },
  };
  document.body.appendChild(element);
  await element.updateComplete;
  await element.updateComplete;
  // Captured while it is still where it was rendered: once open, the card lives on the
  // document body, and a later lookup from the shadow root would find nothing.
  return { element, popover: element.shadowRoot.querySelector('citation-popover') };
}

const cardOf = (popover) => popover.renderRoot.querySelector('.popover');
const pillOf = (element) => element.shadowRoot.querySelector('button.cite');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fire = (node, type) => node.dispatchEvent(
  new dom.window.Event(type, { bubbles: true, cancelable: true }));

test('the table is laid out as population, outcome, source', async () => {
  const { element } = await mount({ baseline: BASELINE });

  const headers = [...element.shadowRoot.querySelectorAll('th')]
    .map((cell) => cell.textContent.trim());
  assert.deepEqual(headers, ['Population / treatment', '30-day readmission', 'Source']);

  // The patient's row leads with who she is, then her figure, then the model that scored
  // her — the same three things the cohorts are described by, in the same order.
  const cells = [...element.shadowRoot.querySelectorAll('tr.baseline td')]
    .map((cell) => cell.textContent.replace(/\s+/g, ' ').trim());
  assert.match(cells[0], /^Index admission, this patient/);
  assert.match(cells[1], /^9/);
  assert.match(cells[2], /^Enterprise Clinical Copilot/);
});

test('a row with a registered source renders the pill for that source', async () => {
  const { element } = await mount();

  const pill = pillOf(element);
  assert.ok(pill, 'the cohort that the table compares against has no citation pill');
  assert.equal(pill.dataset.cite, '5');
  assert.equal(pill.textContent, '5 · The Journal of Arthroplasty · 2022');
  assert.equal(pill.getAttribute('aria-haspopup'), 'dialog');
  // A native title would draw the browser's own tooltip over the card this opens, which
  // is what a reader reported seeing instead of the card.
  assert.equal(pill.hasAttribute('title'), false, 'the pill still carries a native tooltip');
});

test('the source column is the citation, not the citation plus a raw identifier', async () => {
  const { element } = await mount();

  const cell = pillOf(element).closest('td');
  assert.equal(cell.textContent.replace(/\s+/g, ' ').trim(),
               '5 · The Journal of Arthroplasty · 2022');
  assert.equal(cell.querySelectorAll('a').length, 0,
               'the pill column still repeats a raw PMID link');
});

test('a row with no registered source renders no pill', async () => {
  const { element } = await mount({
    rows: [{ ...ROW, source_index: undefined, source_label: undefined }],
  });

  assert.equal(pillOf(element), null,
               'a row the turn never numbered was given a pill anyway');
});

test('the card is titled with the paper, cites it, and quotes the finding', async () => {
  const { element, popover } = await mount();

  fire(pillOf(element), 'pointerover');
  await wait(220);

  const card = cardOf(popover);
  assert.ok(card, 'the table pill opened no card');

  const title = card.querySelector('.title');
  assert.match(title.textContent, /^5\. The Impact of Pre-Operative Healthcare/);
  assert.equal(title.querySelector('a').getAttribute('href'),
               'https://pubmed.ncbi.nlm.nih.gov/34793857/');

  assert.equal(card.querySelector('.subtitle').textContent,
               'The Journal of Arthroplasty. 2022. Creager AE, Kleven AD, Kesimoglu ZN, '
               + 'et al. · PMID 34793857');

  const excerpt = card.querySelector('.excerpt').textContent;
  assert.match(excerpt, /Elective primary total knee arthroplasty/);
  assert.match(excerpt, /30-day readmission rate was 3\.4%/);
});

test('the card\'s link asks the turn for the list, naming row 5', async () => {
  const { element, popover } = await mount();
  const seen = [];
  element.addEventListener('citation-see-all', (event) => seen.push(event));

  fire(pillOf(element), 'focusin');
  await wait(20);
  cardOf(popover).querySelector('.see-all').click();

  assert.equal(seen.length, 1, 'the link announced nothing');
  assert.equal(seen[0].detail.index, 5, 'the request did not name the row to open');
  assert.equal(seen[0].composed, true);
});
