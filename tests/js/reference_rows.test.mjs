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

/** Run one turn that serves `references`, and return the page it drew. */
async function draw(references, overrides = {}) {
  const payload = {
    answer: 'The patient was diuresed.',
    verified: true,
    scope: 'patient_chart',
    references,
    follow_ups: [],
    ...overrides,
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

test('a literature turn lists its records in the drawer too', async () => {
  /* Reported live on `/pubmed hyperglycemia` (2026-10-26): three numbered pills, a
     "General Medical Evidence" badge, and no REFERENCES drawer at all.

     The drawer was gated on `scope === 'patient_chart'`, on the reasoning that a
     literature turn illustrated its own sources so listing them again was the same
     evidence twice. That stopped being true when those records became citations and the
     canvas stopped drawing them — the gate was hiding the only place the papers could be
     read. The rule is structural now: references were published, so references are
     shown. */
  const record = {
    index: 1,
    source: 'PubMed',
    title: 'Hyperglycemia in the hospitalised patient',
    label: '1 · Ugeskrift for laeger · 2024',
    subtitle: 'Ugeskrift for laeger. 2024. Hansen K, Berg J, et al. · PMID 38123456',
    year: '2024',
    excerpt: 'BACKGROUND: Hyperglycemia is common on the ward.',
    pmid: '38123456',
    url: 'https://pubmed.ncbi.nlm.nih.gov/38123456/',
  };

  const { rows, turn } = await draw([record], {
    answer: 'Two records were retrieved.^[PMID: 38123456]',
    scope: 'general_evidence',
    verified: false,
  });

  assert.equal(turn().querySelector('.cp-references').hidden, false,
               'the drawer was suppressed on a literature turn');
  const [row] = rows();
  assert.ok(row, 'the drawer drew no rows');
  assert.equal(row.querySelector('.cp-reference-title').textContent, record.title);
  assert.equal(row.querySelector('.cp-reference-tag').textContent, 'PubMed · 2024');
});

test('a turn with no references still draws no drawer', async () => {
  const { turn } = await draw([], { scope: 'general_evidence', verified: false });

  assert.equal(turn().querySelector('.cp-references').hidden, true);
});

test('a published record is a link with a PubMed tag, not an expandable row', async () => {  const { rows } = await draw([RECORD_ROW]);

  const [row] = rows();
  assert.equal(row.querySelector('.cp-reference-tag').textContent, 'PubMed');

  const head = row.querySelector('.cp-reference-head');
  assert.equal(head.tagName, 'A');
  assert.equal(head.getAttribute('href'),
               'https://pubmed.ncbi.nlm.nih.gov/12345678/');
  assert.equal(row.querySelector('.cp-reference-excerpt'), null,
               'a record with no passage was given an empty one');
});

test('the benchmark row names its paper, its authors and its finding', async () => {
  // The reported defect: row 5 read `5. The Journal of Arthroplasty · 2022` and stopped.
  // The four rows above it each carried a passage, and the cohort the comparison rests on
  // carried nothing — a reader could not even tell which paper it was.
  const benchmark = {
    index: 5,
    source: 'PubMed',
    title: 'The Impact of Pre-Operative Healthcare Utilization on Complications, '
      + 'Readmissions, and Post-Operative Healthcare Utilization Following Total Joint '
      + 'Arthroplasty.',
    label: '5 · The Journal of Arthroplasty · 2022',
    subtitle: 'The Journal of Arthroplasty. 2022. Creager AE, Kleven AD, Kesimoglu ZN, '
      + 'et al. · PMID 34793857',
    excerpt: 'Elective primary total knee arthroplasty — The 30-day readmission rate was '
      + '3.4%.',
    pmid: '34793857',
    url: 'https://pubmed.ncbi.nlm.nih.gov/34793857/',
  };

  const { rows } = await draw([benchmark]);
  const [row] = rows();

  const title = row.querySelector('.cp-reference-title');
  assert.match(title.textContent, /^The Impact of Pre-Operative Healthcare/);
  assert.equal(row.querySelector('.cp-reference-head').tagName, 'A');
  assert.equal(row.querySelector('.cp-reference-head').getAttribute('href'),
               benchmark.url);

  assert.equal(row.querySelector('.cp-reference-subtitle').textContent,
               benchmark.subtitle);

  assert.match(row.querySelector('.cp-reference-excerpt').textContent,
               /30-day readmission rate was 3\.4%/);
});

test('the card\'s request for the full list opens it AT THE ROW IT NAMED', async () => {
  const { window, turn } = await draw([NOTE_ROW]);

  const drawer = turn().querySelector('.cp-references');
  drawer.open = false;

  const scrolled = [];
  window.Element.prototype.scrollIntoView = function scrollIntoView() {
    scrolled.push(this);
  };
  const row = drawer.querySelector('[data-reference-index="1"]');
  let focused = 0;
  // jsdom does not lay anything out and does not treat every control as focusable, so the
  // call is what is asserted: the caret has to travel with the view.
  row.querySelector('.cp-reference-head').focus = () => { focused += 1; };

  // The detail is what the popover sends: the index of the citation it was opened from.
  turn().querySelector('.cp-answer').dispatchEvent(new window.CustomEvent(
    'citation-see-all', { bubbles: true, composed: true, detail: { index: 1 } }));

  assert.equal(drawer.open, true, 'the drawer was left closed');
  assert.deepEqual(scrolled, [row], 'the viewport went to the drawer, not to the row');
  assert.equal(row.classList.contains('is-target'), true,
               'the row the scroll landed on is not marked');
  assert.equal(focused, 1, 'the reader was sent to a row that did not take the caret');
});

test('a request with no index in it opens the list and stops at the list', async () => {
  const { window, turn } = await draw([NOTE_ROW]);

  const drawer = turn().querySelector('.cp-references');
  drawer.open = false;

  const scrolled = [];
  window.Element.prototype.scrollIntoView = function scrollIntoView() {
    scrolled.push(this);
  };

  turn().querySelector('.cp-answer').dispatchEvent(new window.CustomEvent(
    'citation-see-all', { bubbles: true, composed: true }));

  assert.equal(drawer.open, true);
  assert.deepEqual(scrolled, [drawer],
                   'a request that named no row scrolled to a row anyway');
});
