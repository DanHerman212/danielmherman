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

import { createDemoFlow, extractSection } from './demo_flow.js?v=11';
import { MessageProcessor } from '/static/vendor/a2ui/a2ui_web_core_0.10.5_v0_9_external_lit_zod.js';
import { basicCatalog, Context } from '/static/vendor/a2ui/a2ui_lit_0.10.2_v0_9_external_lit_zod.js';
import { ContextProvider } from '/static/vendor/a2ui/lit_context_1.1.6_external_lit.js';
import { renderMarkdown } from '/static/vendor/a2ui/a2ui_markdown-it_0.1.0.js';
import { buildRiskCatalog } from '/static/vendor/a2ui/a2ui_risk_components.js?v=4';

const root = document.getElementById('a2ui-root');

// One combined catalog (basic + custom components) for every surface we mount.
const CATALOG = buildRiskCatalog(basicCatalog);
const host = document.getElementById('a2ui-host');
const msgPre = document.getElementById('a2ui-messages');
const toggleMsg = document.getElementById('a2ui-toggle-msg');

// The markdown provider must sit above the surface (basic Text renders MD).
new ContextProvider(host, { context: Context.markdown, initialValue: renderMarkdown });

const EMPTY_MARKUP =
  '<i class="fa-solid fa-heart-pulse"></i>' +
  '<p>Select a patient to see their assessment.</p>' +
  '<p class="canvas-empty-sub">The A2UI renderer draws the canvas from ' +
  'agent-composed messages.</p>';

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
    showEmpty(EMPTY_MARKUP);
    return;
  }

  canvasMode.textContent = isTrace
    ? 'trace'
    : `agent-composed · ${episode.lastMode || 'fixture'}`;
  msgPre.textContent = JSON.stringify(target, null, 2);
  renderEnvelope(target);
}

/** Point the turn's envelope SourceCard at the cited passage (n is 1-based). */
function envelopeForCite(turn, n) {
  if (!turn.a2ui || !turn.passages || !turn.passages[n - 1]) return turn.a2ui;
  const passage = turn.passages[n - 1];
  const env = JSON.parse(JSON.stringify(turn.a2ui));
  const update = env.messages.find((m) => m.updateComponents);
  const source = update && update.updateComponents.components
    .find((c) => c.component === 'SourceCard');
  if (!source) return env;
  source.cite = n;
  source.section = passage.section;
  source.text = extractSection(passage.text, passage.section) || passage.text;
  source.query = turn.query || 'discharge note';
  return env;
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
