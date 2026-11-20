/* The question a driver bar asks, and the chip asks the same one.

   The bar used to ask "What in this patient's chart explains {label} as a readmission risk
   driver?" while the chip under an answer asked "Why does {label} increase this patient's
   readmission risk?" — two questions over the same evidence, and only one of them something
   the record can answer. Both now ask `How does {label} affect this patient's readmission
   risk?`, and the verb agrees with the label: `PLURAL_LABELS` here mirrors the set in
   `shared/labels.py`, which is where the labels come from.

   The widget is given the label and never the feature key, so this file has to carry its
   own copy of the rule. The Python half is tested against the same four words. */

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

/** Mount the widget with the factors given, and hand back the rows it drew. */
async function mounted(factors) {
  const element = document.createElement('a2ui-risk-influencers');
  element.controller = {
    props: { probability: 0.085, threshold: 0.11, decision: 0, factors },
  };
  document.body.appendChild(element);
  await element.updateComplete;
  await element.updateComplete;
  const rows = [...element.shadowRoot.querySelectorAll('.factor')];
  const asked = [];
  element.addEventListener('a2ui-follow-up', (event) => asked.push(event.detail));
  return { element, rows, asked };
}

test('clicking a driver bar asks the one question, and declares it a driver click',
     async () => {
       const { rows, asked } = await mounted([
         { label: 'oncology history', contribution: 0.19, direction: 'increases' },
       ]);

       rows[0].click();

       assert.equal(asked.length, 1, 'the bar did not announce a follow-up');
       assert.equal(asked[0].question,
         "How does oncology history affect this patient's readmission risk?");
       assert.equal(asked[0].intent, 'risk_driver');
     });

test('a plural label takes a plural verb', async () => {
  const { rows, asked } = await mounted([
    { label: 'prior inpatient days', contribution: 0.19, direction: 'increases' },
  ]);

  rows[0].click();

  assert.equal(asked[0].question,
    "How do prior inpatient days affect this patient's readmission risk?");
});

test('the row says what clicking it asks, in the same words', async () => {
  const { rows } = await mounted([
    { label: 'recent ED visits', contribution: 0.19, direction: 'increases' },
  ]);

  assert.equal(rows[0].getAttribute('title'),
    "How do recent ED visits affect this patient's readmission risk?");
});

test('a keyboard reader asks the same question', async () => {
  const { rows, asked } = await mounted([
    { label: 'having a procedure', contribution: 0.19, direction: 'increases' },
  ]);

  rows[0].dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: 'Enter', bubbles: true, cancelable: true,
  }));

  assert.equal(asked[0].question,
    "How does having a procedure affect this patient's readmission risk?");
});
