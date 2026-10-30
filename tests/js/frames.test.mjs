/* The frame vocabulary and the turn structure, frozen before the web layer is refactored.

   Phase 0 of the frontend refactor (`docs/site_redesign/01-frontend_inventory_and_refactor_plan.md`).
   These are the two client-side facts that Phases 3-6 will move code around: the names
   the proxy and the console use for the same SSE frames, and the DOM a settled turn is
   made of. Neither is covered anywhere else.

   The frame names are read out of both sources rather than restated. They are split
   across a Python string and a JavaScript comparison, and until now nothing tied the two
   together: `answer_delta` and `prose_settled` appear in no Python test at all, and the
   existing JavaScript tests build their own frames instead of writing the bytes the
   proxy writes.

   The structure is a golden tree. `presentFacts` and `fillTurn` assemble nine nested
   elements per turn, four of them conditionally shown; a split that moves one of them
   into another module, or a stylesheet pass that renames one, changes what a reader sees
   and changes nothing any existing test asserts. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { boot, settle } from './support/page.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

/** The text of every target given: files as they are, directories by their sources.

    Package-aware on purpose. Phase 4 moves the ask proxy out of `demo/views.py` into
    `demo/ask/`, and this file is frozen as read-only when it lands; scanning a span of
    the tree is what lets that move happen without editing the scanner. Test modules are
    skipped when walking a directory — a `demo/ask/tests.py` would otherwise contribute
    its mocks' own `_sse` calls to the frame vocabulary. */
function textOf(...targets) {
  const texts = [];
  for (const target of targets) {
    let stats;
    try {
      stats = statSync(target);
    } catch {
      continue;  // not present yet: `demo/ask/` arrives in Phase 4
    }
    if (stats.isFile()) {
      texts.push(readFileSync(target, 'utf8'));
      continue;
    }
    const names = readdirSync(target, { recursive: true })
      .map(String)
      .filter((name) => name.endsWith('.py') || name.endsWith('.js'))
      .filter((name) => !/(^|\/)(tests?\.py|test_[^/]*\.py)$/.test(name))
      .sort();
    for (const name of names) texts.push(readFileSync(join(target, name), 'utf8'));
  }
  return texts.join('\n');
}

/* Where the proxy emits a frame today, and wherever Phase 4 puts it. */
const VIEWS = textOf(join(ROOT, 'demo', 'views.py'), join(ROOT, 'demo', 'ask'));
/* Where the console handles a frame today, and every module Phase 5 splits out of it.
   `bundled/` is excluded twice over: it is build output, and it is not `copilot_*`. */
const CONSOLE_MODULES = readdirSync(join(ROOT, 'static', 'js'))
  .filter((name) => /^copilot_.*\.js$/.test(name))
  .sort()
  .map((name) => join(ROOT, 'static', 'js', name));
const CANVAS = textOf(...CONSOLE_MODULES);

/** Every frame name the console branches on, as `if (name === '…')`. */
const handledNames = () =>
  [...CANVAS.matchAll(/if \(name === '([a-z_]+)'\)/g)].map((match) => match[1]);

/** Every frame name the proxy writes itself, as `_sse('…'`. */
const emittedNames = () =>
  [...VIEWS.matchAll(/_sse\('([a-z_]+)'/g)].map((match) => match[1]);

/** Every frame name the proxy inspects, as `event == '…'`. */
const inspectedNames = () =>
  [...VIEWS.matchAll(/event == '([a-z_]+)'/g)].map((match) => match[1]);

/* ------------------------------------------------------------------------- */
/* 1. The frame vocabulary                                                    */
/* ------------------------------------------------------------------------- */

test('the console handles exactly the four frames the run can carry', () => {
  assert.deepEqual(handledNames().sort(),
    ['answer', 'answer_delta', 'error', 'prose_settled']);
});

test('the two frames the proxy constructs are frames the console handles', () => {
  const emitted = emittedNames();

  assert.deepEqual([...new Set(emitted)].sort(), ['answer', 'error']);
  for (const name of emitted) {
    assert.ok(handledNames().includes(name),
      `views.py emits "${name}" and copilot_canvas.js does not handle it`);
  }
});

test('the proxy branches on its two terminal frames and relays the rest untouched', () => {
  /* `answer_delta` and `prose_settled` are the agent's, not the proxy's: they are
     relayed byte for byte, which is what lets the prose arrive while the chain is still
     working. A comparison added here would be the proxy starting to interpret a frame it
     is supposed to pass through — and the first symptom would be a stream that stops
     showing its draft. */
  assert.deepEqual([...new Set(inspectedNames())].sort(), ['answer', 'error']);
});

test('the answer frame the proxy writes is the frame the console reads the payload from', () => {
  /* The one name both ends depend on most: the terminal frame carrying the whole
     envelope. If either side renames it, an answer arrives and nothing is drawn. */
  assert.ok(emittedNames().includes('answer'));
  assert.ok(handledNames().includes('answer'));
});

test('the scanners read the sources they claim to read', () => {
  /* A scanner that finds nothing asserts nothing, and every test above would pass over
     an empty string. When Phase 4 moves `a2ui_ask` out of `views.py` this is what says
     whether the new location is being read. */
  assert.ok(CONSOLE_MODULES.some((name) => name.endsWith('copilot_canvas.js')),
    'the console modules were not found');
  assert.match(VIEWS, /def a2ui_ask\(/,
    'no ask endpoint was found in views.py or demo/ask/');
  assert.ok(handledNames().length > 0);
  assert.ok(emittedNames().length > 0);
});

/* ------------------------------------------------------------------------- */
/* 2. The settled turn's structure                                            */
/* ------------------------------------------------------------------------- */

/* An answer with every piece of chrome the turn can carry and no composed surface:
   `a2ui: null` keeps the renderer out of it, so what is asserted below is the page's own
   markup rather than a Lit element's shadow tree. */
const ANSWER = {
  answer: 'The discharge note lists warfarin 4 mg daily.^[1]',
  verified: true,
  scope: 'patient_chart',
  references: [
    { index: 1, title: 'Discharge medications', tag: 'Clinical Note',
      excerpt: 'warfarin 4 mg QD' },
  ],
  follow_ups: ['What dose of metoprolol was she on?'],
  a2ui: null,
};

async function settledTurn(payload) {
  const page = boot({ threads: { conversations: [] }, reducedMotion: true });
  await settle();
  const block = page.window.CopilotFeed.createTurn('/meds');
  /* The order `send()` uses, and the order matters: `finish` retires the live status row
     and reveals the toolbar and the rating strip, then the answer is filled in. A turn
     asserted without it is a turn still mid-run, and the two have different children. */
  block.finish();
  await page.window.CopilotFeed.fillTurn(block, payload);
  await settle();
  return { ...page, block };
}

const find = (window, selector) => window.document.querySelector(selector);
const findAll = (window, selector) => [...window.document.querySelectorAll(selector)];

test('a settled turn keeps the article/header/body hierarchy', async () => {
  const { window } = await settledTurn(ANSWER);

  const turn = find(window, '#cp-feed > article.cp-turn');
  assert.ok(turn, 'the turn is not an article at the top of the feed');

  /* Header, then body. The footer that carried the live status row is gone by the time
     the turn is settled — "Answered" is the absence of news dressed as a status — and
     the run's own history takes its place under the header when there was one. */
  const children = [...turn.children].map((node) => node.className);
  assert.deepEqual(children, ['cp-turn-head', 'cp-turn-body']);

  assert.equal(turn.querySelector('.cp-turn-head > h2.cp-turn-title').textContent,
    '/meds');

  /* The answer section and the trail are the body's two halves: what the answer is, and
     what surrounds it. Phase 3's first extraction moves the second one out, so this is
     the boundary it has to preserve. */
  const body = turn.querySelector('.cp-turn-body');
  assert.deepEqual([...body.children].map((node) => node.className),
    ['cp-answer', 'cp-turn-trail']);

  const answer = turn.querySelector('.cp-answer');
  assert.deepEqual([...answer.children].map((node) => node.className),
    ['cp-canvas', 'cp-answer-text']);
  assert.match(answer.querySelector('.cp-answer-text').textContent, /warfarin 4 mg/);
});

test('the header carries the scope pill and the verified badge', async () => {
  const { window } = await settledTurn(ANSWER);
  const head = find(window, '.cp-turn-head');

  const scope = head.querySelector('.cp-scope');
  assert.equal(scope.hidden, false);
  assert.equal(scope.textContent, 'Patient Chart Synthesis');

  const badge = head.querySelector('.cp-evidence');
  assert.equal(badge.hidden, false);
  assert.match(badge.textContent, /Verified against the chart/);
  /* The specific account of what was checked rides on the title; the pill stays short. */
  assert.match(badge.title, /checked against the patient record/);
});

test('the trail holds the references drawer, the follow-ups, and the rating controls', async () => {
  const { window } = await settledTurn(ANSWER);
  const trail = find(window, '.cp-turn-trail');

  assert.deepEqual([...trail.children].map((node) => node.className),
    ['cp-references', 'cp-follow-ups', 'cp-turn-actions']);

  const drawer = trail.querySelector('details.cp-references');
  assert.equal(drawer.hidden, false);
  assert.equal(drawer.open, true, 'the evidence is open, not behind a control');
  assert.equal(drawer.querySelector('summary').textContent, 'References');

  const row = drawer.querySelector('ol.cp-reference-list > li.cp-reference-item');
  assert.ok(row, 'the drawer published no rows');
  assert.equal(row.dataset.referenceIndex, '1');
  /* The number is a gutter of its own, the tag says what kind of source it is, and the
     passage is in the row: an audit trail that only named a section would send the
     reader somewhere else to check the claim. */
  assert.equal(row.querySelector('.cp-reference-index').textContent, '1.');
  assert.equal(row.querySelector('.cp-reference-tag').textContent, 'Clinical Note');
  assert.equal(row.querySelector('.cp-reference-head .cp-reference-title').textContent,
    'Discharge medications');
  assert.equal(row.querySelector('.cp-reference-excerpt').textContent,
    'warfarin 4 mg QD');

  const followUp = trail.querySelector('.cp-follow-ups > button.cp-follow-up');
  assert.ok(followUp, 'the follow-up rows did not render');
  assert.equal(followUp.querySelector('.cp-follow-up-text').textContent,
    'What dose of metoprolol was she on?');
  assert.equal(trail.querySelector('.cp-follow-ups').hidden, false);

  /* The rating strip and the copy/export toolbar belong to a turn that is over: a
     rating of an answer still being written is a rating of a question, and there is
     nothing to copy until the answer is final. */
  assert.equal(trail.querySelector('.cp-turn-actions').hidden, false);
  const toolbar = find(window, '.cp-turn-head > .cp-turn-toolbar');
  assert.ok(toolbar, 'the turn toolbar is missing from the header');
  assert.equal(toolbar.hidden, false);
});

test("the run's own route is a disclosure under the header", async () => {
  const page = boot({ threads: { conversations: [] }, reducedMotion: true });
  await settle();
  const block = page.window.CopilotFeed.createTurn('/labs');
  block.stage('Reading the Laboratory Panel');
  block.finish();
  await page.window.CopilotFeed.fillTurn(block, ANSWER);
  await settle();

  const turn = find(page.window, '#cp-feed > article.cp-turn');
  /* Before the body, not after it: a reader checking whether the assistant looked in the
     right places wants that before the prose, and at the foot of a long answer it sits
     below the fold of a screen they have already read past. */
  assert.deepEqual([...turn.children].map((node) => node.className),
    ['cp-turn-head', 'cp-stages', 'cp-turn-body']);
  assert.match(turn.querySelector('.cp-stages-summary').textContent,
    /Agent workflow - 2 steps/);
  assert.equal(turn.querySelectorAll('.cp-stages-list > .cp-stages-item').length, 2);
});

test('a turn with nothing to show draws no chrome rather than an empty one', async () => {
  /* The other half of the golden tree: every conditional element is present in the DOM
     and hidden, so the stylesheet can show it without a re-render, and a reader is never
     offered a drawer that opens onto nothing. */
  const { window } = await settledTurn({
    answer: 'No discharge medication information is available.',
    verified: false, scope: null, references: [], follow_ups: [], a2ui: null,
  });

  const turn = find(window, '#cp-feed > article.cp-turn');
  assert.equal(turn.querySelector('.cp-scope').hidden, true);
  assert.equal(turn.querySelector('.cp-evidence').hidden, true);
  assert.equal(turn.querySelector('.cp-references').hidden, true);
  assert.equal(turn.querySelector('.cp-references').children.length, 0);
  assert.equal(turn.querySelector('.cp-follow-ups').hidden, true);
  assert.match(turn.querySelector('.cp-answer-text').textContent,
    /No discharge medication information/);
});
