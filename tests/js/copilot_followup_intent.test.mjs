/* Where a chip's declaration goes.

   The reported defect (2026-10-26): clicking a follow-up chip under a `/labs` answer
   produced two loop responses and no citations. The trace showed the second pass was
   forced even though the transcript already held the `get_lab_trends` result the chip
   was generated from — which `route` only does when `intent` did not arrive as
   `follow_up`.

   Three files could have dropped it: this console (the click, the composer's submit),
   the BFF (the payload it forwards), and the agent (the graph's declaration). The
   agent's half is pinned by `tests/agent/test_followup_routing.py`, which drives
   `graph.ask(..., intent="follow_up")` and asserts one pass. This file pins the console's
   half by driving the real scripts in a real DOM: a chip is drawn, clicked, and the
   request that leaves the browser is read back off `fetch`.

   Both ways a chip reaches the screen are covered, because they are two different code
   paths into the same decorator: `presentFollowUps` on a live answer, and the same
   function reached through `fillTurn` when a stored thread is restored. A declaration
   that survives one and not the other is exactly the kind of half-fix this suite exists
   to refuse. */

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

/** The chip the production defect came from, verbatim. */
const CHIP = 'How does the abnormal discharge Red blood cells (3.47 x10^6/uL) compare '
           + 'to its reference range and trend?';

const answer = (followUps) => ({
  answer: 'The red cell count was 3.47 x10^6/uL at discharge, below its reference range.',
  verified: true,
  scope: 'patient_chart',
  references: [],
  follow_ups: followUps,
});

/** Every question body the page posted, in order. */
function posted(requests) {
  return requests
    .filter((entry) => entry.method === 'POST')
    .map((entry) => JSON.parse(entry.options.body));
}

/** Wait for something the page does asynchronously, then report whether it happened. */
async function until(predicate) {
  for (let tick = 0; tick < 25; tick += 1) {
    if (predicate()) return true;
    await settle();
  }
  return predicate();
}

async function submitTheComposer(window) {
  window.document.getElementById('cp-ask').dispatchEvent(
    new window.Event('submit', { cancelable: true, bubbles: true }));
  // The turn is over when the toolbar is revealed, which `retire` does on both paths;
  // `inFlight` clears one microtask later, and a chip clicked before that is a chip
  // whose submit the page ignores.
  await until(() => window.document
    .querySelector('#cp-feed .cp-turn-toolbar:not([hidden])') !== null);
  await settle();
  await settle();
}

test('a chip under a live answer sends the question it asks as a declared follow-up',
  async () => {
    const page = boot({
      threads: { conversations: [] },
      reducedMotion: true,
      answer: () => streamed([frame('answer', answer([CHIP]))]),
    });
    const { window, requests, errors } = page;
    await settle();

    window.document.getElementById('cp-patient-id').value = '90000015';
    // Typed, because an empty composer is a no-op since the blank-submit default went
    // with the `/risk` command (2026-10-26).
    window.document.getElementById('cp-ask-input').value = 'What changed overnight?';
    await submitTheComposer(window);

    const chip = window.document.querySelector('#cp-feed .cp-follow-up');
    assert.notEqual(chip, null, 'the answer drew no follow-up chip');
    assert.equal(chip.textContent.includes('Red blood cells'), true);

    // The turn the chip was drawn under declared nothing: a typed or chip-started
    // question carries intent only when a control said what it was.
    assert.deepEqual(posted(requests).map((body) => body.intent), [undefined],
                     'a question asked with no control in front of it declared an intent');

    chip.click();
    await until(() => posted(requests).length === 2);

    const bodies = posted(requests);
    assert.equal(bodies.length, 2, 'clicking the chip sent no request');
    assert.equal(bodies[1].question, CHIP,
                 'the chip sent something other than the question it displayed');
    assert.equal(bodies[1].intent, 'follow_up',
                 'the click did not declare what it was, so the agent cannot know the '
                 + 'evidence for this question is already in the transcript');
    assert.deepEqual(errors, []);
  });

test('a chip drawn by the pair a restore uses declares the same thing', async () => {
  // `restoreConversation` draws every stored turn through `CopilotFeed.createTurn` +
  // `fillTurn`, which is the same pair a live answer uses. Driving the pair directly
  // rather than through the fetch keeps this test about the decorator: the store → feed
  // restore is `copilot_threads.test.mjs`'s subject, and a chip that arrives on a
  // restore takes this same code path once `fillTurn` hands it `follow_ups`.
  const page = boot({ reducedMotion: true, answer: () => streamed([frame('answer', answer([]))]) });
  const { window, requests, errors } = page;
  await settle();

  window.document.getElementById('cp-patient-id').value = '90000015';
  const block = window.CopilotFeed.createTurn('What changed overnight?');
  await window.CopilotFeed.fillTurn(block, {
    asked: 'What changed overnight?',
    answer: 'Weight up 2 kg overnight, creatinine stable.',
    follow_ups: ['What changed overnight?'],
  });

  const chip = block.root.querySelector('.cp-follow-up');
  assert.notEqual(chip, null, 'a turn built the way a restore builds one drew no chip');
  assert.equal(chip.textContent.includes('What changed overnight?'), true);

  chip.click();
  await until(() => posted(requests).length === 1);

  const bodies = posted(requests);
  assert.equal(bodies.length, 1, 'clicking a restored chip sent no request');
  assert.equal(bodies[0].intent, 'follow_up',
                 'a chip on a turn drawn from the store declared nothing, so the same '
                 + 'question asked from a reopened thread is answered differently');
  assert.deepEqual(errors, []);
});
