/**
 * What the citation hover card shows, decided by a pure function.
 *
 * The card used to print `excerpt` exactly as the server sent it, and the server sends
 * the whole passage: a 300-word PubMed abstract, or a full admission's hospital course.
 * Rendered in a 340px card that is a wall of text running off the bottom of the window,
 * and the reader's next move — opening the reference list — is hidden below the fold of a
 * popover they cannot scroll.
 *
 * So this module decides two things and nothing else: how much of a passage belongs in a
 * glance, and how to keep the part that carries the evidence. It never shortens the
 * passage itself. The bottom REFERENCES drawer still prints the whole thing, and the
 * evaluation harness reads the same untruncated text from the payload; a preview is a
 * property of one surface, not of the evidence.
 *
 * Three shapes, in the order they are tried:
 *
 * 1. **A structured abstract.** NLM labels its sections, and a reader looking for the
 *    answer wants RESULTS and CONCLUSION. The setup and the methods are what the authors
 *    did, not what they found, so they are dropped and the card says it dropped them.
 * 2. **An inline numbered list.** A discharge diagnosis reads `1. Neck pain. 2. Cervical
 *    spondylosis.`, and four lines of it is a preview while one run-on paragraph is not.
 * 3. **Prose.** Kept verbatim when it is short, clamped at a sentence boundary when it is
 *    not.
 *
 * Every cut lands outside an open `(` or `[`. A statistic sliced in half —
 * `(OR 2.14; 95% CI, 1.41-3.2` — is worse than no excerpt, because it looks like a
 * complete interval.
 */

//: The budget, in characters. `short` is the longest passage shown whole; `clamp` the
//: hard ceiling for a prose clamp; `block` the per-section limit inside a structured
//: abstract and `total` the two of them together.
export const PREVIEW_LIMITS = {
  short: 320,
  clamp: 360,
  block: 220,
  total: 420,
  item: 160,
  items: 4,
};

//: NLM section labels, mapped to the two blocks the card shows. A label that is not here
//: is either setup (dropped) or text the label list has never seen, which is why the
//: parser requires a known label before it treats a colon as structure.
const SECTIONS = {
  'PURPOSE': 'setup',
  'OBJECTIVE': 'setup',
  'OBJECTIVES': 'setup',
  'BACKGROUND': 'setup',
  'SUMMARY OF BACKGROUND DATA': 'setup',
  'STUDY DESIGN': 'setup',
  'MATERIALS AND METHODS': 'setup',
  'PATIENTS AND METHODS': 'setup',
  'METHODS': 'setup',
  'RESULTS': 'results',
  'FINDINGS': 'results',
  'CONCLUSION': 'conclusion',
  'CONCLUSIONS': 'conclusion',
};

//: The headings that can appear unpunctuated. `28142261` is the shape that forced this:
//: `OBJECTIVE The goal of this study … METHODS The authors used … RESULTS A total …` with
//: no colons anywhere, because the record states no `Label` attributes at all.
const BARE_HEADINGS = Object.keys(SECTIONS).join('|');

const COLON_HEADING_RE = new RegExp(`(?:^|\\s)(${BARE_HEADINGS})\\s*:\\s*`, 'g');
//: A bare heading counts only at the start of the text or after a full stop, and only
//: when a capitalised word follows it. Without both conditions the word `methods` in
//: ordinary prose splits a sentence in half.
const BARE_HEADING_RE = new RegExp(
  `(?:^|(?<=[.!?]\\s))(${BARE_HEADINGS})(?=\\s+[A-Z])`, 'g');

/** Consecutive whitespace — the abstracts arrive with newlines and double spaces. */
function collapse(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The nesting depth of every character, counted *before* it is read.
 *
 * One pass, reused by every cutter below. Depth 0 at index `i` means a boundary there
 * cannot fall inside a parenthetical, which is the only property the cutters need.
 */
function depthsOf(text) {
  const depths = new Array(text.length).fill(0);
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    depths[i] = depth;
    const char = text[i];
    if (char === '(' || char === '[') depth += 1;
    else if ((char === ')' || char === ']') && depth > 0) depth -= 1;
  }
  return depths;
}

/** The end index of the last sentence finishing at or before `limit`, or -1. */
function lastSentenceEnd(text, limit, depths) {
  for (let i = Math.min(limit, text.length) - 1; i >= 0; i -= 1) {
    if (depths[i] !== 0) continue;
    if (!'.!?'.includes(text[i])) continue;
    if (i + 1 === text.length || text[i + 1] === ' ') return i + 1;
  }
  return -1;
}

/** The end index of the last clause (`,` or `;`) at or before `limit`, or -1. */
function lastClauseEnd(text, limit, depths) {
  for (let i = Math.min(limit, text.length) - 1; i >= 0; i -= 1) {
    if (depths[i] !== 0) continue;
    if (text[i] === ',' || text[i] === ';') return i;
  }
  return -1;
}

/** The end index of the last whole word at or before `limit`, or -1. */
function lastWordEnd(text, limit, depths) {
  for (let i = Math.min(limit, text.length) - 1; i >= 0; i -= 1) {
    if (depths[i] === 0 && text[i] === ' ') return i;
  }
  return -1;
}

/**
 * `text` shortened to at most `limit` characters, cut where a reader can stop.
 *
 * Sentence first, then clause, then word. When even the first word boundary is past the
 * limit — a single 400-character sentence with no punctuation — the text is returned as
 * it is rather than sliced: a preview that cuts mid-number is a preview that lies about
 * the number.
 */
function clampText(text, limit) {
  const body = collapse(text);
  if (body.length <= limit) return { text: body, truncated: false };
  const depths = depthsOf(body);
  const sentence = lastSentenceEnd(body, limit, depths);
  let cut = sentence;
  if (cut < Math.floor(limit / 3)) cut = lastClauseEnd(body, limit, depths);
  if (cut < Math.floor(limit / 3)) cut = lastWordEnd(body, limit, depths);
  if (cut <= 0) return { text: body, truncated: false };
  return { text: `${body.slice(0, cut).trim().replace(/[,;]$/, '')}…`, truncated: true };
}

/**
 * The labelled sections of a structured abstract, or null when it has none.
 *
 * Both NLM spellings are tried, because the record decides which one it uses and the two
 * look nothing alike: `PURPOSE: …` with labels on every section, and `OBJECTIVE The goal
 * …` with none. A text that matches neither is not structured, and the caller falls back
 * to prose.
 */
function parseSections(text) {
  const found = [];

  COLON_HEADING_RE.lastIndex = 0;
  for (const match of text.matchAll(COLON_HEADING_RE)) {
    found.push({ label: match[1], start: match.index, bodyAt: match.index + match[0].length });
  }

  if (found.length < 2) {
    found.length = 0;
    BARE_HEADING_RE.lastIndex = 0;
    for (const match of text.matchAll(BARE_HEADING_RE)) {
      found.push({ label: match[1], start: match.index, bodyAt: match.index + match[0].length });
    }
  }
  if (found.length < 2) return null;

  const sections = { results: '', conclusion: '', setup: '' };
  found.forEach((entry, index) => {
    const end = index + 1 < found.length ? found[index + 1].start : text.length;
    const kind = SECTIONS[entry.label];
    if (!kind) return;
    const body = text.slice(entry.bodyAt, end).trim();
    // The same label twice keeps its first occurrence: a record repeats `CONCLUSION`
    // more often than it means to.
    if (body && !sections[kind]) sections[kind] = body;
  });
  if (!sections.results && !sections.conclusion) return null;
  return sections;
}

/**
 * The items of an inline numbered list, or null when the passage is not one.
 *
 * The hard part is not finding `1.` — it is not finding `7.5%`, `2.6%`, `p = 0.003` or
 * `2022. Lee YJ`. All three are excluded by the same requirement: a list marker is one or
 * two digits, followed by a full stop, followed by a space, followed by a capital. A
 * decimal has a digit after the stop, a year has four digits, and an author initial is not
 * a list at all because the list has to start at 1 and to have a second item.
 */
function parseNumberedList(text) {
  const markers = [];
  const markerRe = /(^|[\s.;:])(\d{1,2})\.\s+(?=[A-Z])/g;
  for (const match of text.matchAll(markerRe)) {
    markers.push({
      number: Number(match[2]),
      start: match.index,
      bodyAt: match.index + match[0].length,
    });
  }
  if (markers.length < 2 || markers[0].number !== 1) return null;

  const items = markers.map((marker, index) => {
    const end = index + 1 < markers.length ? markers[index + 1].start : text.length;
    return text.slice(marker.bodyAt, end).trim().replace(/[.;]+$/, '');
  }).filter(Boolean);
  if (items.length < 2) return null;

  const kept = items.slice(0, PREVIEW_LIMITS.items).map((item) => clampText(item, PREVIEW_LIMITS.item));
  return {
    items: kept.map((entry) => entry.text),
    moreCount: Math.max(0, items.length - PREVIEW_LIMITS.items),
    truncated: kept.some((entry) => entry.truncated),
  };
}

/**
 * One citation's preview:
 *
 * `{ layout, blocks, items, moreCount, disclosure }`
 *
 * - `layout` is `'structured'` (labelled Results/Conclusion), `'list'` (numbered items) or
 *   `'text'` (prose);
 * - `disclosure` says the card is showing less than the passage holds, and is what puts
 *   the "Excerpt shown" cue at the foot of the card. A short passage shows the whole
 *   thing and must NOT carry that cue: a caveat about truncation on text that was never
 *   truncated teaches the reader to ignore the cue.
 */
export function formatCitationPreview(excerpt) {
  const body = collapse(excerpt);
  if (!body) return { layout: 'text', blocks: [], items: [], moreCount: 0, disclosure: false };

  const sections = parseSections(body);
  if (sections) {
    const blocks = [];
    let budget = PREVIEW_LIMITS.total;
    if (sections.results) {
      const results = clampText(sections.results, PREVIEW_LIMITS.block);
      blocks.push({ label: 'Results', text: results.text });
      budget -= results.text.length;
    }
    if (sections.conclusion) {
      const limit = Math.max(60, Math.min(PREVIEW_LIMITS.block, budget));
      blocks.push({ label: 'Conclusion', text: clampText(sections.conclusion, limit).text });
    }
    return { layout: 'structured', blocks, items: [], moreCount: 0, disclosure: true };
  }

  const list = parseNumberedList(body);
  if (list) {
    return {
      layout: 'list',
      blocks: [],
      items: list.items,
      moreCount: list.moreCount,
      // A list short enough to be shown whole still had its heading dropped, so it is
      // shown as exactly what the passage holds and carries no disclosure.
      disclosure: list.truncated || list.moreCount > 0,
    };
  }

  if (body.length <= PREVIEW_LIMITS.short) {
    return { layout: 'text', blocks: [{ label: null, text: body }], items: [],
      moreCount: 0, disclosure: false };
  }

  const clamped = clampText(body, PREVIEW_LIMITS.clamp);
  return {
    layout: 'text',
    blocks: [{ label: null, text: clamped.text }],
    items: [],
    moreCount: 0,
    disclosure: clamped.truncated,
  };
}
