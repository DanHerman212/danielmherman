/**
 * Demo console: send a question, render the A2UI risk card.
 *
 * Loaded as an ES module. The A2UI graph is imported by literal
 * /static/vendor/a2ui/ paths rather than through {% static %} on purpose —
 * CompressedManifestStaticFilesStorage hashes filenames but does NOT rewrite ES
 * import specifiers, so a hashed entry file would still import its 383
 * dependencies by their unhashed names. Referencing the whole graph unhashed
 * keeps it internally consistent. The filenames carry their package versions,
 * which is the cache-busting that actually matters here.
 *
 * Every render path has a text fallback (R8). The card is the nice version of
 * the answer, never the only version — if the renderer fails to boot, the user
 * still gets the assessment.
 */

const VENDOR = '/static/vendor/a2ui/';
const MODULES = {
  webCore: VENDOR + 'a2ui_web_core_0.10.5_v0_9_external_lit_zod.js',
  litRenderer: VENDOR + 'a2ui_lit_0.10.2_v0_9_external_lit_zod.js',
  context: VENDOR + 'lit_context_1.1.6_external_lit.js',
  markdown: VENDOR + 'a2ui_markdown-it_0.1.0.js',
};

const root = document.getElementById('demo-root');
const askUrl = root.dataset.askUrl;
const output = document.getElementById('output');
const surfaceHost = document.getElementById('surface-host');
const proseEl = document.getElementById('prose');
const remainingEl = document.getElementById('remaining');
const patients = document.getElementById('patients');

let processor = null;
let rendererError = null;

/** Django requires the CSRF token on POST even for same-origin JSON. */
function csrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? match[1] : '';
}

function setStatus(message, isError = false) {
  output.hidden = false;
  output.textContent = message;
  output.classList.toggle('demo-status--error', isError);
}

/**
 * Boot the renderer once, lazily.
 *
 * Failure here is not fatal: rendererError is recorded and every later answer
 * falls back to text. A demo that shows plain text beats a demo that shows
 * nothing.
 */
async function ensureRenderer() {
  if (processor || rendererError) return;
  try {
    const [webCore, litRenderer, litContext, markdownIt] = await Promise.all([
      import(MODULES.webCore),
      import(MODULES.litRenderer),
      import(MODULES.context),
      import(MODULES.markdown),
    ]);

    // A2UI text properties are Markdown — `variant: 'h2'` prepends "## " rather
    // than emitting a heading element. Without this provider the user reads the
    // literal hashes. The renderer arrives via Lit context, so the provider must
    // sit above <a2ui-surface> in the DOM.
    new litContext.ContextProvider(surfaceHost, {
      context: litRenderer.Context.markdown,
      initialValue: markdownIt.renderMarkdown,
    });

    processor = new webCore.MessageProcessor([litRenderer.basicCatalog]);
    processor.onSurfaceCreated((surface) => {
      const el = document.createElement('a2ui-surface');
      el.surface = surface;          // property binding, not an attribute
      surfaceHost.replaceChildren(el);
    });
  } catch (err) {
    rendererError = err;
    console.error('A2UI renderer failed to load; falling back to text.', err);
  }
}

function showFallback(text) {
  surfaceHost.replaceChildren();
  surfaceHost.hidden = true;
  proseEl.hidden = false;
  proseEl.textContent = text;
}

async function renderCard(card, answer) {
  await ensureRenderer();

  if (!processor || !card) {
    showFallback((card && card.fallback_text) || answer || 'No answer returned.');
    return;
  }

  try {
    surfaceHost.hidden = false;
    processor.processMessages(card.messages);
  } catch (err) {
    console.error('A2UI render failed; falling back to text.', err);
    showFallback(card.fallback_text || answer || 'No answer returned.');
    return;
  }

  // The narration is shown next to the card, not instead of it: the card is the
  // numbers, the prose is the model's reading of them.
  proseEl.hidden = !answer;
  proseEl.textContent = answer || '';
}

async function ask(body, pendingMessage) {
  setStatus(pendingMessage);
  surfaceHost.hidden = true;
  proseEl.hidden = true;

  let response;
  let data;
  try {
    response = await fetch(askUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken() },
      body: JSON.stringify(body),
    });
    data = await response.json();
  } catch (err) {
    setStatus(`Request failed: ${err}`, true);
    return;
  }

  if (typeof data.remaining === 'number') remainingEl.textContent = data.remaining;

  if (!response.ok) {
    setStatus(data.error || `HTTP ${response.status}`, true);
    return;
  }

  output.hidden = true;
  await renderCard(data.a2ui, data.answer);
}

patients.addEventListener('click', (event) => {
  const button = event.target.closest('[data-hadm-id]');
  if (!button) return;

  for (const el of patients.querySelectorAll('[data-hadm-id]')) {
    el.classList.toggle('active', el === button);
  }

  ask(
    { hadm_id: Number(button.dataset.hadmId) },
    'Assessing… a cold start can take up to a minute.'
  );
});
