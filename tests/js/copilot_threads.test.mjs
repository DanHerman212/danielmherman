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


import test from 'node:test';
import assert from 'node:assert/strict';

import { boot, menu, rowNamed, rows, settle, turnTitles } from './support/page.mjs';


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
