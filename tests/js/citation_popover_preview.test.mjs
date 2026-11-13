/* The card as the reader sees it: two labelled blocks instead of a wall of text.

   `citation_preview.test.mjs` pins what the formatter decides. This file pins that the
   card actually DRAWS that decision — the labels are in the shadow root, the boilerplate
   is not, the hand-off cue appears only when something was withheld, and a numbered
   clinical list arrives as list items rather than as one paragraph.

   The regression it guards is specific: the card used to render `citation.excerpt` whole,
   so a 300-word abstract ran past the bottom of the window and the reader never reached
   "See all references". */

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

const ABSTRACT = [
  'PURPOSE: To evaluate the risk factors of unplanned readmission after anterior',
  'cervical discectomy and fusion (ACDF) in a large national cohort, and to describe the',
  'quality-of-management and cost implications of that readmission for the treating',
  'hospital and for the payer. METHODS: We searched PubMed, EMBASE and the Cochrane',
  'Library and included 10 studies. RESULTS: Older age [weighted mean difference (WMD),',
  '3.93; 95% confidence interval (CI), 2.30-5.56], male sex (OR, 1.23; 95% CI, 1.10-1.36)',
  'and pulmonary complications (OR, 22.52; 95% CI, 7.21-70.41) were significantly',
  'associated with unplanned readmission. CONCLUSION: Male sex, older age and pulmonary',
  'complications were associated with an increased occurrence of unplanned readmission',
  'after ACDF.',
].join(' ');

const LIST = '1. Anterior cervical discectomy and fusion (ACDF) C5-C6. 2. Cervical '
  + 'spondylosis with myelopathy. 3. Hypertension. 4. Allopurinol. 5. Allograft.';

const SHORT = 'Readmission was 2.6% for ACDF and 0.4% for CDR (p = 0.003).';

async function opened(excerpt, { title = 'Hospital course', source = 'Discharge note' } = {}) {
  const element = document.createElement('a2ui-cited-narrative');
  element._markdown = { value: (text) => Promise.resolve(`<p>${text}</p>`) };
  element.controller = {
    props: {
      text: 'Admitted^[1]',
      citations: [{ index: 1, source, title, excerpt }],
    },
  };
  document.body.appendChild(element);
  await element.updateComplete;
  await element.updateComplete;

  const marker = element.shadowRoot.querySelector('button.cite[data-cite="1"]');
  const popover = element.shadowRoot.querySelector('citation-popover');
  popover.open(element.controller.props.citations[0], marker, { via: 'click' });
  await popover.updateComplete;
  await popover.updateComplete;
  return { element, popover, card: popover.renderRoot.querySelector('.popover') };
}

test('a structured abstract is drawn as Results and Conclusion', async () => {
  const { popover } = await opened(ABSTRACT);
  const labels = [...popover.renderRoot.querySelectorAll('.block-label')]
    .map((node) => node.textContent.trim());

  assert.deepEqual(labels, ['Results', 'Conclusion']);
  const body = popover.renderRoot.querySelector('.body').textContent;
  assert.doesNotMatch(body, /PURPOSE|We searched PubMed/,
    'the setup and the methods are what the authors did, not what they found');
  // The lead quantitative finding is what survives the 220-character budget: the mean
  // difference and its whole interval, not a truncated one.
  assert.match(body, /3\.93/);
  assert.match(body, /2\.30-5\.56/);
});

test('the card hands off to the reference list when it withheld something', async () => {
  const { popover } = await opened(ABSTRACT);
  const cue = popover.renderRoot.querySelector('.disclosure');

  assert.ok(cue, 'a card that dropped sections has to say so');
  assert.match(cue.textContent, /See all references/);
});

test('a passage that was shown whole carries no hand-off cue', async () => {
  const { popover } = await opened(SHORT, { title: 'Pulmonary complications' });

  assert.equal(popover.renderRoot.querySelector('.disclosure'), null,
    'a caveat on text that was never truncated teaches the reader to ignore it');
  assert.equal(popover.renderRoot.querySelector('.excerpt').textContent.trim(), SHORT);
});

test('a numbered clinical list is drawn as list items, with the overflow counted', async () => {
  const { popover } = await opened(LIST, { title: 'Discharge diagnosis' });
  const items = [...popover.renderRoot.querySelectorAll('.items li')]
    .map((node) => node.textContent.trim());

  assert.equal(items.length, 5, 'four items plus the counter');
  assert.match(items[0], /Anterior cervical discectomy/);
  assert.match(items[4], /\+ 1 more in References/);
});

test('the card keeps its header, title and citation line', async () => {
  const { popover } = await opened(ABSTRACT, { title: 'Readmission after ACDF',
    source: 'Spine. 2022. Lee YJ, Kim HS. · PMID 36031784' });
  const text = popover.renderRoot.querySelector('.popover').textContent;

  assert.match(text, /Reference/);
  assert.match(text, /See all references/);
  assert.match(text, /1\. Readmission after ACDF/);
  assert.match(text, /PMID 36031784/);
});
