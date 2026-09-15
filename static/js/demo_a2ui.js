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
 */

import { createDemoFlow } from './demo_flow.js?v=19';
import { MessageProcessor } from '/static/vendor/a2ui/a2ui_web_core_0.10.5_v0_9_external_lit_zod.js';
import { basicCatalog, Context } from '/static/vendor/a2ui/a2ui_lit_0.10.2_v0_9_external_lit_zod.js';
import { ContextProvider } from '/static/vendor/a2ui/lit_context_1.1.6_external_lit.js';
import { renderMarkdown } from '/static/vendor/a2ui/a2ui_markdown-it_0.1.0.js';
import { buildRiskCatalog } from '/static/vendor/a2ui/a2ui_risk_components.js?v=5';

const root = document.getElementById('a2ui-root');

// One combined catalog (basic + custom components) for every surface we mount.
const CATALOG = buildRiskCatalog(basicCatalog);
const host = document.getElementById('a2ui-host');
const msgPre = document.getElementById('a2ui-messages');
const toggleMsg = document.getElementById('a2ui-toggle-msg');

// The markdown provider must sit above the surface (basic Text renders MD).
new ContextProvider(host, { context: Context.markdown, initialValue: renderMarkdown });

const EMPTY_STATE = {
  title: 'Select a patient to see their assessment.',
  sub: 'The A2UI renderer draws the canvas from agent-composed messages.',
};

/** Mount an envelope's messages into a fresh A2UI surface. */
function renderEnvelope(target) {
  // A fresh processor + surface per run (avoids duplicate-surface issues).
  const processor = new MessageProcessor([CATALOG]);
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
function traceEnvelope(episode) {
  const toolCalls = [];
  for (const turn of (episode && episode.turns) || []) {
    for (const tc of turn.toolCalls || []) toolCalls.push(tc);
  }
  return {
    surface_id: 'risk-canvas',
    audience: ['user'],
    messages: [
      { version: 'v0.9', createSurface: { surfaceId: 'risk-canvas', catalogId: CATALOG.id } },
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
  const target = envelope
    || (isTrace ? traceEnvelope(episode) : (episode && episode.a2ui));

  if (!target || !target.messages) {
    canvasMode.textContent = '';
    // S7-16: clear the composed-messages pane too — it otherwise keeps the
    // previous patient's envelope JSON (cross-patient bleed in the trace view).
    msgPre.textContent = '';
    showEmpty(EMPTY_STATE);
    return;
  }

  canvasMode.textContent = isTrace
    ? 'trace'
    : `agent-composed · ${episode.lastMode || 'fixture'}`;
  msgPre.textContent = JSON.stringify(target, null, 2);
  renderEnvelope(target);
}

/** Point the turn's envelope SourceCard at the cited passage (n is 1-based).

    The agent resolves every citation before the response leaves it: each
    entry in `turn.sources` is the finished {cite, section, text, query} for
    one ^[n]. The browser looks the clicked number up and displays it — it
    holds no section vocabulary and applies no heuristics. */
function envelopeForCite(turn, n) {
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
  return sourceOnlyEnvelope(source);
}

/** A minimal single-SourceCard surface, used when a turn's composed envelope
    has no SourceCard to repoint. */
function sourceOnlyEnvelope(source) {
  return {
    surface_id: 'risk-canvas',
    audience: ['user'],
    messages: [
      { version: 'v0.9', createSurface: { surfaceId: 'risk-canvas', catalogId: CATALOG.id } },
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
    renderA2uiCanvas(episode, api, turn && envelopeForCite(turn, n));
  },
});

toggleMsg.addEventListener('click', () => {
  msgPre.hidden = !msgPre.hidden;
  toggleMsg.textContent = msgPre.hidden ? 'Show composed messages' : 'Hide composed messages';
});
