/** One admission's laboratory series: values, reference interval and flags. */

import { html, css, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { A2uiController, A2uiLitElement } from '@a2ui/lit/v0_9';
import z from 'zod';

import { BLOCK_SETTLE } from './shared.js';

const _LAB_STYLES = css`
  :host { display: block; }
  table { border-collapse: collapse; width: 100%; font-size: 0.82rem; }
  th, td { text-align: left; vertical-align: middle; padding: 6px 10px;
           border-bottom: 1px solid rgba(17, 24, 39, 0.12); }
  th { color: #64748b; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.04em;
       text-transform: uppercase; white-space: nowrap; }
  .measure { font-weight: 600; white-space: nowrap; }
  .unit { display: block; font-weight: 400; font-size: 0.72rem; color: #64748b;
          margin-top: 2px; }
  .reference { white-space: nowrap; color: #475569; }
  .course { min-width: 12rem; }
  .spark { display: block; }
  .band { fill: rgba(37, 99, 235, 0.10); }
  .line { fill: none; stroke: #1f2937; stroke-width: 1.6;
          stroke-linejoin: round; stroke-linecap: round; }
  .dot { fill: #1f2937; }
  .dot.abnormal { fill: #b91c1c; }
  .delta { font-size: 0.72rem; color: #475569; margin-top: 4px; }
  .flags { display: flex; flex-wrap: wrap; gap: 4px; }
  .flag { border-radius: 4px; font-size: 0.68rem; font-weight: 600; padding: 1px 6px;
          white-space: nowrap; }
  .flag.low, .flag.high { background: rgba(180, 83, 9, 0.12); color: #92400e; }
  .flag.critical { background: rgba(185, 28, 28, 0.12); color: #b91c1c; }
  .normal { color: #64748b; font-size: 0.72rem; }
`;

const LabTrendCardApi = {
  name: 'LabTrendCard',
  schema: z.object({
    trends: z.array(z.object({
      key: z.string(),
      label: z.string(),
      unit: z.string(),
      reference_low: z.number(),
      reference_high: z.number(),
      decimals: z.number(),
      // The feature-row keys this series reproduces. Empty means the model never scored
      // this measure, which is what the row's marker reports.
      anchored: z.array(z.string()).default([]),
      series: z.array(z.object({
        day: z.number(),
        value: z.number(),
        flag: z.string(),
      })).default([]),
    })).default([]),
    synthetic: z.boolean().default(false),
    note: z.string().default(''),
  }).strict(),
};

/** The flag vocabulary, as the letter or word a reader is shown. */
const FLAG_TEXT = {
  low: 'L',
  high: 'H',
  critical_low: 'Critical low',
  critical_high: 'Critical high',
};

const _isAbnormal = (flag) => flag && flag !== 'normal';

/**
 * The course as a sparkline, with the reference interval shaded behind it.
 *
 * The vertical scale is the reference band UNION the values, never the band alone: a
 * critical value outside the interval has to be visible as a departure from the band rather
 * than clipped to the edge of the drawing, because the departure is the finding.
 */
function sparkline(series, low, high, decimals, label) {
  const values = series.map((point) => Number(point.value));
  const lo = Math.min(low, ...values);
  const hi = Math.max(high, ...values);
  const span = (hi - lo) || 1;
  const width = 104;
  const height = 26;
  const pad = 3;
  const x = (index) => pad + (index / Math.max(series.length - 1, 1)) * (width - 2 * pad);
  const y = (value) => height - pad - ((value - lo) / span) * (height - 2 * pad);
  const bandTop = y(high);
  const bandHeight = Math.max(y(low) - y(high), 1);
  const points = values.map((value, index) =>
    x(index).toFixed(1) + ',' + y(value).toFixed(1)).join(' ');
  const spoken = label + ' across ' + series.length + ' timepoints, from '
    + values[0].toFixed(decimals) + ' to ' + values[values.length - 1].toFixed(decimals);

  return html`
    <svg class="spark" viewBox=${'0 0 ' + width + ' ' + height}
         width=${width} height=${height} role="img" aria-label=${spoken}>
      <rect class="band" x="0" y=${bandTop} width=${width} height=${bandHeight}></rect>
      <polyline class="line" points=${points}></polyline>
      ${values.map((value, index) => html`
        <circle class="dot ${_isAbnormal(series[index].flag) ? 'abnormal' : ''}"
                cx=${x(index)} cy=${y(value)} r="1.8"></circle>`)}
    </svg>
  `;
}

class LabTrendCardElement extends A2uiLitElement {
  static styles = [_LAB_STYLES, BLOCK_SETTLE];

  createController() {
    return new A2uiController(this, LabTrendCardApi);
  }

  render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const trends = props.trends || [];
    if (!trends.length) return nothing;

    return html`
      <table>
        <thead>
          <tr>
            <th scope="col">Measurement</th>
            <th scope="col">Reference</th>
            <th scope="col">Course</th>
            <th scope="col">Flags</th>
          </tr>
        </thead>
        <tbody>
          ${trends.map((trend) => {
            const series = trend.series || [];
            const values = series.map((point) => Number(point.value));
            const first = values[0];
            const last = values[values.length - 1];
            const direction = last > first ? 'higher' : (last < first ? 'lower' : 'unchanged');
            const abnormal = series.filter((point) => _isAbnormal(point.flag));
            const counts = {};
            abnormal.forEach((point) => {
              const key = point.flag.startsWith('critical') ? 'critical' : point.flag;
              counts[key] = (counts[key] || 0) + 1;
            });
            return html`
              <tr>
                <td class="measure">
                  ${trend.label}
                  <span class="unit">${trend.unit}</span>
                </td>
                <td class="reference">${trend.reference_low}–${trend.reference_high}</td>
                <td class="course">
                  ${sparkline(series, trend.reference_low, trend.reference_high,
                              trend.decimals, trend.label)}
                  <div class="delta">
                    ${first.toFixed(trend.decimals)} → ${last.toFixed(trend.decimals)}
                    (${direction}), ${series.length} points over ${series[series.length - 1].day} days
                  </div>
                </td>
                <td>
                  ${abnormal.length
                    ? html`<div class="flags">${Object.keys(counts).map((key) => html`
                        <span class="flag ${key}">${FLAG_TEXT[key] || key}${
                          counts[key] > 1 ? ' ×' + counts[key] : ''}</span>`)}</div>`
                    : html`<span class="normal">Within range</span>`}
                </td>
              </tr>
            `;
          })}
        </tbody>
      </table>
    `;
  }
}

export const LabTrendCard = {
  ...LabTrendCardApi, tagName: 'a2ui-lab-trend',
};
customElements.define('a2ui-lab-trend', LabTrendCardElement);

// ---------------------------------------------------------------------------
// Medications
//
// The grid, for `/meds`. A list of drugs in prose is what it replaces: a clinician
// scanning for one agent on one dose reads a column, not a paragraph. Every row was
// verified against the note text before it reached the surface, and the rows that
// failed verification are not drawn at all — but they are counted, because a list
// with a hole in it and a complete list must not look the same.

