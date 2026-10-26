/* A run that speaks, goes back for evidence, and speaks again.

   The reported defect (2026-10-25): clicking a follow-up after `/labs` showed a few
   sentences, the answer stopped, the run went back into a tool round, and a different
   answer arrived. Two things were wrong at the client boundary and this file covers both.

   The prose from the abandoned first pass stayed on screen and the second pass appended
   to it, so the reader briefly held a sentence from one answer glued to another. And
   the settled answer then replaced it, which is a swap the reader was never owed — the
   text they lost was never the answer.

   `copilot_canvas.js` now drops the draft at the frame that says the run moved on, and
   `copilot_reveal.discard` empties the queue without closing the reveal, so the second
   pass pours into the same turn rather than under the tail of the first.

   Reduced motion is on throughout: it makes the reveal paint as the frames arrive, so
   what the DOM holds between frames is deterministic rather than a function of the
   16 ms tick. The cadence itself is covered by `copilot_reveal.test.mjs`. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { boot, settle } from './support/page.mjs';

const encoder = new TextEncoder();

const frame = (event, payload) => `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;

/** A response whose body reads back the frames it was given, one per read. */
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

const ANSWER = { answer: 'The discharge diagnosis was acute decompensated heart failure.',
                 verified: true, scope: null, references: [], follow_ups: [] };

/* The reported sequence: prose, then a tool round, then the answer the tool supported. */
const ABANDONED = [
  frame('planning', { stage: 'planning', label: 'Planning the search' }),
  frame('answer_delta', { stage: 'answer_delta', text: 'Creatinine rose from 1.1 to ' }),
  frame('tool', { stage: 'tool', label: 'Reading the discharge note' }),
  frame('answer_delta', { stage: 'answer_delta', text: ANSWER.answer }),
  frame('answer', ANSWER),
];

/** Run one turn and return what the draft held after every mutation. */
async function drive(frames) {
  const page = boot({
    answer: () => streamed(frames),
    threads: { conversations: [] },
    reducedMotion: true,
  });
  const { window } = page;
  await settle();

  window.document.getElementById('cp-patient-id').value = '90000015';

  const feed = window.document.getElementById('cp-feed');
  const snapshots = [];
  const observer = new window.MutationObserver(() => {
    const draft = feed.querySelector('.cp-answer-text');
    snapshots.push(draft ? draft.textContent : '');
  });
  observer.observe(feed, { childList: true, subtree: true, characterData: true });

  window.document.getElementById('cp-ask').dispatchEvent(
    new window.Event('submit', { cancelable: true, bubbles: true }));

  // The turn is over when the toolbar is revealed, which `retire` does on both paths.
  for (let tick = 0; tick < 20; tick += 1) {
    await settle();
    const turn = feed.querySelector('.cp-turn');
    if (turn && turn.querySelector('.cp-turn-toolbar:not([hidden])')) break;
  }

  observer.disconnect();
  return {
    ...page,
    snapshots,
    draft: () => feed.querySelector('.cp-answer-text'),
    turn: () => feed.querySelector('.cp-turn'),
  };
}

test('the abandoned first pass is dropped rather than glued to the answer', async () => {
  const { window, errors, snapshots, draft } = await drive(ABANDONED);

  assert.deepEqual(errors, []);

  // The final text is the served answer and nothing else.
  assert.equal(draft().textContent, ANSWER.answer);
  assert.equal(window.document.querySelectorAll('#cp-feed .cp-turn').length, 1);

  // The draft did hold the first pass — the abort is what this test is about.
  assert.equal(snapshots.some((text) => text.includes('Creatinine rose')), true,
               'the first pass never reached the page, so the reset was not exercised');

  // ...and at no point did it hold both passes. Without the reset the second pass
  // appends to the first, because both write the same element.
  const glued = snapshots.filter(
    (text) => text.includes('Creatinine rose') && text.includes('discharge diagnosis'));
  assert.deepEqual(glued, [], 'the first pass was still on screen when the answer grew');
});

test('the run says what it moved on to', async () => {
  const { turn } = await drive(ABANDONED);

  // The status row is replaced by the stage history when the turn settles; its presence
  // is what says the run passed through stages rather than stopping after one reply.
  const history = turn().querySelector('.cp-stages-summary');
  assert.ok(history, 'the turn carries no record of the stages it passed through');
  assert.match(history.textContent, /Agent workflow - \d+ steps/);
});

test('a run that never goes back keeps its draft and reports no correction', async () => {
  const { errors, draft, snapshots, window } = await drive([
    frame('answer_delta', { stage: 'answer_delta', text: 'Creatinine rose ' }),
    frame('answer_delta', { stage: 'answer_delta', text: 'from 1.1 to 1.4.' }),
    frame('answer', { answer: 'Creatinine rose from 1.1 to 1.4.', scope: 'patient_chart',
                      verified: true, references: [], follow_ups: [] }),
  ]);

  assert.deepEqual(errors, []);
  assert.equal(draft().textContent, 'Creatinine rose from 1.1 to 1.4.');

  // Two deltas and no stage between them: the draft grew rather than being replaced, so
  // every draft the reader held is a prefix of the answer they ended with.
  const served = 'Creatinine rose from 1.1 to 1.4.';
  const grown = snapshots.filter((text) => text !== '');
  assert.ok(grown.length >= 2, 'the draft was drawn once, so growth was not observed');
  grown.forEach((text) => {
    assert.equal(served.startsWith(text) || text === served, true,
                 `a draft that is not a prefix of the answer: ${JSON.stringify(text)}`);
  });

  // Nothing was withdrawn from what the reader was shown, so no correction is claimed.
  // The verification pill is a different statement and is allowed to be there.
  const pill = window.document.querySelector('#cp-feed .cp-evidence');
  assert.equal(/Reconciled/.test(pill.textContent), false, 'a false correction was shown');
});

test('a guardrail that did withdraw something still says so', async () => {
  const { window } = await drive([
    frame('answer_delta', { stage: 'answer_delta', text: 'The dose was 12 mg. ' }),
    frame('prose_settled', { swap: 'visible' }),
    frame('answer', { answer: 'The dose could not be verified.', scope: 'patient_chart',
                      verified: true, references: [], follow_ups: [],
                      guardrail_flags: ['dose'] }),
  ]);

  const pill = window.document.querySelector('#cp-feed .cp-evidence');
  assert.equal(pill.hidden, false, 'a withdrawal went unannounced');
  assert.match(pill.textContent, /Reconciled with medical record/);
});

test('a clicked chip declares itself, because the agent cannot tell by reading it', async () => {
  // The chip's wording is the record's own. `routing.asks_about_a_lab_analyte` could not
  // read "Red blood cells" and every attempt to infer provenance from the words shipped
  // a wrong answer, so the console says what it is and the agent stops guessing.
  const chip = 'How does the abnormal discharge Red blood cells (3.47 x10^6/uL) compare '
    + 'to its reference range and trend?';

  const { window, requests, errors } = await drive([
    frame('answer', { answer: 'The red cell count was 3.47 x10^6/uL.',
                      scope: 'patient_chart', verified: true, references: [],
                      follow_ups: [chip] }),
  ]);

  const button = window.document.querySelector('#cp-feed .cp-follow-up');
  assert.ok(button, 'the turn offered no chips');
  assert.match(button.textContent, /Red blood cells/);

  button.click();
  for (let tick = 0; tick < 20; tick += 1) {
    await settle();
    if (requests.filter((entry) => entry.path === '/demo/a2ui/ask/').length > 1) break;
  }

  assert.deepEqual(errors, []);
  const asked = requests.filter((entry) => entry.path === '/demo/a2ui/ask/');
  assert.equal(asked.length, 2, 'the chip did not send a second question');

  const body = JSON.parse(asked[1].options.body);
  assert.equal(body.intent, 'follow_up');
  assert.equal(body.question, chip);
});
