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

test('the pill prints the server-resolved label, not the numbered one', async () => {
  const element = mount('Admitted^[1].', [CHART]);
  await settle(element);

  const marker = element.shadowRoot.querySelector('button.cite');
  assert.equal(marker.textContent, 'Brief Hospital Course');
  // The number is the references list's, and the list still has it.
  assert.equal(CHART.label, '1 · Brief hospital course');
});

test('a published pill prints its journal alone, with no number and no year', async () => {
  const element = mount('The rate was 4.1%^[PMID: 29950074].', [LITERATURE]);
  await settle(element);

  const marker = element.shadowRoot.querySelector('button.cite');
  assert.equal(marker.textContent, 'World Neurosurg');
});

test('the pill is coloured by the kind the server sent', async () => {
  const chartPill = mount('Admitted^[1].', [CHART]);
  await settle(chartPill);
  const literaturePill = mount('The rate was 4.1%^[PMID: 29950074].', [LITERATURE]);
  await settle(literaturePill);

  assert.ok(chartPill.shadowRoot.querySelector('button.cite.cite-note'));
  assert.ok(literaturePill.shadowRoot.querySelector('button.cite.cite-literature'));
});

test('every marker the backend settled is drawn, including a repeat', async () => {
  // The browser does not decide that the second one is redundant: `citations.py` does,
  // before settlement, where the deletion is a flag on the trace rather than a silent
  // side effect of rendering.
  const element = mount('Admitted^[1]. Treated^[1]. Discharged^[1].', [CHART]);
  await settle(element);

  const markers = element.shadowRoot.querySelectorAll('button.cite');
  assert.equal(markers.length, 3);
});

test('a payload from an agent that predates the field still draws a pill', async () => {
  const legacy = { index: 2, source: 'Discharge note', title: 'Discharge diagnosis',
                   label: '2 · Discharge diagnosis' };
  const element = mount('Diagnosed^[2].', [legacy]);
  await settle(element);

  const marker = element.shadowRoot.querySelector('button.cite');
  assert.equal(marker.textContent, '2 · Discharge diagnosis');
  // No kind on the payload: the note colour is the safe default, because an unlabelled
  // source in this product is a note section.
  assert.ok(marker.classList.contains('cite-note'));
});
