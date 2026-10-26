/* An empty composer is not a question.

   Until 2026-10-26 the submit handler read `if (!intent && !typed) intent = 'risk'`, so
   pressing Enter with a patient selected but nothing typed ran the readmission-risk
   command. That command is gone — the estimate is drawn by `/ehr` beside the summary
   that explains it — and with it goes the default. An empty submission now does nothing
   at all: no turn, no request, no credit.

   The refusal that is still worth drawing is the other one: text with no patient in
   front of it. That is a question the reader did ask, and the answer to it is "choose a
   patient first". */

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

const ANSWER = { answer: 'Discharged home in stable condition.', verified: true,
                 scope: null, references: [], follow_ups: [] };

async function until(predicate) {
  for (let tick = 0; tick < 20; tick += 1) {
    if (predicate()) return true;
    await settle();
  }
  return predicate();
}

function booted() {
  return boot({
    threads: { conversations: [] },
    reducedMotion: true,
    answer: () => streamed([frame('answer', ANSWER)]),
  });
}

function submit(window) {
  window.document.getElementById('cp-ask').dispatchEvent(
    new window.Event('submit', { cancelable: true, bubbles: true }));
}

const posted = (requests) => requests
  .filter((entry) => entry.method === 'POST')
  .map((entry) => JSON.parse(entry.options.body));

test('an empty composer with a patient selected sends nothing at all', async () => {
  const { window, requests, errors } = booted();
  await settle();

  window.document.getElementById('cp-patient-id').value = '90000015';
  submit(window);
  await settle();
  await settle();

  assert.deepEqual(posted(requests), [], 'an empty composer asked the agent something');
  assert.equal(window.document.querySelectorAll('#cp-feed .cp-turn').length, 0,
               'an empty composer drew a turn');
  // Nothing was said into an empty row, either: the reader gets no error for pressing
  // Enter with nothing to send.
  assert.deepEqual(errors, []);
});

test('an empty composer with no patient selected is silent too, not a refusal', async () => {
  const { window, requests, errors } = booted();
  await settle();

  submit(window);
  await settle();

  assert.deepEqual(posted(requests), []);
  assert.equal(window.document.querySelectorAll('#cp-feed .cp-turn').length, 0);
  assert.deepEqual(errors, []);
});

test('typed text with no patient selected is still refused, in the feed', async () => {
  const { window, requests, errors } = booted();
  await settle();

  window.document.getElementById('cp-ask-input').value = 'Why was this patient flagged?';
  submit(window);
  await settle();

  assert.deepEqual(posted(requests), []);
  const answer = window.document.querySelector('#cp-feed .cp-answer-text');
  assert.notEqual(answer, null, 'the refusal was not drawn');
  assert.match(answer.textContent, /Choose a patient first/);
  assert.deepEqual(errors, []);
});

test('a typed /risk is sent as text, so the agent can refuse it by name', async () => {
  const { window, requests, errors } = booted();
  await settle();

  window.document.getElementById('cp-patient-id').value = '90000015';
  window.document.getElementById('cp-ask-input').value = '/risk';
  submit(window);
  await until(() => posted(requests).length === 1);

  const bodies = posted(requests);
  assert.equal(bodies.length, 1, 'typing /risk sent nothing, so the reader cannot learn '
                                 + 'that the command is gone');
  // The console does not resolve a retired command to anything: no chip, and no declared
  // intent. The question travels as what was typed, and the refusal comes back with it.
  assert.equal(bodies[0].question, '/risk');
  assert.equal(bodies[0].intent, undefined);
  assert.equal(bodies[0].chip, undefined,
               'a retired command was resolved against the composer vocabulary');
  assert.deepEqual(errors, []);
});
