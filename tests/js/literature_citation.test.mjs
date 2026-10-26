/* A literature turn's citation, opened the way every other citation in the product is.

   Phase F (2026-10-26). A published record used to be drawn as an anchor straight to
   PubMed, so the same `^[n]` gesture meant "read the passage here" on a note turn and
   "leave the page" on a literature turn — and the reference list at the foot of the turn
   never drew the papers it was summarising. The marker is a card now, with the record one
   click away on the card's title.

   The marker text the model writes is still `^[PMID: ...]`, which the evaluation suite
   requires of this turn (`dev_t1_06`); what changed is what the reader gets from it. */

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

/** One record, as the agent now publishes it: everything the card and the row need. */
const ARTICLE = {
  index: 1,
  source: 'World Neurosurgery. 2024. Proal JD, Moon AS, LaHaise K, et al. · PMID 29950074',
  subtitle: 'World Neurosurgery. 2024. Proal JD, Moon AS, LaHaise K, et al. · PMID 29950074',
  title: 'Readmission rates after intraoperative durotomy and repair in outpatient '
    + 'lumbar spinal surgery.',
  label: '1 · World Neurosurgery · 2024',
  authors: 'Proal JD, Moon AS, LaHaise K, et al.',
  pmid: '29950074',
  url: 'https://pubmed.ncbi.nlm.nih.gov/29950074/',
  excerpt: 'The 30-day readmission rate was 4.1% in the durotomy cohort.',
};

function mount(text, citations = [ARTICLE]) {
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cardOf = (popover) => popover.renderRoot.querySelector('.popover');

async function opened() {
  // The marker form the model writes on this turn — still a PMID, still what `dev_t1_06`
  // asserts is in the answer.
  const element = mount('The rate was 4.1%^[PMID: 29950074].');
  await settle(element);
  const marker = element.shadowRoot.querySelector('button.cite');
  const popover = element.shadowRoot.querySelector('citation-popover');
  return { element, marker, popover, card: () => cardOf(popover) };
}

test('the marker is a control that opens a card, not a link off the page', async () => {
  const { element, marker } = await opened();

  assert.ok(marker, 'the PMID marker did not render a citation control');
  assert.equal(marker.tagName, 'BUTTON');
  assert.equal(element.shadowRoot.querySelector('a.cite-pmid'), null,
               'the marker still leaves the page instead of opening its evidence');
  // The pill reads like every other pill: the number, the journal, the year.
  assert.equal(marker.textContent.trim(), '1 · World Neurosurgery · 2024');
  // And it is addressable by the number the references drawer uses.
  assert.equal(marker.dataset.cite, '1');
});

test('resting on it opens the card with the paper, its citation and its finding', async () => {
  const { marker, card } = await opened();

  marker.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true }));
  await wait(220);

  assert.ok(card(), 'the card never opened for a literature citation');
  const text = card().textContent;
  assert.match(text, /Readmission rates after intraoperative durotomy/);
  assert.match(text, /World Neurosurgery\. 2024\. Proal JD/);
  assert.match(text, /PMID 29950074/);
  assert.match(text, /30-day readmission rate was 4\.1%/);
  assert.match(text, /See all references/);
});

test('the trip to PubMed is on the card title, where a reader looks for the paper', async () => {
  const { marker, card } = await opened();

  marker.dispatchEvent(new dom.window.Event('focusin', { bubbles: true }));
  await wait(20);

  const link = card().querySelector('.title a');
  assert.ok(link, 'the card title is not a link to the record');
  assert.equal(link.getAttribute('href'), ARTICLE.url);
  assert.equal(link.getAttribute('target'), '_blank');
  assert.match(link.textContent, /^Readmission rates after intraoperative durotomy/);

  // Numbered once, in the card — the reader never sees the number twice.
  assert.match(card().querySelector('.title').textContent.trim(), /^1\./);
});

test('the card hands the reader to the references drawer at this record', async () => {
  const { element, marker, popover, card } = await opened();
  const seen = [];
  element.addEventListener('citation-see-all', (event) => seen.push(event.detail));

  marker.dispatchEvent(new dom.window.Event('focusin', { bubbles: true }));
  await wait(20);
  card().querySelector('.see-all').click();
  await popover.updateComplete;

  // The number the drawer's rows are addressed by, so "see all" lands on this paper.
  assert.deepEqual(seen, [{ index: 1 }]);
  assert.equal(card(), null, 'the card stayed open on top of the list it was sent to');
});

test('a record with no abstract still opens a card that names it', async () => {
  const element = mount('The rate was 4.1%^[1].', [{ ...ARTICLE, excerpt: '' }]);
  await settle(element);

  const marker = element.shadowRoot.querySelector('button.cite');
  const popover = element.shadowRoot.querySelector('citation-popover');
  assert.ok(marker, 'the record did not render a citation control');
  assert.ok(popover, 'the narrative has no popover to open');

  marker.dispatchEvent(new dom.window.Event('focusin', { bubbles: true }));
  await wait(20);

  const card = cardOf(popover);
  assert.ok(card, 'the card never opened');
  assert.match(card.textContent, /Readmission rates after intraoperative durotomy/);
  assert.equal(card.querySelector('.excerpt'), null,
               'a record with no passage was given an empty one');
});
