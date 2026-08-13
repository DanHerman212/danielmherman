/**
 * Shared demo flow for the Enterprise Clinical Copilot console.
 *
 * Owns everything identical across the custom demo (/demo/) and the A2UI demo
 * (/demo/a2ui/):
 *   - patient rail: selection, search, pagination (Screen 1)
 *   - the thread: starter chips + user/agent turns (Screen 2, left)
 *   - the ask flow (chips + free text) with episodic per-patient memory
 *   - sidebar view switching (Dashboard placeholder / Readmission Risk)
 *   - the trace toggle state (Screen 3; the trigger is hidden until that
 *     journey is wired up)
 *
 * The one thing that differs between the two demos is how the context canvas
 * is drawn, so it is injected: createDemoFlow({ renderCanvas, onCite }).
 *
 * renderCanvas(episode, api) draws the canvas for the current episode. episode
 * is null when no patient is selected (or after Back). api exposes:
 *   { canvas, canvasMode, traceOn, clearCanvas(), showEmpty(markup) }.
 * onCite(episode, turnIndex, n, api) handles citation clicks in the agent
 * prose (defaults to re-rendering the canvas).
 *
 * The pure helpers (esc, pct, bandOf, bandColor, extractSection, citedNumbers)
 * are also exported so the per-demo canvas renderers can reuse them.
 *
 * R8: every surface has a text fallback — the demo never renders nothing.
 */

const CHIPS = [
  { key: 'risk', label: 'Run 30-day readmission risk' },
  { key: 'summarize', label: 'Summarize recent discharge notes' },
  { key: 'meds', label: 'What medications were they discharged on?' },
];

const PAGE_SIZE = 10;

const SECTION_HEADERS = [
  'History of Present Illness', 'Past Medical History', 'Family History',
  'Social History', 'Physical Exam', 'Brief Hospital Course',
  'Discharge Condition', 'Discharge Diagnosis', 'Discharge Medications',
  'Medications on Admission', 'Discharge Disposition', 'Discharge Instructions',
  'Chief Complaint', 'Major Surgical or Invasive Procedure',
];

/* ------------------------------------------------------------------ */
/* shared helpers (also used by the per-demo canvas renderers)         */
/* ------------------------------------------------------------------ */

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function pct(probability) {
  return `${(Number(probability) * 100).toFixed(1)}%`;
}

export function bandOf(probability, threshold) {
  const p = Number(probability);
  const t = Number(threshold);
  if (p < t) return 'low';
  if (p < t + 0.08) return 'borderline';
  return 'high';
}

export function bandColor(band) {
  return { low: 'var(--risk-low)', borderline: 'var(--risk-borderline)', high: 'var(--risk-high)' }[band] || 'var(--muted)';
}

export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Extract a named section's text from a full note, or null if not found. */
export function extractSection(noteText, section) {
  const title = String(section || '').replace(/_/g, ' ');
  if (!title) return null;
  const header = new RegExp(`\\b${escapeRegex(title)}\\b\\s*:`, 'i');
  const m = header.exec(noteText);
  if (!m) return null;
  const start = m.index;
  let end = noteText.length;
  for (const h of SECTION_HEADERS) {
    const re = new RegExp(`\\n\\s*${escapeRegex(h)}\\s*:`, 'i');
    const hm = re.exec(noteText.slice(start + m[0].length));
    if (hm) {
      const candidate = start + m[0].length + hm.index;
      if (candidate < end) end = candidate;
    }
  }
  return noteText.slice(start, end).trim();
}

/** Parse citation markers in agent prose: ^[1], ^[1, 2], or ^[1-3].
    Returns [{ full, numbers }] where full is the exact matched marker text
    and numbers the expanded citation ids. */
function citationMarkers(text) {
  const out = [];
  const re = /\^\[(\d+(?:\s*,\s*\d+)*|\d+\s*-\s*\d+)\]/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const inner = m[1];
    const numbers = [];
    if (inner.includes('-')) {
      const [a, b] = inner.split('-').map((s) => Number(s.trim()));
      for (let i = a; i <= b; i++) numbers.push(i);
    } else {
      for (const part of inner.split(',')) numbers.push(Number(part.trim()));
    }
    out.push({ full: m[0], numbers });
  }
  return out;
}

/** The set of citation numbers used in agent prose (from ^[n] markers). */
export function citedNumbers(text) {
  const set = new Set();
  for (const mk of citationMarkers(text)) {
    for (const n of mk.numbers) set.add(n);
  }
  return set;
}

/* ------------------------------------------------------------------ */
/* flow                                                                */
/* ------------------------------------------------------------------ */

export function createDemoFlow({ root, askUrl, renderCanvas, onCite }) {
  const els = {
    list: document.getElementById('patient-list'),
    search: document.getElementById('patient-search'),
    threadName: document.getElementById('thread-patient-name'),
    threadMeta: document.getElementById('thread-patient-meta'),
    thread: document.getElementById('thread'),
    input: document.getElementById('question-input'),
    askBtn: document.getElementById('ask-btn'),
    canvas: document.getElementById('canvas') || document.getElementById('a2ui-host'),
    canvasMode: document.getElementById('canvas-mode'),
    backBtn: document.getElementById('back-btn'),
    pagePrev: document.getElementById('page-prev'),
    pageNext: document.getElementById('page-next'),
    pageInfo: document.getElementById('page-info'),
    traceToggle: document.getElementById('trace-toggle'), // null until the trace journey
    remaining: document.getElementById('remaining'),
  };

  const state = {
    askUrl,
    current: null,               // { hadmId, name, meta }
    episodes: new Map(),         // hadmId -> episode
    traceOn: false,
    page: 1,
  };

  function csrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return match ? match[1] : '';
  }

  function episodeFor(hadmId) {
    if (!state.episodes.has(hadmId)) {
      state.episodes.set(hadmId, {
        turns: [],
        assessments: [],
        sources: [],
        lastQuery: null,
        lastMode: null,
        lastFixtureNote: '',
        a2ui: null,
      });
    }
    return state.episodes.get(hadmId);
  }

  /** The canvas API handed to the injected renderCanvas. */
  const api = {
    get canvas() { return els.canvas; },
    get canvasMode() { return els.canvasMode; },
    get traceOn() { return state.traceOn; },
    clearCanvas() { els.canvas.replaceChildren(); },
    showEmpty(markup) {
      els.canvas.replaceChildren();
      const div = document.createElement('div');
      div.className = 'canvas-empty';
      div.innerHTML = markup;
      els.canvas.appendChild(div);
    },
    episodeFor,
    state,
  };

  /** Paint the canvas (episode may be null → renderers show the empty state). */
  const paint = (episode) => {
    if (typeof renderCanvas === 'function') renderCanvas(episode, api);
  };

  /* ---------- patient rail (Screen 1) ---------- */

  function selectPatient(hadmId) {
    const row = els.list.querySelector(`[data-hadm-id="${hadmId}"]`);
    if (!row) return;
    for (const el of els.list.querySelectorAll('.patient-row')) {
      el.classList.toggle('active', el === row);
    }

    const name = row.querySelector('.patient-name').textContent;
    const age = row.querySelector('.patient-age').textContent;
    const band = row.dataset.band || 'none';
    const prob = row.dataset.probability;
    state.current = { hadmId, name, meta: `${age} · ${band}${prob ? ` · ${pct(prob)}` : ''}` };

    els.threadName.textContent = name;
    els.threadMeta.textContent = state.current.meta;
    els.backBtn.hidden = false;
    els.input.disabled = false;
    els.askBtn.disabled = false;

    renderThread(episodeFor(hadmId));
    paint(episodeFor(hadmId));
  }

  /** Deselect the current patient and reset to the starting state; history kept. */
  function clearSelection() {
    state.current = null;
    for (const el of allRows()) el.classList.remove('active');
    els.threadName.textContent = 'Select a patient';
    els.threadMeta.textContent = '';
    els.backBtn.hidden = true;
    els.input.disabled = true;
    els.askBtn.disabled = true;
    els.thread.replaceChildren();
    paint(null);
    // Reset the left rail to its starting position too: clear the search and
    // return to page 1 so the user browses all patients from the top again.
    els.search.value = '';
    state.page = 1;
    renderPatientList();
  }

  els.list.addEventListener('click', (event) => {
    const row = event.target.closest('[data-hadm-id]');
    if (row) selectPatient(Number(row.dataset.hadmId));
  });

  function allRows() { return [...els.list.querySelectorAll('.patient-row')]; }

  function filteredRows() {
    const q = els.search.value.trim().toLowerCase();
    return q ? allRows().filter((r) => r.textContent.toLowerCase().includes(q)) : allRows();
  }

  /** Show one page of patients (PAGE_SIZE at a time) and update pagination. */
  function renderPatientList() {
    const rows = filteredRows();
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    const start = (state.page - 1) * PAGE_SIZE;
    // Hide every row first, then reveal only the filtered page — otherwise rows
    // outside the filtered set keep stale visibility from a previous render.
    for (const r of allRows()) r.hidden = true;
    rows.forEach((r, i) => { r.hidden = i < start || i >= start + PAGE_SIZE; });
    const from = total === 0 ? 0 : start + 1;
    const to = Math.min(start + PAGE_SIZE, total);
    els.pageInfo.textContent = total === 0 ? '0 patients' : `${from}–${to} of ${total}`;
    els.pagePrev.disabled = state.page <= 1;
    els.pageNext.disabled = state.page >= pages;
  }

  els.search.addEventListener('input', () => { state.page = 1; renderPatientList(); });
  els.pagePrev.addEventListener('click', () => {
    state.page = Math.max(1, state.page - 1); renderPatientList();
  });
  els.pageNext.addEventListener('click', () => {
    state.page += 1; renderPatientList();
  });
  els.backBtn.addEventListener('click', clearSelection);
  renderPatientList();

  /* ---------- sidebar view switching ---------- */
  function showView(view) {
    document.getElementById('risk-view').hidden = view !== 'risk';
    document.getElementById('dashboard-view').hidden = view !== 'dashboard';
    for (const item of document.querySelectorAll('.demo-nav-item')) {
      item.classList.toggle('active', item.dataset.view === view);
    }
  }
  for (const item of document.querySelectorAll('.demo-nav-item')) {
    item.addEventListener('click', () => showView(item.dataset.view));
  }

  /* ---------- thread (Screen 2, left) ---------- */

  function renderThread(episode) {
    els.thread.replaceChildren();
    if (episode.turns.length === 0) {
      els.thread.appendChild(starterBlock());
    } else {
      for (let i = 0; i < episode.turns.length; i++) {
        els.thread.appendChild(turnBlock(episode.turns[i], i, episode));
      }
      // Follow-up chips after the first turn so the user can keep asking
      // (episodic memory: the thread persists for this patient).
      els.thread.appendChild(followUpBlock(episode));
    }
    els.thread.scrollTop = els.thread.scrollHeight;
  }

  /** A compact chip row offered after the conversation starts. */
  function followUpBlock(episode) {
    const wrap = document.createElement('div');
    wrap.className = 'starter starter-followup';
    const title = document.createElement('div');
    title.className = 'starter-title';
    title.textContent = 'Ask another question';
    wrap.appendChild(title);
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const chip of CHIPS) {
      if (chip.dynamic && episode.assessments.length === 0) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.textContent = chip.label;
      btn.dataset.chip = chip.key;
      chips.appendChild(btn);
    }
    wrap.appendChild(chips);
    return wrap;
  }

  function starterBlock() {
    const wrap = document.createElement('div');
    wrap.className = 'starter';

    const title = document.createElement('div');
    title.className = 'starter-title';
    title.textContent = `Ask about ${state.current.name}`;
    wrap.appendChild(title);

    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const chip of CHIPS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.textContent = chip.label;
      btn.dataset.chip = chip.key;
      chips.appendChild(btn);
    }
    wrap.appendChild(chips);
    return wrap;
  }

  function turnBlock(turn, index, episode) {
    const block = document.createElement('div');
    block.className = `turn turn-${turn.role}`;

    if (turn.role === 'user') {
      const label = document.createElement('div');
      label.className = 'turn-label';
      label.textContent = state.current.name;
      block.appendChild(label);
      const text = document.createElement('div');
      text.className = 'turn-text';
      text.textContent = turn.text;
      block.appendChild(text);
      return block;
    }

    // agent turn
    const label = document.createElement('div');
    label.className = 'turn-label';
    label.textContent = 'Copilot';
    block.appendChild(label);

    const text = document.createElement('div');
    text.className = 'turn-text';
    text.appendChild(citedMarkdown(turn.text, index, episode));
    block.appendChild(text);

    if (turn.meta) {
      const meta = document.createElement('div');
      meta.className = 'turn-meta';
      meta.textContent = turn.meta;
      block.appendChild(meta);
    }
    return block;
  }

  /** Lightweight inline markdown for agent prose — operates on ESCAPED text,
      so the output is safe to inject (no raw HTML survives esc()). */
  function renderAgentMarkdown(escapedText) {
    const out = [];
    let list = null;                       // 'ul' | 'ol' | null
    const closeList = () => {
      if (list) { out.push(`</${list}>`); list = null; }
    };
    const inline = (t) => t
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
    for (const raw of escapedText.split(/\n/)) {
      const line = raw.trimEnd();
      const bullet = line.match(/^[*\-]\s+(.*)$/);
      const ordered = line.match(/^\d+\.\s+(.*)$/);
      const item = bullet || ordered;
      const tag = bullet ? 'ul' : 'ol';
      if (item) {
        if (list !== tag) { closeList(); out.push(`<${tag}>`); list = tag; }
        out.push(`<li>${inline(item[1])}</li>`);
      } else {
        closeList();
        if (line.trim()) out.push(`<p>${inline(line)}</p>`);
      }
    }
    closeList();
    return out.join('');
  }

  /** Turn citation markers in the rendered prose (^[1], ^[1, 2], ^[1-3])
      into clickable superscripts — one per cited passage. */
  function wireCitations(root, turnIndex, episode) {
    const re = /(\^\[(?:\d+(?:\s*,\s*\d+)*|\d+\s*-\s*\d+)\])/g;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (n.nodeValue && citationMarkers(n.nodeValue).length > 0) nodes.push(n);
    }
    for (const node of nodes) {
      const frag = document.createDocumentFragment();
      for (const part of node.nodeValue.split(re)) {
        const mk = citationMarkers(part)[0];
        if (mk && mk.full === part) {
          for (const n of mk.numbers) {
            const sup = document.createElement('sup');
            sup.className = 'cite';
            sup.textContent = String(n);
            sup.title = 'Show the cited note passage';
            sup.addEventListener('click', () => {
              if (typeof onCite === 'function') {
                onCite(episode, turnIndex, n, api);
              } else {
                paint(episodeFor(state.current.hadmId));
              }
            });
            frag.appendChild(sup);
          }
        } else if (part) {
          frag.appendChild(document.createTextNode(part));
        }
      }
      node.parentNode.replaceChild(frag, node);
    }
  }

  /** Render agent prose: safe light markdown + clickable ^[n] citations. */
  function citedMarkdown(text, turnIndex, episode) {
    const escaped = esc(text);
    const root = document.createRange().createContextualFragment(renderAgentMarkdown(escaped));
    wireCitations(root, turnIndex, episode);
    return root;
  }

  function agentTurnFromResponse(question, data) {
    const toolCalls = data.tool_calls || [];
    const rag = toolCalls.find((tc) => tc.name === 'rag_search');
    const predict = toolCalls.find((tc) => tc.name === 'predict_readmission');

    const used = toolCalls.map((tc) => tc.name).join(', ') || 'none';
    const metaParts = [`used: ${used}`];
    if (data.source === 'fixture') metaParts.push('fixture mode');
    if (predict) metaParts.push(`model ${predict.response.model_version || ''}`);

    return {
      role: 'agent',
      text: data.answer || 'No answer returned.',
      meta: metaParts.filter(Boolean).join(' · '),
      toolCalls: toolCalls,
      passages: (rag && rag.response.passages) || [],
      query: (rag && rag.response.query) || null,
      cited: citedNumbers(data.answer || ''),
      // The A2UI canvas renders a per-turn envelope, so a footnote click in an
      // older turn can re-draw that turn's composed canvas.
      a2ui: data.a2ui || null,
    };
  }

  /* ---------- trace toggle (Screen 3) — hidden until the trace journey ---------- */

  if (els.traceToggle) {
    els.traceToggle.addEventListener('click', () => {
      state.traceOn = !state.traceOn;
      els.traceToggle.classList.toggle('active', state.traceOn);
      els.traceToggle.setAttribute('aria-pressed', String(state.traceOn));
      els.traceToggle.innerHTML = state.traceOn
        ? '<i class="fa-solid fa-microscope"></i> Hide trace'
        : '<i class="fa-solid fa-microscope"></i> Show trace';
      paint(state.current ? episodeFor(state.current.hadmId) : null);
    });
  }

  /* ---------- ask flow ---------- */

  async function post(body, userText) {
    const episode = episodeFor(state.current.hadmId);

    // show the user turn immediately
    episode.turns.push({ role: 'user', text: userText });
    renderThread(episode);

    // pending indicator
    const pending = { role: 'agent', text: '…', meta: 'working' };
    episode.turns.push(pending);
    renderThread(episode);

    let data;
    try {
      const res = await fetch(state.askUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken() },
        body: JSON.stringify(body),
      });
      data = await res.json();
      if (typeof data.remaining === 'number') els.remaining.textContent = data.remaining;
      if (!res.ok) {
        // replace the pending turn with the readable error
        episode.turns[episode.turns.length - 1] = {
          role: 'agent',
          text: data.message || data.error || `HTTP ${res.status}`,
          meta: data.error ? `error: ${data.error}` : '',
          passages: [], toolCalls: [],
        };
        renderThread(episode);
        return;
      }
    } catch (err) {
      episode.turns[episode.turns.length - 1] = {
        role: 'agent', text: `Request failed: ${err}`, meta: '', passages: [], toolCalls: [],
      };
      renderThread(episode);
      return;
    }

    const turn = agentTurnFromResponse(userText, data);
    episode.turns[episode.turns.length - 1] = turn;
    episode.lastMode = data.source || 'live';
    episode.lastFixtureNote = data.fixture_note || '';
    // The A2UI renderer reads this envelope to draw the agent-composed canvas.
    episode.a2ui = data.a2ui || null;

    // episodic write: risk assessments feed the canvas (latest risk + drivers)
    const predict = (data.tool_calls || []).find((tc) => tc.name === 'predict_readmission');
    if (predict && predict.response && predict.response.probability != null) {
      episode.assessments.push(predict.response);
    }
    // sources accumulate for the SOURCE widget
    if (turn.passages.length || turn.query) {
      episode.sources.push({ query: turn.query, passages: turn.passages, cited: turn.cited });
    }

    renderThread(episode);
    paint(episode);
  }

  function askChip(chip) {
    if (!state.current) return;
    const chipDef = CHIPS.find((c) => c.key === chip);
    post({ hadm_id: state.current.hadmId, chip }, chipDef ? chipDef.label : chip);
  }

  els.thread.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-chip]');
    if (chip) askChip(chip.dataset.chip);
  });

  function askFreeText() {
    const text = els.input.value.trim();
    if (!text || !state.current) return;
    els.input.value = '';
    post({ question: text }, text);
  }

  els.askBtn.addEventListener('click', askFreeText);
  els.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') askFreeText();
  });

  return api;
}
