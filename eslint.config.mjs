/* Lint configuration for the console's page scripts, and nothing else.

   One rule is on: `no-undef`. It is here because a free identifier survives everything
   this repository had. `node --check` parses a file and says nothing about whether the
   names in it exist; the Django tests read the source as text; and the DOM tests drive
   the paths they know about. On 2026-10-25 a Phase 5 split left `el`, `createTurn` and
   `fillTurn` inside `copilot_canvas.js`'s closure while `copilot_threads.js` still called
   them, and every one of those gates passed. The sidebar threw on its first render and
   the stored-thread restore threw on every open, in production.

   These files are classic scripts on purpose — no modules, no build step — so
   `sourceType` is `script` and the browser globals are declared rather than discovered.
   Only the `copilot_*.js` page scripts are linted. The bundle's sources are ES modules
   with imports and belong to Vite; `a2ui_clinical_components.js` is excluded because a
   module's free identifiers are its imports, which Vite resolves and ESLint would have
   to be told about twice. */

const BROWSER = {
  console: 'readonly',
  document: 'readonly',
  fetch: 'readonly',
  navigator: 'readonly',
  sessionStorage: 'readonly',
  localStorage: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  URL: 'readonly',
  Blob: 'readonly',
  AbortController: 'readonly',
  TextDecoder: 'readonly',
  FileReader: 'readonly',
  NodeFilter: 'readonly',
  CustomEvent: 'readonly',
  Event: 'readonly',
  FormData: 'readonly',
  performance: 'readonly',
  matchMedia: 'readonly',
  getComputedStyle: 'readonly',
  innerWidth: 'readonly',
  innerHeight: 'readonly',
  window: 'readonly',
  import: 'readonly',
};

export default [
  {
    files: ['static/js/copilot_shell.js', 'static/js/copilot_app.js',
            'static/js/copilot_composer.js', 'static/js/copilot_threads.js',
            'static/js/copilot_tsv.js', 'static/js/copilot_reveal.js',
            'static/js/copilot_draft.js', 'static/js/copilot_canvas.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: BROWSER,
    },
    rules: {
      'no-undef': 'error',
    },
  },
];
