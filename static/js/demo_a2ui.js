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
const toggleMsg = document.getElementById('a2ui-toggle-msg');

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

/** Draw the canvas for an episode as an A2UI surface (episode may be null).

    Pass `envelope` to render a specific turn's composed messages instead of
    the episode's latest — the footnote-click path re-shows the cited turn
    (and wins over the trace toggle, matching the custom demo). */
function renderA2uiCanvas(episode, api, envelope) {
  const { canvasMode, clearCanvas, showEmpty } = api;
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
    showEmpty(EMPTY_STATE);
  };

  // Nothing was passed and there is nothing local to draw. This is the state
  // the page opens in, and it needs no renderer at all — keeping this branch
  // synchronous is what keeps first paint off the renderer bundle.
  if (!envelope && !isTrace && !(episode && episode.a2ui)) {
    showNothing();
    return;
  }

  // The trace envelope embeds the catalog id and the mount needs the processor,
  // so the rest of the draw waits for the renderer. The canvas is already
  // cleared above, so a slow first load shows an empty canvas rather than the
  // previous patient's.
  scene().then((renderer) => {
    const target = envelope
      || (isTrace ? traceEnvelope(episode, renderer.catalog) : (episode && episode.a2ui));

    if (!target || !target.messages) {
      showNothing();
      return;
    }

    canvasMode.textContent = isTrace
      ? 'trace'
      : `agent-composed · ${episode.lastMode || 'fixture'}`;
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

toggleMsg.addEventListener('click', () => {
  msgPre.hidden = !msgPre.hidden;
  toggleMsg.textContent = msgPre.hidden ? 'Show composed messages' : 'Hide composed messages';
});
