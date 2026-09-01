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
} from './demo_flow.js?v=17';  // S7-13: keep in sync with demo_a2ui.js

/* ---------- canvas widget builders (Screen 2, right) ---------- */

function riskBlock(payload) {
  const prob = Number(payload.probability);
  const thr = Number(payload.threshold);
  // S7-04: fall back to a clear empty state on a malformed payload instead of
  // rendering NaN%/Infinity% and a wrong band.
  if (!Number.isFinite(prob) || !Number.isFinite(thr)) {
    const card = document.createElement('div');
    card.className = 'widget';
    card.innerHTML =
      '<p class="widget-fallback">Risk score unavailable for this assessment.</p>';
    return card;
  }
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

function sourceCard(src) {
  const card = document.createElement('div');
  card.className = 'widget widget-source';
  if (!src) return card;

  card.innerHTML = `<div class="widget-title">Source · ${esc(src.query || 'discharge note')}</div>`;
  // S7-09: resolve citations through intentSections (or the footnote numbers)
  // so the card shows the passage the citations actually support.
  const passages = resolvePassages(src);
  if (passages.length === 0) {
    card.innerHTML +=
      '<p class="widget-fallback">No supporting note passage was found for this question. ' +
      'An empty result is a real answer — the agent does not fabricate passages.</p>';
    return card;
  }
  passages.forEach((p, i) => card.appendChild(passageRow(p, i)));
  return card;
}

function sourceBlock(episode, sourceIndex) {
  return sourceCard(episode.sources[sourceIndex]);
}

/** S7-09: which retrieved passages do this turn's citations actually support?

    The model mis-numbers citations (a meds answer cites ^[1] while its
    supporting passage sits elsewhere). When the turn targeted specific note
    section(s) (intentSections), resolve to the first passage whose section
    matches an intent section — or that CONTAINS it (the index stores
    whole-note chunks, so extractSection finds the target inside) — mirroring
    the A2UI demo's envelopeForCite. Otherwise the footnote numbers map
    straight onto the passages array. */
function resolvePassages(src) {
  const passages = (src && src.passages) || [];
  if (!passages.length) return [];
  const intents = (src && src.intentSections) || [];
  const cited = src.cited || new Set(passages.map((_, i) => i + 1));
  const byNumber = () => passages.filter((_, i) => cited.has(i + 1));
  if (!intents.length) return byNumber();
  const resolved = [];
  for (const sec of intents) {
    const direct = passages.find((p) => p.section === sec);
    if (direct) { if (!resolved.includes(direct)) resolved.push(direct); continue; }
    for (const p of passages) {
      if (extractSection(p.text, sec)) { if (!resolved.includes(p)) resolved.push(p); break; }
    }
  }
  return resolved.length ? resolved : byNumber();
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
  section.textContent = String(passage.section || '').replace(/_/g, ' ');
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
  // S7-15: build the card from THIS turn's own passages — never a query-text
  // lookup that a repeated or null-question turn would resolve to an earlier
  // turn's passages.
  api.canvasMode.textContent = 'source: cited';
  api.clearCanvas();
  api.canvas.appendChild(sourceCard({
    query: turn.query,
    passages: turn.passages,
    cited: turn.cited,
    intentSections: turn.intentSections,
  }));
}

function highlightPassage(n, api) {
  const rows = api.canvas.querySelectorAll('.source-passage');
  let target = api.canvas.querySelector(`.source-passage[data-passage="${n}"]`);
  // S7-09: after intent-section resolution the rows are renumbered 1..k, so
  // footnote n may not index a row — fall back to the first resolved row.
  if (!target && rows.length) target = rows[0];
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
    showEmpty({
      title: 'Select a patient to see their assessment.',
      sub: 'The risk score, its drivers, and the cited note passages render ' +
           'here as structured widgets — never buried in the chat.',
    });
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
    showEmpty({
      title: 'Select a patient to see their assessment.',
      sub: 'The risk score, its drivers, and the cited note passages render ' +
           'here as structured widgets — never buried in the chat.',
    });
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
