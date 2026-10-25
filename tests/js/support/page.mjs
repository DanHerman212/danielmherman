/* The console page, for tests that need to run it.

   The page's scripts are classic scripts that find each other through `window` and
   through the DOM: `copilot_threads.js` reads `#cp-feed`, `copilot_canvas.js` reads a
   dozen ids and hands `window.CopilotFeed` back, and the canvas boots the thread module
   at the end of its own file. None of that can be exercised without the elements, so the
   markup below is the page cut down to what the scripts address by name. A missing id is
   a silent early return, which is how a harness comes to test nothing.

   Not a `.test.mjs`, so the runner does not try to execute it as one. */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC_JS = join(HERE, '..', '..', '..', 'static', 'js');

export const source = (name) => readFileSync(join(STATIC_JS, name), 'utf8');

export const PAGE = `<!doctype html><html><body>
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

export const THREADS = {
  conversations: [
    { conversation_id: 11, patient: 'Cynthia Petrov', hadm_id: 90000015, pinned: true },
    { conversation_id: 12, patient: 'Marcus Webb', hadm_id: 90000108, pinned: false },
  ],
};

export const conversation = (pk, patient, hadmId) => ({
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

export const CONVERSATIONS = {
  '/demo/a2ui/conversations/11/': conversation(11, 'Cynthia Petrov', 90000015),
  '/demo/a2ui/conversations/12/': conversation(12, 'Marcus Webb', 90000108),
};

export const reply = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/**
 * One page with the scripts evaluated in the order the template loads them.
 *
 * `routes` maps a request path to a reply; anything unmatched is a 404, so a request the
 * test did not expect fails loudly instead of being answered with something plausible.
 */
export function boot(options = {}) {
  const { routes = CONVERSATIONS, threads = THREADS, reducedMotion = false } = options;
  const dom = new JSDOM(PAGE, {
    url: 'https://danielmherman.test/demo/a2ui/',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  const requests = [];
  const errors = [];

  window.console.error = (...args) => errors.push(args.map(String).join(' '));
  window.matchMedia = () => ({
    matches: reducedMotion, addEventListener() {}, removeEventListener() {},
  });
  // jsdom lays nothing out and implements neither of these; the page uses the first to
  // choose a scroll behaviour and the second to bring a restored thread into view.
  window.Element.prototype.scrollIntoView = function scrollIntoView() {};
  // The markdown streaming path decodes bytes. jsdom's window has no TextDecoder.
  window.TextDecoder = TextDecoder;
  window.TextEncoder = TextEncoder;

  window.fetch = async (url, init) => {
    const path = String(url);
    requests.push({ path, method: (init && init.method) || 'GET', options: init });
    if (path === '/demo/a2ui/conversations/') return reply(threads);
    if (routes[path]) return reply(routes[path]);
    if (path.endsWith('/delete/') || path.endsWith('/pin/')) return reply({ ok: true });
    if (path === '/demo/a2ui/ask/' && options.answer) return options.answer(init);
    return reply({ error: 'no route' }, 404);
  };

  ['copilot_reveal.js', 'copilot_draft.js', 'copilot_tsv.js',
   'copilot_threads.js', 'copilot_canvas.js'].forEach((name) => {
    window.eval(source(name));
  });

  return { dom, window, requests, errors };
}

/** One macrotask turn: every promise the page queued behind a fetch has resolved. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

export function rows(window) {
  return [...window.document.querySelectorAll('#cp-thread-list .cp-thread')];
}

export function rowNamed(window, patient) {
  return rows(window).find((row) => row.textContent.includes(patient));
}

export function menu(window) {
  return window.document.querySelector('.cp-row-menu');
}

export function turnTitles(window) {
  return [...window.document.querySelectorAll('#cp-feed .cp-turn-title')]
    .map((node) => node.textContent);
}
