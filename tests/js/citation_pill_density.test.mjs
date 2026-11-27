/* What an inline pill draws, and — just as important — what it does not decide.

   Reported 2026-11-02 from a printed `/ehr`: every pill read `1 · History of present
   illness`, the number and the full section name included, and one paragraph carried the
   same pill three times.

   The first attempt fixed that in this component — suppressing a repeated marker and
   cutting a long label — which was a citation decision taken in the browser. The client
   architecture forbids it (`docs/architecture/01-client.md`: the browser renders
   pre-resolved data and "never parses or heals malformed citations"; interpretation is the
   backend's). The remediation moved both decisions to the server:

   - `pill_label` arrives resolved (the section name in Title Case, or the compact journal);
   - a repeat of one citation inside a paragraph is collapsed in `postprocess/citations.py`
     and flagged on the trace;
   - `kind` (`note` / `literature`) arrives with the citation, and this sheet only colours
     by it.

   These tests pin that division: the pill prints what it was sent, colours by the kind it
   was sent, and draws every marker it was given. */

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

const bundle = await import('../../static/js/a2ui_clinical_components.js');

const CHART = {
  index: 1,
  kind: 'note',
  source: 'Discharge note',
  title: 'Brief hospital course',
  label: '1 · Brief hospital course',
  pill_label: 'Brief Hospital Course',
};
const LITERATURE = {
  index: 4,
  kind: 'literature',
  source: 'World Neurosurgery. 2024. Proal JD, et al. · PMID 29950074',
  title: 'Readmission after lumbar spine surgery.',
  label: '4 · World Neurosurgery · 2024',
  pill_label: 'World Neurosurg',
  pmid: '29950074',
};

function mount(text, citations) {
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

test('the inline pill prints its compact numeric reference index', async () => {
  const element = mount('Admitted^[1].', [CHART]);
  await settle(element);

  const marker = element.shadowRoot.querySelector('button.cite');
  assert.equal(marker.textContent, '1');
  assert.ok(marker.classList.contains('cite-num'));
  // Full title & label still live on the accessible name and footer metadata.
  assert.equal(CHART.label, '1 · Brief hospital course');
  assert.match(marker.getAttribute('aria-label'), /Brief hospital course/);
});

test('a published inline pill prints its compact reference index too', async () => {
  const element = mount('The rate was 4.1%^[PMID: 29950074].', [LITERATURE]);
  await settle(element);

  const marker = element.shadowRoot.querySelector('button.cite');
  assert.equal(marker.textContent, '4');
  assert.ok(marker.classList.contains('cite-num'));
  assert.equal(marker.dataset.cite, '4');
});

test('the pill is coloured by the kind the server sent', async () => {
  const chartPill = mount('Admitted^[1].', [CHART]);
  await settle(chartPill);
  const literaturePill = mount('The rate was 4.1%^[PMID: 29950074].', [LITERATURE]);
  await settle(literaturePill);

  assert.ok(chartPill.shadowRoot.querySelector('button.cite.cite-note'));
  assert.ok(literaturePill.shadowRoot.querySelector('button.cite.cite-literature'));
});

test('cluster markers sit tightly after sentence punctuation without orphaned spaces', async () => {
  const element = mount('In good condition ^[1] ^[PMID: 29950074] .', [CHART, LITERATURE]);
  await settle(element);

  const p = element.shadowRoot.querySelector('.prose > p');
  const group = p.querySelector('span.cite-group');
  assert.ok(group, 'grouped cluster container missing');
  const markers = [...group.querySelectorAll('button.cite')];
  assert.deepEqual(markers.map((node) => node.textContent), ['1', '4']);
  assert.equal(p.textContent, 'In good condition.14');
});

test('identical citation indices are deduplicated within a paragraph block', async () => {
  const element = mount('Admitted^[1]. Treated^[1]. Discharged^[1].', [CHART]);
  await settle(element);

  const p = element.shadowRoot.querySelector('.prose > p');
  const markers = p.querySelectorAll('button.cite');
  assert.equal(markers.length, 1);
  assert.equal(markers[0].textContent, '1');
  assert.equal(p.textContent, 'Admitted.1 Treated. Discharged.');
});

test('separate paragraphs may each cite the same source index once', async () => {
  const element = document.createElement('a2ui-cited-narrative');
  element._markdown = {
    value: () => Promise.resolve('<p>Admitted^[1]. Course^[1].</p><p>Follow-up^[1].</p>'),
  };
  element.controller = { props: { text: 'split', citations: [CHART] } };
  document.body.appendChild(element);
  await settle(element);

  const paragraphs = [...element.shadowRoot.querySelectorAll('.prose > p')];
  assert.equal(paragraphs[0].querySelectorAll('button.cite').length, 1);
  assert.equal(paragraphs[1].querySelectorAll('button.cite').length, 1);
});

test('a payload without pill_label still renders numeric pill and note class', async () => {
  const legacy = { index: 2, source: 'Discharge note', title: 'Discharge diagnosis',
                   label: '2 · Discharge diagnosis' };
  const element = mount('Diagnosed^[2].', [legacy]);
  await settle(element);

  const marker = element.shadowRoot.querySelector('button.cite');
  assert.equal(marker.textContent, '2');
  assert.ok(marker.classList.contains('cite-note'));
  assert.ok(marker.classList.contains('cite-num'));
});

test('a leading bold section label is promoted to a block section-lead heading', async () => {
  const element = mount('<strong>Presentation &amp; diagnosis.</strong> Admitted^[1].', [CHART]);
  await settle(element);

  const p = element.shadowRoot.querySelector('.prose > p');
  const lead = p.querySelector('strong.section-lead');
  assert.ok(p.classList.contains('has-section-lead'));
  assert.ok(lead);
  assert.equal(lead.textContent, 'Presentation & diagnosis.');
});
