/**
 * A2UI demo console — the same enterprise shell, patient rail, thread and
 * starter chips as the custom demo, but the context canvas is drawn by the
 * vendored A2UI renderer from agent-composed messages instead of hand-built
 * HTML.
 *
 * The shared flow (demo_flow.js) owns the patient rail, thread, chips, ask
 * and episodic memory; this file supplies the canvas renderer: it feeds the
 * A2UI envelope returned by /demo/a2ui/ask/ into a MessageProcessor and mounts
 * the resulting surface. The "Show composed messages" toggle reveals the raw
 * A2UI messages — the design the agent produced, which is the point of the
 * comparison.
 *
 * The renderer is loaded ON DEMAND, not imported at the top: see `scene()`.
 * Imported at the top it sits in front of the patient rail's paging code, which
 * is what made the console page wait on 385 module requests before it could
 * paginate.
 */

import { createDemoFlow } from './demo_flow.js';

const root = document.getElementById('a2ui-root');
const host = document.getElementById('a2ui-host');
const msgPre = document.getElementById('a2ui-messages');
const switchEl = document.getElementById('canvas-switch');

// The renderer, resolved once. Two envelopes embed the catalog id, and both are
// built on a render path that has already awaited `scene()`.
let scenePromise = null;

/** The renderer, fetched on first use and remembered.

    Nothing on first paint needs it — the empty state is plain DOM — so this is
    called only on a path that is about to draw, or from the intent listener
    below. The bundle it loads is one file (see vite.config.js). */
function scene() {
  if (!scenePromise) {
    const url = root.dataset.rendererUrl;
    if (!url) {
      // A canvas that never draws and no error anywhere is the failure mode
      // this file's comments keep warning about; say it out loud instead.
      console.error('a2ui: #a2ui-root has no data-renderer-url; the canvas cannot mount');
    }
    scenePromise = (url ? import(url) : Promise.reject(new Error('no renderer url')))
      .then((m) => {
        const catalog = m.buildRiskCatalog(m.basicCatalog);
        // The markdown provider must sit above the surface (basic Text renders MD).
        new m.ContextProvider(host, { context: m.Context.markdown, initialValue: m.renderMarkdown });
        return { MessageProcessor: m.MessageProcessor, catalog };
      });
  }
  return scenePromise;
}

// Start the fetch on first intent rather than on the first answer, so it has
// usually finished by the time a render needs it — and never starts at all for
// a visitor who only reads the patient list.
root.addEventListener('pointerdown', scene, { once: true, capture: true });

const EMPTY_STATE = {
  title: 'Select a patient to see their assessment.',
  sub: 'The A2UI renderer draws the canvas from agent-composed messages.',
};

/** Mount an envelope's messages into a fresh A2UI surface. */
function renderEnvelope(target, renderer) {
  // A fresh processor + surface per run (avoids duplicate-surface issues).
  const processor = new renderer.MessageProcessor([renderer.catalog]);
  processor.onSurfaceCreated((surface) => {
    const el = document.createElement('a2ui-surface');
    el.surface = surface;
    host.appendChild(el);
  });
  processor.processMessages(target.messages);
}

/** Compose the Screen-3 trace as A2UI messages (client-side, from thread state).

    Lists every tool call (predict_readmission / rag_search) with its args and
    returned payload, plus the R1 cross-patient-isolation note — the
    technical-evaluator surface the wireframes place behind the toggle. */
function traceEnvelope(episode, catalog) {
  const toolCalls = [];
  for (const turn of (episode && episode.turns) || []) {
    for (const tc of turn.toolCalls || []) toolCalls.push(tc);
  }
  return {
    surface_id: 'risk-canvas',
    audience: ['user'],
    messages: [
      { version: 'v0.9', createSurface: { surfaceId: 'risk-canvas', catalogId: catalog.id } },
      { version: 'v0.9', updateComponents: { surfaceId: 'risk-canvas', components: [
        { id: 'root', component: 'Card', child: 'body' },
        { id: 'body', component: 'Column', children: ['trace'] },
        { id: 'trace', component: 'TraceCard',
          toolCalls,
          fixtureNote: (episode && episode.lastFixtureNote) || '' },
      ] } },
    ],
    fallback_text: toolCalls.length
      ? `Trace — ${toolCalls.length} tool call(s)`
      : 'No tool calls yet.',
  };
}

/* ---------------- canvas view switcher ---------------- */

/* The canvas holds one composed surface per clinical view and switches between
   them, instead of the newest answer silently replacing the last. Without this,
   asking a literature question moved the risk assessment off screen and the only
   way back was a footnote click in the older turn.

   `picked` is null until the clinician chooses, and null means "follow the newest
   answer". An explicit choice sticks until the next answer arrives, which is what
   makes the two views comparable. */
let picked = null;
let followed = null;   // the newest envelope the switcher last auto-followed
let lastPaint = null;  // { episode, api }, so a switch can redraw what was shown

/** The clinical views an envelope draws, from the components it composes.
    The surface decides what is on screen, so the surface is what we read. */
function viewsIn(envelope) {
  const names = new Set();
  for (const message of (envelope && envelope.messages) || []) {
    const components = (message.updateComponents && message.updateComponents.components) || [];
    for (const component of components) names.add(component.component);
  }
  return { risk: names.has('RiskBar'), literature: names.has('LiteratureList') };
}

/** The newest envelope per view across the episode's turns, plus the view the
    newest answer produced. */
function episodeViews(episode) {
  const latest = { risk: null, literature: null };
  let newest = null;
  let newestEnvelope = null;
  for (const turn of (episode && episode.turns) || []) {
    if (!turn.a2ui) continue;
    newestEnvelope = turn.a2ui;
    const inEnvelope = viewsIn(turn.a2ui);
    if (inEnvelope.risk) { latest.risk = turn.a2ui; newest = 'risk'; }
    if (inEnvelope.literature) { latest.literature = turn.a2ui; newest = 'literature'; }
  }
  return { latest, newest, newestEnvelope };
}

/** Point the control at what this episode can actually draw. A view with no
    canvas is disabled rather than hidden, so the control never moves. */
function syncSwitch(available, current) {
  if (!switchEl) return;
  switchEl.hidden = !available.risk && !available.literature;
  for (const btn of switchEl.querySelectorAll('.canvas-switch-btn')) {
    const view = btn.dataset.view;
    btn.disabled = !available[view];
    btn.setAttribute('aria-pressed', String(view === current));
  }
}

if (switchEl) {
  switchEl.addEventListener('click', (event) => {
    const btn = event.target.closest('.canvas-switch-btn');
    if (!btn || btn.disabled || !lastPaint) return;
    picked = btn.dataset.view;
    renderA2uiCanvas(lastPaint.episode, lastPaint.api);
  });
}

/** Draw the canvas for an episode as an A2UI surface (episode may be null).

    Pass `envelope` to render a specific turn's composed messages instead of
    the episode's latest — the footnote-click path re-shows the cited turn, and
    that outranks both the switcher and the trace toggle, matching the custom
    demo. Which view is drawn otherwise is the switcher's business. */
function renderA2uiCanvas(episode, api, envelope) {
  const { canvasMode, clearCanvas, showEmpty } = api;
  lastPaint = { episode, api };
  clearCanvas();

  // Screen 3: the trace toggle swaps the composed canvas for the raw tool-call
  // trace (technical-evaluator surface). R8: the TraceCard always draws an
  // honest fallback, so trace mode never renders nothing.
  const isTrace = !envelope && api.traceOn;

  const showNothing = () => {
    canvasMode.textContent = '';
    // S7-16: clear the composed-messages pane too — it otherwise keeps the
    // previous patient's envelope JSON (cross-patient bleed in the trace view).
    msgPre.textContent = '';
    if (switchEl) switchEl.hidden = true;
    showEmpty(EMPTY_STATE);
  };

  const views = episodeViews(episode);

  // A new answer takes the canvas back: the clinician asked a question, so the
  // answer to it is what they should be looking at. A choice made between
  // answers survives until the next one.
  if (!envelope && views.newestEnvelope !== followed) {
    followed = views.newestEnvelope;
    picked = null;
  }

  const view = envelope
    ? null
    : (picked && views.latest[picked] ? picked : views.newest);
  syncSwitch(views.latest, view);

  // A footnote click names its own turn; otherwise the chosen view, falling back
  // to the episode's latest envelope so a surface with neither risk nor
  // literature components still draws.
  const chosen = envelope
    || (view && views.latest[view])
    || (episode && episode.a2ui)
    || null;

  // Nothing to draw. This is the state the page opens in, and it needs no
  // renderer at all — keeping this branch synchronous is what keeps first paint
  // off the renderer bundle.
  if (!chosen && !isTrace) {
    showNothing();
    return;
  }

  // The trace envelope embeds the catalog id and the mount needs the processor,
  // so the rest of the draw waits for the renderer. The canvas is already
  // cleared above, so a slow first load shows an empty canvas rather than the
  // previous patient's.
  scene().then((renderer) => {
    const target = chosen || traceEnvelope(episode, renderer.catalog);

    if (!target || !target.messages) {
      showNothing();
      return;
    }

    canvasMode.textContent = isTrace
      ? 'trace'
      : `agent-composed · ${(episode && episode.lastMode) || 'fixture'}`;
    msgPre.textContent = JSON.stringify(target, null, 2);
    renderEnvelope(target, renderer);
  });
}

/** Point the turn's envelope SourceCard at the cited passage (n is 1-based).

    The agent resolves every citation before the response leaves it: each
    entry in `turn.sources` is the finished {cite, section, text, query} for
    one ^[n]. The browser looks the clicked number up and displays it — it
    holds no section vocabulary and applies no heuristics. */
function envelopeForCite(turn, n, catalog) {
  if (!turn.a2ui) return null;
  const source = (turn.sources || []).find((s) => s.cite === n);
  if (!source) return turn.a2ui;

  const env = JSON.parse(JSON.stringify(turn.a2ui));
  const update = env.messages.find((m) => m.updateComponents);
  const card = update && update.updateComponents.components
    .find((c) => c.component === 'SourceCard');
  if (card) {
    Object.assign(card, source);
    return env;
  }
  // The envelope has no SourceCard to repoint — synthesize a minimal
  // source-only surface so the cite click still shows the passage.
  return sourceOnlyEnvelope(source, catalog);
}

/** A minimal single-SourceCard surface, used when a turn's composed envelope
    has no SourceCard to repoint. */
function sourceOnlyEnvelope(source, catalog) {
  return {
    surface_id: 'risk-canvas',
    audience: ['user'],
    messages: [
      { version: 'v0.9', createSurface: { surfaceId: 'risk-canvas', catalogId: catalog.id } },
      { version: 'v0.9', updateComponents: { surfaceId: 'risk-canvas', components: [
        { id: 'root', component: 'Card', child: 'body' },
        { id: 'body', component: 'Column', children: ['source'] },
        { id: 'source', component: 'SourceCard', ...source },
      ] } },
    ],
  };
}

createDemoFlow({
  root,
  askUrl: root.dataset.askUrl,
  renderCanvas: renderA2uiCanvas,
  // A footnote in the thread links to the canvas: re-draw that turn's composed
  // messages with the SourceCard pointed at the cited passage.
  onCite(episode, turnIndex, n, api) {
    const turn = episode.turns[turnIndex];
    // The source-only fallback embeds the catalog id, so the envelope cannot be
    // built until the renderer is in — build it inside the load, or this click
    // races the fetch and reads a null catalog.
    scene().then((renderer) => renderA2uiCanvas(
      episode, api, turn && envelopeForCite(turn, n, renderer.catalog),
    ));
  },
});
