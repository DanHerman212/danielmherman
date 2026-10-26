/* Where the workflow sits, and where the viewport stops.

   Two changes, both about a reader keeping their place.

   `Agent workflow - N steps` used to be built at the FOOT of the turn, under the answer.
   On a `/ehr` turn that put it below the fold of a screen the reader had already read past,
   and the question it answers — did the run look in the right places? — is asked before the
   answer is read. It is now inserted directly under the turn's header, above the prose.
   Refreshing the browser used to take it away entirely, because the labels only ever existed
   as progress frames; the agent now records them with the answer (Phase B) and the restore
   path puts them back, with the console's own opening row prepended so a refreshed turn
   shows the same count as the live one.

   And the viewport. The page scrolled to the BOTTOM of the turn both when it was created
   and again when the answer settled, so a long answer arrived with its end on screen and
   every chunk that landed moved the reader's place. The anchor is now the turn's head, set
   once at submit; content grows downward below it and nothing scrolls again.
*/

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import { boot, settle } from './support/page.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const THREADS = readFileSync(
  join(HERE, '..', '..', 'static', 'js', 'copilot_threads.js'), 'utf8');

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

const STEPS = [
  'Planning the Search',
  'Reading the Note Sections',
  'Checking the Answer Against the Evidence',
];

const ANSWER = {
  asked: '/ehr Cynthia Petrov',
  answer: 'The hospital course was uneventful.',
  verified: true,
  scope: 'patient_chart',
  references: [],
  follow_ups: [],
  steps: STEPS,
  a2ui: null,
};

const FRAMES = [
  frame('planning', { stage: 'planning', label: STEPS[0] }),
  frame('tool', { stage: 'tool', label: STEPS[1] }),
  frame('verify', { stage: 'verify', label: STEPS[2] }),
  frame('answer', ANSWER),
];

/** A page with the scroll calls recorded rather than performed. */
function boot_tracking_scroll() {
  const page = boot({
    answer: () => streamed(FRAMES),
    threads: { conversations: [] },
    reducedMotion: true,
  });
  const calls = [];
  page.window.Element.prototype.scrollIntoView = function scrollIntoView(options) {
    calls.push({ node: this, block: options && options.block });
  };
  return { ...page, calls };
}

async function submit(page) {
  const { window } = page;
  await settle();
  window.document.getElementById('cp-patient-id').value = '90000015';
  // A question, because an empty composer sends nothing at all since the blank-submit
  // default was retired — and this file is about what a submitted turn does.
  window.document.getElementById('cp-ask-input').value = 'What happened overnight?';
  window.document.getElementById('cp-ask').dispatchEvent(
    new window.Event('submit', { cancelable: true, bubbles: true }));
  for (let tick = 0; tick < 20; tick += 1) {
    await settle();
    const turn = window.document.querySelector('#cp-feed .cp-turn');
    if (turn && turn.querySelector('.cp-turn-toolbar:not([hidden])')) break;
  }
  return window.document.querySelector('#cp-feed .cp-turn');
}

const labels = (turn) => [...turn.querySelectorAll('.cp-stages-item')]
  .map((item) => item.textContent);

test('the workflow sits under the header, above the answer', async () => {
  const page = boot_tracking_scroll();
  const turn = await submit(page);

  const history = turn.querySelector('.cp-stages');
  assert.ok(history, 'the run left no record of itself');

  // Structural, not cosmetic: the head, then the workflow, then the body. A reader
  // reading top to bottom meets them in that order.
  const order = [...turn.children].map((child) => child.className.split(' ')[0]);
  assert.deepEqual(order, ['cp-turn-head', 'cp-stages', 'cp-turn-body']);

  assert.equal(turn.querySelector('.cp-stages-summary').textContent,
               'Agent workflow - 4 steps');
  assert.deepEqual(labels(turn), ['Sending the question', ...STEPS]);
});

test('a restored turn shows the same workflow the live one showed', async () => {
  const { window } = boot({ threads: { conversations: [] }, reducedMotion: true });
  await settle();

  const feed = window.CopilotFeed;
  const block = feed.createTurn(ANSWER.asked);
  await feed.fillTurn(block, ANSWER);
  block.restore(ANSWER.steps);

  const turn = block.root;
  assert.deepEqual(labels(turn), ['Sending the question', ...STEPS]);
  assert.equal(turn.querySelector('.cp-stages-summary').textContent,
               'Agent workflow - 4 steps');
  assert.equal(turn.querySelector('.cp-stages').hasAttribute('open'), false,
               'a restored workflow should be collapsed until it is asked for');
});

test('a stored turn with no steps draws no workflow bar', async () => {
  const { window } = boot({ threads: { conversations: [] }, reducedMotion: true });
  await settle();

  const feed = window.CopilotFeed;
  const block = feed.createTurn(ANSWER.asked);
  await feed.fillTurn(block, { ...ANSWER, steps: [] });
  block.restore([]);

  assert.equal(block.root.querySelector('.cp-stages'), null,
               'a turn with no recorded steps drew an empty disclosure');
});

test('the restore path hands the turn the steps it stored', () => {
  // The one line this file cannot exercise through the namespace — `openConversation` is
  // private to the thread module — asserted where it lives.
  assert.match(THREADS, /block\.restore\(stored\[index\]\.steps\)/);
});

test('a submitted turn is anchored at its top, and never at its bottom', async () => {
  const page = boot_tracking_scroll();
  const turn = await submit(page);

  assert.equal(page.calls.length, 1,
               `the viewport moved ${page.calls.length} times in one turn`);
  assert.equal(page.calls[0].node, turn, 'the viewport was not anchored on the new turn');
  assert.equal(page.calls[0].block, 'start',
               'the anchor scrolled to the turn\'s bottom rather than its header');

  // The prose and the answer both arrived during that run; neither moved the reader.
  assert.equal(turn.querySelector('.cp-answer-text').textContent, ANSWER.answer);
  assert.deepEqual(page.calls.filter((call) => call.block === 'end'), []);
});
