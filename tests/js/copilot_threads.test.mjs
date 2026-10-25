/* The thread list, executed.

   `copilot_threads.js` was split out of `copilot_canvas.js` in Phase 5 and kept calling
   helpers that stayed behind: `el`, `createTurn` and `fillTurn`. Nothing caught it. The
   file parses, the Django tests read it as text, and `test_frontend_boundaries.py`
   checked the calls this module makes *through* `canvas()` — which is exactly the shape
   the three broken calls did not have. In production the sidebar threw on its first
   render and the stored-thread restore threw on every open.

   So this loads the real page scripts into a real DOM and drives the paths: the list,
   a row, the row menu, the delete confirmation, the restore of a two-turn thread, the
   sync to another patient, and a new conversation. Every one of those runs the module's
   own code.

   Two assertions carry most of the weight, and neither is about a specific function.
   The row count, because `loadThreads` catches and logs — the original defect produced
   an empty sidebar rather than an exception. And `console.error`, because every path in
   this file that can fail swallows what it caught; a test that only counted rows would
   pass while a second, quieter failure was logged beside it. */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import test from 'node:test';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC_JS = join(HERE, '..', '..', 'static', 'js');

const source = (name) => readFileSync(join(STATIC_JS, name), 'utf8');

/* The page, cut down to the elements these two scripts address. Every id below is one
   the scripts look up by name; a missing one is a silent early return, which is how a
   harness comes to test nothing. */
const PAGE = `<!doctype html><html><body>
  <div id="copilot-shell" data-ask-url="/demo/a2ui/ask/">
    <form id="cp-ask">
      <input type="hidden" name="csrfmiddlewaretoken" value="csrf-token">
      <input id="cp-patient-id" value="">
      <input id="cp-command-intent" value="">
      <textarea id="cp-ask-input"></textarea>
      <span id="remaining"></span>
      <button type="button" id="cp-patient-pill" hidden></button>
      <span id="cp-patient-label"></span>
      <button type="button" id="cp-patient-clear"></button>
      <button type="button" id="cp-new-btn"></button>
      <button type="button" id="cp-search-btn" aria-expanded="false"></button>
      <div id="cp-thread-search" hidden><input id="cp-thread-filter"></div>
      <ul id="cp-thread-list"></ul>
      <p id="cp-threads-empty" hidden></p>
      <div id="cp-context-patient" hidden>
        <span id="cp-context-name"></span><span id="cp-context-hadm"></span>
      </div>
      <span id="cp-context-state"></span>
    </form>
    <div id="cp-feed"
         data-renderer-url="/static/js/bundled/a2ui_clinical.js?v=16"
         data-conversation-url="/demo/a2ui/conversations/0/"
         data-history-url="/demo/a2ui/conversations/"
         data-feedback-url="/demo/api/feedback/"
         data-retention-days="30"></div>
  </div>
</body></html>`;

const THREADS = {
  conversations: [
    { conversation_id: 11, patient: 'Cynthia Petrov', hadm_id: 90000015, pinned: true },
    { conversation_id: 12, patient: 'Marcus Webb', hadm_id: 90000108, pinned: false },
  ],
};

const conversation = (pk, patient, hadmId) => ({
  conversation_id: pk,
  hadm_id: hadmId,
  patient,
  expires_at: '2026-11-24T09:00:00+00:00',
  turns: [
    {
      asked: '/ehr ' + patient,
      answer: 'Admitted with decompensated heart failure.',
      verified: true,
      scope: 'patient_chart',
      references: [],
      follow_ups: ['What changed overnight?'],
    },
    {
      asked: 'What changed overnight?',
      answer: 'Weight up 2 kg overnight, creatinine stable.',
      verified: false,
      scope: null,
      references: [],
      follow_ups: [],
    },
  ],
});

const CONVERSATIONS = {
  '/demo/a2ui/conversations/11/': conversation(11, 'Cynthia Petrov', 90000015),
  '/demo/a2ui/conversations/12/': conversation(12, 'Marcus Webb', 90000108),
};

const reply = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/* One page, its scripts evaluated in the order the template loads them, and a fetch that
   answers from a table. `errors` collects everything the page swallowed. */
function boot() {
  const dom = new JSDOM(PAGE, {
    url: 'https://danielmherman.test/demo/a2ui/',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  const requests = [];
  const errors = [];

  window.console.error = (...args) => errors.push(args.map(String).join(' '));
  window.matchMedia = () => ({
    matches: false, addEventListener() {}, removeEventListener() {},
  });
  // jsdom lays nothing out, so `scrollIntoView` does not exist. The page calls it to
  // bring a restored thread into view; that it is called at all is asserted elsewhere.
  window.Element.prototype.scrollIntoView = function scrollIntoView() {};

  window.fetch = async (url, options) => {
    const path = String(url);
    requests.push({ path, method: (options && options.method) || 'GET', options });
    if (path === '/demo/a2ui/conversations/') return reply(THREADS);
    if (CONVERSATIONS[path]) return reply(CONVERSATIONS[path]);
    if (path.endsWith('/delete/') || path.endsWith('/pin/')) return reply({ ok: true });
    return reply({ error: 'no route' }, 404);
  };

  ['copilot_reveal.js', 'copilot_draft.js', 'copilot_tsv.js',
   'copilot_threads.js', 'copilot_canvas.js'].forEach((name) => {
    window.eval(source(name));
  });

  return { dom, window, requests, errors };
}

/* One macrotask turn: every promise the page queued behind a fetch has resolved by the
   time this returns. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function rows(window) {
  return [...window.document.querySelectorAll('#cp-thread-list .cp-thread')];
}

function rowNamed(window, patient) {
  return rows(window).find((row) => row.textContent.includes(patient));
}

function menu(window) {
  return window.document.querySelector('.cp-row-menu');
}

function turnTitles(window) {
  return [...window.document.querySelectorAll('#cp-feed .cp-turn-title')]
    .map((node) => node.textContent);
}

test('the sidebar draws a row per stored thread, with the pin it carries', async () => {
  const { window, errors } = boot();
  await settle();

  assert.deepEqual(errors, [], 'the page swallowed an error while drawing the list');

  const drawn = rows(window);
  assert.equal(drawn.length, 2, 'the thread list rendered no rows');
  assert.match(drawn[0].textContent, /Cynthia Petrov/);
  assert.match(drawn[1].textContent, /Marcus Webb/);
  // The pin is the one mark a row carries, and it is a node `threadRow` builds itself.
  assert.equal(drawn[0].querySelector('.cp-thread-pin') !== null, true);
  assert.equal(drawn[1].querySelector('.cp-thread-pin'), null);
});

test('a row opens the stored thread, and every turn is drawn by the feed', async () => {
  const { window, errors, requests } = boot();
  await settle();

  rowNamed(window, 'Cynthia Petrov').querySelector('.cp-thread-open').click();
  await settle();
  await settle();

  assert.deepEqual(errors, [], 'the page swallowed an error while restoring a thread');
  assert.deepEqual(requests.map((entry) => entry.path), [
    '/demo/a2ui/conversations/',
    '/demo/a2ui/conversations/11/',
  ]);

  // Both turns, in order, drawn by `createTurn` + `fillTurn` through the namespace.
  assert.deepEqual(turnTitles(window), [
    '/ehr Cynthia Petrov',
    'What changed overnight?',
  ]);
  const answers = [...window.document.querySelectorAll('#cp-feed .cp-answer-text')]
    .map((node) => node.textContent);
  assert.match(answers[0], /decompensated heart failure/);
  assert.match(answers[1], /creatinine stable/);

  // The row for the thread on screen says so, and the context bar follows the patient.
  assert.equal(rowNamed(window, 'Cynthia Petrov')
    .querySelector('.cp-thread-open').getAttribute('aria-current'), 'true');
  assert.equal(window.document.getElementById('cp-context-name').textContent,
               'Cynthia Petrov');
  assert.equal(window.document.getElementById('cp-context-hadm').textContent, '#90000015');
  assert.match(window.document.getElementById('cp-context-state').textContent,
               /Saved until/);
});

test('the row menu opens on the row it belongs to and offers the two actions', async () => {
  const { window, errors } = boot();
  await settle();

  const row = rowNamed(window, 'Marcus Webb');
  const toggle = row.querySelector('.cp-thread-menu-btn');
  toggle.click();

  assert.deepEqual(errors, []);
  assert.equal(menu(window).hidden, false);
  assert.deepEqual([...menu(window).querySelectorAll('.cp-row-menu-item')]
    .map((node) => node.textContent), ['Pin', 'Delete']);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');

  // Clicking the same control again closes it rather than reopening it a pixel away.
  toggle.click();
  assert.equal(menu(window).hidden, true);
});

test('deleting a thread asks first, and cancelling goes back to the menu', async () => {
  const { window, errors } = boot();
  await settle();

  const toggle = rowNamed(window, 'Marcus Webb').querySelector('.cp-thread-menu-btn');
  toggle.click();
  const danger = () => [...menu(window).querySelectorAll('.cp-row-menu-item')]
    .find((node) => node.textContent === 'Delete');

  danger().click();
  assert.deepEqual(errors, []);
  assert.equal(menu(window).querySelector('.cp-row-menu-prompt').textContent,
               'Delete this thread?');

  [...menu(window).querySelectorAll('.cp-row-menu-item')]
    .find((node) => node.textContent === 'Cancel').click();

  // Cancel returns to the menu, because dismissing the question is not dismissing the
  // control the reader came for.
  assert.deepEqual([...menu(window).querySelectorAll('.cp-row-menu-item')]
    .map((node) => node.textContent), ['Pin', 'Delete']);
});

test('confirming the delete removes the thread and re-reads the list', async () => {
  const { window, errors, requests } = boot();
  await settle();

  rowNamed(window, 'Marcus Webb').querySelector('.cp-thread-menu-btn').click();
  [...menu(window).querySelectorAll('.cp-row-menu-item')]
    .find((node) => node.textContent === 'Delete').click();
  [...menu(window).querySelectorAll('.cp-row-menu-item')]
    .find((node) => node.textContent === 'Delete').click();
  await settle();

  assert.deepEqual(errors, []);
  const posted = requests.find((entry) => entry.method === 'POST');
  assert.equal(posted.path, '/demo/a2ui/conversations/12/delete/');
  assert.equal(posted.options.headers['X-CSRFToken'], 'csrf-token');
  assert.equal(requests.filter((entry) => entry.path === '/demo/a2ui/conversations/').length,
               2, 'the list was not re-read after the delete');
});

test('a new conversation empties the canvas and unpins the patient', async () => {
  const { window, errors } = boot();
  await settle();

  rowNamed(window, 'Cynthia Petrov').querySelector('.cp-thread-open').click();
  await settle();
  await settle();
  assert.equal(turnTitles(window).length, 2);

  window.document.getElementById('cp-new-btn').click();

  assert.deepEqual(errors, []);
  assert.deepEqual(turnTitles(window), []);
  assert.equal(window.document.getElementById('cp-context-patient').hidden, true);
});

test('asking about another patient opens that patient\'s thread', async () => {
  const { window, errors } = boot();
  await settle();

  // The feed syncs the canvas to the composer's patient before it sends anything; this
  // is that call, and it is the path that threw on every `send`.
  await window.CopilotThreads.syncToPatient(90000108);
  await settle();

  assert.deepEqual(errors, []);
  assert.deepEqual(turnTitles(window), [
    '/ehr Marcus Webb',
    'What changed overnight?',
  ]);
  assert.equal(window.document.getElementById('cp-context-name').textContent, 'Marcus Webb');

  // The same patient again is not a second fetch.
  await window.CopilotThreads.syncToPatient(90000108);
  assert.equal(window.CopilotThreads.conversationId(), 12);
});

test('a patient nobody has asked about leaves the canvas empty', async () => {
  const { window, errors, requests } = boot();
  await settle();

  rowNamed(window, 'Cynthia Petrov').querySelector('.cp-thread-open').click();
  await settle();
  await settle();
  const before = requests.length;

  await window.CopilotThreads.syncToPatient(99999999);

  assert.deepEqual(errors, []);
  // No conversation route was asked for: there is no thread to ask about.
  assert.equal(requests.length, before, 'a thread was fetched for an unknown patient');
  assert.deepEqual(turnTitles(window), []);
  assert.equal(window.CopilotThreads.conversationId(), null);
});
