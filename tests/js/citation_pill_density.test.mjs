/* Two clean-ups in the prose's citation pills (UX gap 2, 2026-11-02).

   Reported from a printed `/ehr`: one paragraph carried `2 · Brief hospital course` three
   times, once per sentence, so the pills rather than the prose were what the paragraph
   looked like. Two rules answer it and both are narrow on purpose.

   1. A repeat of the SAME single citation, immediately after itself in the same paragraph,
      is drawn once. A paragraph that alternates two sources keeps every marker, and one
      that leaves a source and comes back keeps the return — the rule is about repetition,
      not about how many times a source may be cited.
   2. A chart section's label is cut at a pill's budget with the cut marked. A published
      record's label is left alone: it is already bounded where it is built, and
      `1 · World Neurosurgery · 2024` is what a reader needs to see whole.

   Nothing here changes what the turn publishes: the references list is built on the server
   from `sources`, so a pill that is not drawn is still a numbered row in the drawer. */

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

const CITATIONS = [
  { index: 1, source: 'Discharge note', title: 'Hospital course', label: '1 · Brief hospital course' },
  { index: 2, source: 'Discharge note', title: 'Discharge diagnosis', label: '2 · Discharge diagnosis' },
];

const LONG_CHART_LABEL = {
  index: 3,
  source: 'Discharge note',
  title: 'History of present illness',
  label: '3 · History of present illness and the referring facility',
};

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

test('a paragraph written from one section carries one pill, not one per sentence', async () => {
  const element = mount('Admitted^[1]. Treated^[1]. Discharged^[1].');
  await settle(element);

  const markers = element.shadowRoot.querySelectorAll('button.cite');
  assert.equal(markers.length, 1, 'the same source was drawn three times in one paragraph');
  assert.equal(markers[0].dataset.cite, '1');
  // The prose is untouched: only the redundant pills and the spaces that carried them go,
  // so the paragraph still reads as three sentences.
  const prose = element.shadowRoot.querySelector('.prose').cloneNode(true);
  prose.querySelectorAll('button.cite').forEach((node) => node.remove());
  assert.equal(prose.textContent, 'Admitted. Treated. Discharged.');
});

test('a paragraph that alternates two sources keeps every marker', async () => {
  const element = mount('Admitted^[1]. Diagnosed^[2]. Treated^[1].');
  await settle(element);

  const markers = element.shadowRoot.querySelectorAll('button.cite');
  assert.deepEqual([...markers].map((node) => node.dataset.cite), ['1', '2', '1'],
                   'a return to a source is a citation, not a repetition');
});

test('the rule is per paragraph, so the next section is cited again', async () => {
  const element = document.createElement('a2ui-cited-narrative');
  element._markdown = {
    value: (source) => Promise.resolve(source.split('\n\n')
      .map((paragraph) => `<p>${paragraph}</p>`).join('')),
  };
  element.controller = {
    props: { text: 'Admitted^[1]. Treated^[1].\n\nDischarged^[1].', citations: CITATIONS },
  };
  document.body.appendChild(element);
  await settle(element);

  const markers = element.shadowRoot.querySelectorAll('button.cite');
  assert.equal(markers.length, 2, 'each paragraph carries the marker for its own source');
});

test('a long chart label is cut at the pill budget, and the cut is marked', async () => {
  const element = mount('Presented^[3].', [LONG_CHART_LABEL]);
  await settle(element);

  const marker = element.shadowRoot.querySelector('button.cite');
  assert.ok(marker.textContent.length <= 26, marker.textContent);
  assert.ok(marker.textContent.endsWith('\u2026'), 'an unmarked cut reads as the whole label');
  // Nothing is lost: the card the pill opens, and the name a screen reader hears, carry
  // the label the server resolved.
  assert.match(marker.getAttribute('aria-label'), /History of present illness/);
});

test('a published record keeps its whole label', async () => {
  const element = mount('The rate was 4.1%^[PMID: 29950074].', [{
    index: 1,
    source: 'PubMed',
    title: 'Readmission after lumbar spine surgery.',
    label: '1 · World Neurosurgery · 2024',
    pmid: '29950074',
  }]);
  await settle(element);

  const marker = element.shadowRoot.querySelector('button.cite');
  assert.equal(marker.textContent, '1 · World Neurosurgery · 2024');
});
