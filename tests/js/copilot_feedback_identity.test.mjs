/* A rating names the stored row the turn was drawn from — never a page counter.

   Until 2026-10-30 the console composed `turn_id` as `<conversation>:<n>` from
   `++turnOrdinal`, incremented per turn the PAGE drew. That counter starts at 1 on
   every load, so a rating on a restored thread named whichever answer came first in the
   conversation, and on a thread longer than the page had drawn it named nothing at all
   — the server logged `219:12 has no stored answer to score`, and four minutes later
   `219:1` for the same conversation.

   The identity now comes from the payload: `envelope.for_client` sends the stored row's
   key with a live answer and `turn_payloads` sends it with every restored turn. Both
   paths reach the turn through `presentFacts`, which is what these tests drive, and the
   click reads it at click time rather than at build time.

   The failure this guards is quiet and worse than a missing score: a rating attached to
   the wrong trace reads, in a review of "answers a clinician rated badly", as a
   judgement about an answer nobody rated. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { boot, settle } from './support/page.mjs';

const encoder = new TextEncoder();

const FEEDBACK = '/demo/api/feedback/';

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

/** The rating requests the page sent, in order. */
function ratings(requests) {
  return requests
    .filter((entry) => entry.path === FEEDBACK)
    .map((entry) => JSON.parse(entry.options.body));
}

/** One turn drawn the way the restore path draws it: create, then fill. */
async function restore(window, asked, turnId) {
  const block = window.CopilotFeed.createTurn(asked);
  const payload = { asked, answer: 'An answer.', scope: 'patient_chart' };
  if (turnId !== undefined) payload.turn_id = turnId;
  await window.CopilotFeed.fillTurn(block, payload);
  return block;
}

/** Click a rating control on one turn, by its accessible name. */
function rate(block, label) {
  const button = block.root.querySelector(`[title="${label}"]`);
  assert.notEqual(button, null, `the turn draws no ${label} control`);
  button.click();
}

test('a rating on a restored thread names that turn, not the first one', async () => {
  const page = boot({
    threads: { conversations: [] },
    reducedMotion: true,
    routes: { [FEEDBACK]: {} },
  });
  const { window, requests } = page;
  await settle();
  window.document.getElementById('cp-patient-id').value = '90000015';

  // Two restored turns, as a reloaded thread draws them.
  await restore(window, 'First question?', 101);
  const second = await restore(window, 'Second question?', 202);

  rate(second, 'Helpful answer');
  await settle();

  const sent = ratings(requests);
  assert.equal(sent.length, 1, 'the click sent no rating');
  assert.equal(sent[0].turn_id, '202',
               'the rating named something other than the row this turn was drawn from');
  assert.equal(sent[0].score, 1);
});

test('a rating on the first of two turns names the first, not the newest', async () => {
  // The other direction, because "the latest payload wins" would pass the test above
  // and be wrong for every turn but the last one on the page.
  const page = boot({
    threads: { conversations: [] },
    reducedMotion: true,
    routes: { [FEEDBACK]: {} },
  });
  const { window, requests } = page;
  await settle();
  window.document.getElementById('cp-patient-id').value = '90000015';

  const first = await restore(window, 'First question?', 101);
  await restore(window, 'Second question?', 202);

  rate(first, 'Unhelpful answer');
  await settle();

  const sent = ratings(requests);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].turn_id, '101');
  assert.equal(sent[0].score, -1);
});

test('a live answer is rated by the row it was stored as', async () => {
  // The live path reaches the turn through the same `presentFacts`, but through a
  // streamed `answer` frame rather than a restore payload, so it is driven here the way
  // the reader drives it: type, submit, then rate.
  const page = boot({
    threads: { conversations: [] },
    reducedMotion: true,
    routes: { [FEEDBACK]: {} },
    answer: () => streamed([frame('answer', {
      answer: 'Weight up 2 kg overnight.',
      scope: 'patient_chart',
      conversation_id: 77,
      turn_id: 303,
    })]),
  });
  const { window, requests } = page;
  await settle();
  window.document.getElementById('cp-patient-id').value = '90000015';
  window.document.getElementById('cp-ask-input').value = 'What changed overnight?';

  window.document.getElementById('cp-ask').dispatchEvent(
    new window.Event('submit', { cancelable: true, bubbles: true }));
  // The turn is over when its rating control exists; `inFlight` clears a microtask
  // later, which is why the click waits for the control rather than for the submit.
  for (let tick = 0; tick < 25; tick += 1) {
    if (window.document.querySelector('#cp-feed [title="Helpful answer"]')) break;
    await settle();
  }

  const button = window.document.querySelector('#cp-feed [title="Helpful answer"]');
  assert.notEqual(button, null, 'the answered turn drew no rating control');
  button.click();
  await settle();

  const sent = ratings(requests);
  assert.equal(sent.length, 1, 'the click sent no rating');
  assert.equal(sent[0].turn_id, '303');
});

test('a turn the server did not store sends nothing at all', async () => {
  // No conversation, so no row: the answer carries no `turn_id`. The console used to
  // send `unsaved:1` and leave the server to drop it; there is nothing to send.
  const page = boot({
    threads: { conversations: [] },
    reducedMotion: true,
    routes: { [FEEDBACK]: {} },
  });
  const { window, requests } = page;
  await settle();
  window.document.getElementById('cp-patient-id').value = '90000015';

  const block = await restore(window, 'No admission, no thread?');
  rate(block, 'Helpful answer');
  await settle();

  assert.deepEqual(ratings(requests), []);
});
