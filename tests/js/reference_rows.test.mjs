/* The references drawer's rows, drawn by the page.

   Two defects are covered here, both reported from the live build.

   The first was `1. [1] Discharge note · Hospital Course`: the row carried its number
   inside its own label while the stylesheet's counter rendered a second one beside it,
   so production showed two numbers for one passage, written two ways. The row is now a
   two-column grid — a 28px gutter and the evidence — and the number is written once, by
   the markup.

   The second was that the passage behind a claim was hidden until it was clicked. The
   rows ARE the evidence, so the passage is on screen from the start, clamped to two
   lines and unclamped by the click that also points at the sentence it supports.

   The last test covers the card's route to this list: the popover lives inside two shadow
   trees, so it announces a request and the turn answers it. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { boot, settle } from './support/page.mjs';

const encoder = new TextEncoder();

const frame = (event, payload) => `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;

function streamed(frames) {
  let cursor = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        async read() {
          if (cursor >= frames.length) return { done: true, value: undefined };
          return { done: false, value: encoder.encode(frames[cursor++]) };
        },
        cancel() {},
      }),
    },
  };
}

const NOTE_ROW = {
  index: 1,
  source: 'Discharge note',
  title: 'Hospital Course',
  label: '1 · Hospital Course',
  excerpt: 'The patient was admitted with decompensated heart failure and diuresed.',
};

const RECORD_ROW = {
  index: 1,
  source: 'PubMed',
  title: 'Beta blockers in heart failure with reduced ejection fraction',
  pmid: '12345678',
};

/** Run one chart turn that serves `references`, and return the page it drew. */
async function draw(references) {
  const payload = {
    answer: 'The patient was diuresed.',
    verified: true,
    scope: 'patient_chart',
    references,
    follow_ups: [],
  };
  const page = boot({
    answer: () => streamed([frame('answer', payload)]),
    threads: { conversations: [] },
    reducedMotion: true,
  });
  const { window } = page;
  await settle();

  window.document.getElementById('cp-patient-id').value = '90000015';
  window.document.getElementById('cp-ask-input').value = 'What happened?';
  window.document.getElementById('cp-ask').dispatchEvent(
    new window.Event('submit', { cancelable: true, bubbles: true }));

  for (let tick = 0; tick < 20; tick += 1) {
    await settle();
    const turn = window.document.querySelector('#cp-feed .cp-turn');
    if (turn && turn.querySelector('.cp-turn-toolbar:not([hidden])')) break;
  }

  return {
    ...page,
    turn: () => window.document.querySelector('#cp-feed .cp-turn'),
    rows: () => [...window.document.querySelectorAll('#cp-feed .cp-reference-item')],
  };
}

test('a row numbers its passage once, in the gutter, and says what kind of source it is',
     async () => {
       const { errors, rows } = await draw([NOTE_ROW]);
       assert.deepEqual(errors, []);

       const [row] = rows();
       assert.ok(row, 'the drawer drew no rows');

       assert.equal(row.querySelector('.cp-reference-index').textContent, '1.');
       assert.equal(row.querySelector('.cp-reference-title').textContent, 'Hospital Course');
       assert.equal(row.querySelector('.cp-reference-tag').textContent, 'Clinical Note');

       // The reported defect: two numbers for one row. Bracketed labels are gone from the
       // drawer entirely — the gutter carries the number and nothing repeats it.
       assert.equal(/\[\d+\]/.test(row.textContent), false,
                    `the row still repeats a bracketed number: ${row.textContent}`);
     });

test('the passage behind a claim is on screen, clamped, and the click opens it', async () => {
  const { rows } = await draw([NOTE_ROW]);

  const [row] = rows();
  const excerpt = row.querySelector('.cp-reference-excerpt');
  const head = row.querySelector('.cp-reference-head');

  // Shown from the start, not hidden behind the click that reveals it.
  assert.equal(excerpt.hasAttribute('hidden'), false);
  assert.equal(excerpt.textContent, NOTE_ROW.excerpt);

  assert.equal(head.getAttribute('aria-expanded'), 'false');
  assert.equal(row.classList.contains('is-open'), false);

  head.click();

  assert.equal(row.classList.contains('is-open'), true);
  assert.equal(head.getAttribute('aria-expanded'), 'true');
});

test('a published record is a link with a PubMed tag, not an expandable row', async () => {
  const { rows } = await draw([RECORD_ROW]);

  const [row] = rows();
  assert.equal(row.querySelector('.cp-reference-tag').textContent, 'PubMed');

  const head = row.querySelector('.cp-reference-head');
  assert.equal(head.tagName, 'A');
  assert.equal(head.getAttribute('href'),
               'https://pubmed.ncbi.nlm.nih.gov/12345678/');
  assert.equal(row.querySelector('.cp-reference-excerpt'), null,
               'a record with no passage was given an empty one');
});

test('the card\'s request for the full list opens it and moves the caret to it', async () => {
  const { window, turn } = await draw([NOTE_ROW]);

  const drawer = turn().querySelector('.cp-references');
  const summary = drawer.querySelector('summary');
  drawer.open = false;

  let scrolled = 0;
  window.Element.prototype.scrollIntoView = function scrollIntoView() { scrolled += 1; };
  let focused = 0;
  // jsdom does not treat `summary` as focusable, so the call is what is asserted rather
  // than the document's activeElement.
  summary.focus = () => { focused += 1; };

  turn().querySelector('.cp-answer').dispatchEvent(
    new window.CustomEvent('citation-see-all', { bubbles: true, composed: true }));

  assert.equal(drawer.open, true, 'the drawer was left closed');
  assert.equal(scrolled, 1, 'the drawer was opened off screen and left there');
  assert.equal(focused, 1, 'the reader was sent to a list that did not take the caret');
});
