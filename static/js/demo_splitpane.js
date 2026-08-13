/**
 * Demo console — split-pane skeleton (Screen 1/2/3 of docs/wireframes.md).
 *
 * This page owns only the canvas widgets (RISK / DRIVERS / SOURCE + the trace
 * block) and wires the shared flow from demo_flow.js (patient rail, thread,
 * chips, ask, episodic memory) to render them into the canvas.
 *
 * R8: every surface has a text fallback — the demo never renders nothing.
 */

import {
  createDemoFlow,
  esc, pct, bandOf, bandColor, extractSection,
} from './demo_flow.js?v=6';

/* ---------- canvas widget builders (Screen 2, right) ---------- */

function riskBlock(payload) {
  const prob = Number(payload.probability);
  const thr = Number(payload.threshold);
  const band = bandOf(prob, thr);
  const color = bandColor(band);

  const card = document.createElement('div');
  card.className = 'widget';
  card.innerHTML = `
    <div class="widget-title">30-day unplanned readmission risk</div>
    <div class="risk-row">
      <div class="risk-number" style="color:${color}">${pct(prob)}</div>
      <div class="risk-decision risk-${band}">
        ${prob >= thr ? 'above' : 'below'} threshold · ${band}
      </div>
    </div>
    <div class="risk-bar">
      <div class="risk-bar-fill risk-${band}" style="width:${Math.min(100, prob * 100).toFixed(1)}%"></div>
      <div class="risk-threshold" style="left:${Math.min(100, thr * 100).toFixed(1)}%"
           title="operating threshold ${thr}"></div>
    </div>
    <div class="risk-bar-scale"><span>0%</span><span>threshold ${thr}</span><span>40%</span></div>
  `;
  return card;
}

function driversBlock(payload) {
  const card = document.createElement('div');
  card.className = 'widget';
  card.innerHTML = `<div class="widget-title">What drives this estimate?</div>`;

  const factors = payload.top_factors || [];
  if (factors.length === 0) {
    card.innerHTML += '<p class="widget-fallback">No feature attributions returned.</p>';
    return card;
  }

  const max = Math.max(...factors.map((f) => Math.abs(f.contribution)));
  for (const f of factors) {
    const row = document.createElement('div');
    row.className = 'driver-row';

    const name = document.createElement('div');
    name.className = 'driver-name';
    name.textContent = f.feature;
    row.appendChild(name);

    const track = document.createElement('div');
    track.className = 'driver-track';
    const width = ((Math.abs(f.contribution) / max) * 100).toFixed(1);
    const bar = document.createElement('div');
    bar.className = `driver-bar ${f.direction === 'increases' ? 'driver-up' : 'driver-down'}`;
    bar.style.width = `${width}%`;
    track.appendChild(bar);
    row.appendChild(track);

    const val = document.createElement('div');
    val.className = 'driver-val';
    val.textContent = `${f.contribution >= 0 ? '+' : ''}${f.contribution}`;
    row.appendChild(val);

    card.appendChild(row);
  }
  return card;
}

function sourceBlock(episode, sourceIndex) {
  const card = document.createElement('div');
  card.className = 'widget widget-source';
  const src = episode.sources[sourceIndex];
  if (!src) return card;

  card.innerHTML = `<div class="widget-title">Source · ${esc(src.query || 'discharge note')}</div>`;
  if (src.passages.length === 0) {
    card.innerHTML +=
      '<p class="widget-fallback">No supporting note passage was found for this question. ' +
      'An empty result is a real answer — the agent does not fabricate passages.</p>';
    return card;
  }
  // Show only the passages the answer actually cites, so the footnote count
  // in the prose always matches the number of source cards.
  const cited = src.cited || new Set(src.passages.map((_, i) => i + 1));
  let shown = 0;
  for (let i = 0; i < src.passages.length; i++) {
    if (!cited.has(i + 1)) continue;
    card.appendChild(passageRow(src.passages[i], i));
    shown++;
  }
  if (shown === 0) card.appendChild(passageRow(src.passages[0], 0));
  return card;
}

function passageRow(passage, index) {
  const row = document.createElement('div');
  row.className = 'source-passage';
  row.dataset.passage = index + 1;

  const head = document.createElement('div');
  head.className = 'source-head';
  const badge = document.createElement('span');
  badge.className = 'source-cite';
  badge.textContent = `[${index + 1}]`;
  const section = document.createElement('span');
  section.className = 'source-section';
  section.textContent = passage.section.replace(/_/g, ' ');
  head.appendChild(badge);
  head.appendChild(section);
  row.appendChild(head);

  // Show the specific section's text (extracted from the note), not the whole
  // note — so each card's body matches its header.
  const sectionText = extractSection(passage.text, passage.section) || passage.text;
  const preview = sectionText.trim();

  const text = document.createElement('div');
  text.className = 'source-text';
  text.textContent = preview.slice(0, 260).trim();
  row.appendChild(text);

  const expand = document.createElement('button');
  expand.type = 'button';
  expand.className = 'source-expand';
  expand.textContent = 'Show full section';
  expand.addEventListener('click', () => {
    if (text.classList.contains('expanded')) {
      text.textContent = preview.slice(0, 260).trim();
      expand.textContent = 'Show full section';
      text.classList.remove('expanded');
    } else {
      text.textContent = preview;
      expand.textContent = 'Collapse';
      text.classList.add('expanded');
    }
  });
  row.appendChild(expand);
  return row;
}

/** Render the SOURCE widget for one turn's passages (citation click). */
function renderSourceForTurn(episode, turnIndex, api) {
  const turn = episode.turns[turnIndex];
  if (!turn || !turn.passages) return;
  // Materialize a source entry for that turn and surface it.
  const sourceIndex = episode.sources.findIndex((s) => s.query === turn.query);
  if (sourceIndex === -1) {
    episode.sources.push({ query: turn.query, passages: turn.passages, cited: turn.cited });
  }
  const idx = sourceIndex === -1 ? episode.sources.length - 1 : sourceIndex;
  api.canvasMode.textContent = 'source: cited';
  api.clearCanvas();
  api.canvas.appendChild(sourceBlock(episode, idx));
}

function highlightPassage(n, api) {
  const rows = api.canvas.querySelectorAll('.source-passage');
  const target = api.canvas.querySelector(`.source-passage[data-passage="${n}"]`);
  if (!target) return;
  rows.forEach((r) => r.classList.remove('is-cited'));
  target.classList.add('is-cited');
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function traceBlock(episode) {
  const card = document.createElement('div');
  card.className = 'widget widget-trace';
  card.innerHTML = `
    <div class="widget-title">Trace — tool calls &amp; provenance</div>
    <p class="widget-fallback">${esc(episode.lastFixtureNote || '')}</p>
  `;

  const calls = [];
  for (const turn of episode.turns) {
    for (const tc of turn.toolCalls || []) calls.push(tc);
  }
  if (calls.length === 0) {
    card.innerHTML += '<p class="widget-fallback">No tool calls yet.</p>';
  } else {
    for (const tc of calls) {
      const block = document.createElement('div');
      block.className = 'trace-call';
      const head = document.createElement('div');
      head.className = 'trace-head';
      head.textContent = `${tc.name}(${JSON.stringify(tc.args || {})})`;
      block.appendChild(head);
      const body = document.createElement('pre');
      body.className = 'trace-body';
      body.textContent = JSON.stringify(tc.response || {}, null, 2).slice(0, 1200);
      block.appendChild(body);
      card.appendChild(block);
    }
  }

  const note = document.createElement('p');
  note.className = 'widget-fallback trace-r1';
  note.textContent =
    'R1: cross-patient isolation is enforced server-side — rag_search restricts ' +
    'to the selected patient\u2019s hadm_id before retrieval, never as a post-filter.';
  card.appendChild(note);
  return card;
}

/* ---------- canvas renderer: the shared flow calls this ---------- */

function renderCanvasWidgets(episode, api) {
  const { canvas, canvasMode, traceOn, clearCanvas, showEmpty } = api;
  clearCanvas();

  if (!episode) {
    canvasMode.textContent = '';
    showEmpty(
      '<i class="fa-solid fa-heart-pulse"></i>' +
      '<p>Select a patient to see their assessment.</p>' +
      '<p class="canvas-empty-sub">The risk score, its drivers, and the cited ' +
      'note passages render here as structured widgets — never buried in the chat.</p>');
    return;
  }

  if (traceOn) {
    canvasMode.textContent = 'trace';
    canvas.appendChild(traceBlock(episode));
    return;
  }

  canvasMode.textContent = episode.lastMode ? `source: ${episode.lastMode}` : '';

  const hasRisk = episode.assessments.length > 0;
  const hasSources = episode.sources.length > 0;
  if (!hasRisk && !hasSources) {
    showEmpty(
      '<i class="fa-solid fa-heart-pulse"></i>' +
      '<p>Select a patient to see their assessment.</p>' +
      '<p class="canvas-empty-sub">The risk score, its drivers, and the cited ' +
      'note passages render here as structured widgets — never buried in the chat.</p>');
    return;
  }
  if (hasRisk) {
    const latest = episode.assessments[episode.assessments.length - 1];
    canvas.appendChild(riskBlock(latest));
    canvas.appendChild(driversBlock(latest));
  }
  if (hasSources) {
    canvas.appendChild(sourceBlock(episode, episode.sources.length - 1));
  }
}

/* ---------- wire the shared flow ---------- */

const root = document.getElementById('demo-root');

createDemoFlow({
  root,
  askUrl: root.dataset.askUrl,
  renderCanvas: renderCanvasWidgets,
  onCite(episode, turnIndex, n, api) {
    renderSourceForTurn(episode, turnIndex, api);
    highlightPassage(n, api);
  },
});
