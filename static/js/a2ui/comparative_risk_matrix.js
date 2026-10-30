/** The cohort the patient was scored against, as a comparative table. */

import { html, css, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { A2uiController, A2uiLitElement } from '@a2ui/lit/v0_9';
import z from 'zod';

import {
  BLOCK_SETTLE, CITE_STYLES, bandLabel, bindCitationMarkers, percent, pubmedUrl,
} from './shared.js';

const _MATRIX_STYLES = css`
  :host { display: block; }
  /* The table is allowed to be wider than the column rather than squeezed into it: five
     clinical columns compressed to a phone width are unreadable, and a reader who has to
     scroll one table has lost less than a reader who cannot read it at all.

     Nothing here sets a MINIMUM width, which is the distinction the first version missed.
     A minimum on the cohort column pushed the table past its container, and a table that
     overflows is one whose last column is clipped — a pill cut mid-word, which reads as a
     rendering fault rather than as a table that continues. Text columns wrap, so the
     browser sizes them from their longest word and the slack goes where it is useful. */
  .wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 0.82rem; }
  /* The pill beside a cohort, sized for a table cell rather than for a sentence. The
     shared sheet sets it as a superscript inside prose; here it sits on the baseline next
     to the journal, because a row has no sentence to hang it off. This sheet is parsed
     after the shared one, so these three declarations are the only difference. */
  .cite { vertical-align: baseline; font-size: 0.68rem; margin-left: 6px; }
  caption { caption-side: top; text-align: left; color: #64748b; font-size: 0.72rem;
            letter-spacing: 0.04em; text-transform: uppercase; padding: 0 0 6px; }
  th, td { text-align: left; vertical-align: top; padding: 8px 10px;
           border-bottom: 1px solid rgba(17, 24, 39, 0.12); }
  th { color: #64748b; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.04em;
       text-transform: uppercase; white-space: nowrap; }
  tr.baseline td { background: rgba(37, 99, 235, 0.06); }
  tr.baseline td:first-child { box-shadow: inset 3px 0 0 #2563eb; }
  .rate { font-weight: 600; white-space: nowrap; }
  .under { display: block; font-weight: 400; font-size: 0.72rem; color: #475569;
           margin-top: 2px; }
  .pills { display: flex; flex-wrap: wrap; gap: 4px; }
  .pill { border: 1px solid rgba(17, 24, 39, 0.18); border-radius: 999px;
          font-size: 0.72rem; padding: 1px 8px; white-space: nowrap; }
  /* The first column is the comparison itself — who was studied — so it carries the
     weight, and the design and the finding sit under it as subtext. */
  .population { display: block; font-weight: 500; }
  .design { color: #64748b; font-size: 0.72rem; margin-top: 4px; }
  /* The source column holds a citation and nothing else. It used to stack a journal name,
     a pill and a raw PMID link on one another, which is the same record told three times. */
  .source { white-space: nowrap; }
  /* The abstract sits under its cohort rather than in a fifth column, and is clamped to
     three lines. Five text columns do not fit this console: measured at 759px, the excerpt
     column squeezed the cohort summary into eleven lines and the provenance into six,
     which is a hedge maze rather than a table. The full excerpt is still in the payload and
     still in the export — only the drawing is clipped.

     The clamp lives here and not in the data, because a clamp is a layout decision; a
     reader who exports gets the whole text. */
  .excerpt { color: #475569; font-size: 0.78rem; margin-top: 6px;
             display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
             overflow: hidden; }
  .tier { color: #64748b; font-size: 0.72rem; margin-top: 4px; }
  /* An em dash, not an empty cell: the column is answered, and the answer is that the
     record names none of her drivers. A blank would read as a value that failed to load. */
  .none { color: #94a3b8; font-style: italic; }
  .pmid { font-size: 0.72rem; margin-top: 4px; white-space: nowrap; }
  .pmid a { color: inherit; }
  .note { color: #475569; font-size: 0.85rem; margin-bottom: 6px; }
`;

const ComparativeRiskMatrixApi = {
  name: 'ComparativeRiskMatrix',
  schema: z.object({
    // Absent when the turn had no estimate to pin. The row is then not drawn at all —
    // see `baseline_note` — because a pinned row with no figure in it is a claim about
    // this patient that says nothing.
    baseline: z.object({
      source: z.string(),
      probability: z.number(),
      threshold: z.number(),
      decision: z.number(),
      cohort: z.string(),
      provenance: z.string(),
    }).optional(),
    baseline_note: z.string().default(''),
    rows: z.array(z.object({
      pmid: z.string(),
      source: z.string(),
      reported_rate: z.string(),
      cohort_summary: z.string(),
      evidence_tier: z.string(),
      horizon_days: z.number(),
      url: z.string(),
      excerpt: z.string(),
      // The paper itself, carried beside the journal line. Optional, because a compact
      // row is still a valid row — and `_citationFor` reads all four, so a schema that
      // omitted them would reject the payload it is written to consume: this object's
      // parser is strict, and a field the agent sends that is not declared here fails the
      // whole table rather than dropping one property.
      title: z.string().optional(),
      authors: z.string().optional(),
      journal: z.string().optional(),
      year: z.string().optional(),
      // The turn's own number for this record, so the row can be cited beside the answer
      // that drew it. The agent registers each benchmark as a source at the end of its
      // note passages and stamps the row with the number it assigned, rather than the
      // surface resolving a PMID back to an index a second time.
      //
      // Optional, and it stays optional: a turn composed before the agent registered
      // benchmarks is still a valid table, and a schema that demanded the number would
      // stop that table drawing at all.
      source_index: z.number().optional(),
      source_label: z.string().optional(),
    })).default([]),
  }).strict(),
};

class ComparativeRiskMatrixElement extends A2uiLitElement {
  // The pill's sheet first, then this component's own: a later sheet wins at equal
  // specificity, which is how the table overrides the prose sizing of `.cite`.
  static styles = [CITE_STYLES, _MATRIX_STYLES, BLOCK_SETTLE];

  constructor() {
    super();
    this._popover = null;
    this._wired = false;
  }

  createController() {
    return new A2uiController(this, ComparativeRiskMatrixApi);
  }

  updated() {
    this._popover = this._popover || this.renderRoot.querySelector('citation-popover');
    if (this._wired) return;
    this._wired = true;
    // The same gestures the prose markers use: rest to open, cross to leave, click to
    // pin. A reader who has met one pill in this product has met both.
    bindCitationMarkers(
      this.renderRoot,
      () => this._popover,
      (button) => this._citationFor(Number(button.dataset.cite)),
    );
  }

  /**
   * The source behind a table pill, shaped like a prose citation.
   *
   * The agent registers each benchmark as a source and stamps the row with the number it
   * assigned (`source_index`), so this is a lookup and not a second numbering. The card
   * wants a title, a subtitle and the passage, and a table row carries those as fields
   * rather than as prose: the journal and year are its `source`, the identifier and the
   * evidence tier make the subtitle, and the cohort description plus the sentence the rate
   * was read from make the passage.
   */
  _citationFor(index) {
    const rows = this.controller?.props?.rows || [];
    const row = rows.find((entry) => Number(entry.source_index) === Number(index));
    if (!row) return null;
    // The citation line, punctuated the way a reference is: journal, year, authors, id.
    const journalCitation = [
      row.journal ? `${row.journal}.` : '',
      row.year ? `${row.year}.` : '',
      row.authors || '',
    ].filter(Boolean).join(' ').trim();
    return {
      index: Number(row.source_index),
      source: [journalCitation, row.pmid ? `PMID ${row.pmid}` : ''].filter(Boolean)
        .join(' · '),
      // The ARTICLE, not its journal: this is the heading the card is titled with and
      // the text the reader is being asked to weigh.
      title: row.title || row.source,
      excerpt: [row.cohort_summary, row.excerpt].filter(Boolean).join(' — '),
      url: row.url || pubmedUrl(row.pmid),
    };
  }

  render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const baseline = props.baseline;
    const rows = props.rows || [];
    const horizon = rows.length ? `${rows[0].horizon_days}-day` : '';

    return html`
      ${baseline ? nothing : html`<div class="note">${props.baseline_note}</div>`}
      <div class="wrap">
        <table aria-label=${baseline
          ? `This patient and published ${horizon} readmission rates`
          : `Published ${horizon} readmission rates`}>
          <thead>
            <tr>
              <th scope="col">Population / treatment</th>
              <th scope="col">30-day readmission</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            ${baseline ? html`
              <tr class="baseline">
                <td>
                  <span class="population">${baseline.cohort}</span>
                  <div class="design">Discharge readmission evaluation</div>
                </td>
                <td class="rate">
                  ${percent(baseline.probability)}
                  <span class="under">${bandLabel(baseline)}, threshold
                    ${percent(baseline.threshold)}</span>
                </td>
                <td>
                  ${baseline.source}
                  <div class="design">${baseline.provenance}</div>
                </td>
              </tr>
            ` : nothing}
            ${rows.map((row) => html`
              <tr>
                <td>
                  <span class="population">${row.cohort_summary}</span>
                  <div class="design">${row.evidence_tier}</div>
                  <div class="excerpt">${row.excerpt}</div>
                </td>
                <td class="rate">${row.reported_rate}
                  <span class="under">${row.horizon_days}-day</span></td>
                <td class="source">${row.source_index === undefined
                  ? html`<span class="journal">${row.source}</span>`
                  : html`<button class="cite" type="button"
                                 data-cite=${String(row.source_index)}
                                 aria-haspopup="dialog" aria-expanded="false"
                                 aria-label="Reference ${row.source_index}: ${
                                   row.title || row.source}">${row.source_label
                                   || row.source}</button>`}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
      <citation-popover></citation-popover>
    `;
  }
}

export const ComparativeRiskMatrix = {
  ...ComparativeRiskMatrixApi, tagName: 'a2ui-comparative-risk-matrix',
};
customElements.define('a2ui-comparative-risk-matrix', ComparativeRiskMatrixElement);

// ---------------------------------------------------------------------------
// Lab trend card

//
// What a measurement did across the admission, one row per analyte. Phase 3 asks for a
// sparkline, a reference range, a delta and abnormal flags in a compact table, and the
// order they appear in is the order a reader needs them: what was measured, what normal is,
// where this patient sat against it, and how far they moved.
//
// The card is a GLANCE, not the record. Every value is in the export, and the row here
// carries the shape plus anything abnormal — because ten analytes times six timepoints is
// sixty numbers, and a card that printed all of them is one nobody reads.
//
// Provenance is stated once, by the turn rather than by the card. The reader sees
// the answer's own label — "Patient Chart Synthesis" — above this table, and the
// caveat that used to sit under it said the same thing a second time, while the
// per-row "scored"/"generated" markers asked the reader to decode two words that
// meant nothing to them. Provenance repeated three ways is not three guarantees; it
// is one guarantee and two distractions.
//
// The payload keeps `note` and `anchored`: the export and the eval read them, and
// which measures the model actually scored is a fact about the run. The card no
// longer draws either.

