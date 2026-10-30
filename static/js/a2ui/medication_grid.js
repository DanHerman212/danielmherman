/** The discharge medication list, as the extraction returned it. */

import { html, css, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { A2uiController, A2uiLitElement } from '@a2ui/lit/v0_9';
import z from 'zod';

import { BLOCK_SETTLE } from './shared.js';

const _MEDS_STYLES = css`
  :host { display: block; }
  .grid { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px;
          overflow: hidden; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th { text-align: left; font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
       letter-spacing: 0.04em; color: #64748b; background: #f8fafc;
       padding: 9px 12px; border-bottom: 1px solid #e5e7eb; }
  td { padding: 9px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  tr:last-child td { border-bottom: 0; }
  .medication { font-weight: 600; }
  /* The columns a clinician scans down, rather than reads across: tabular figures so
     the digits line up, and no wrapping so a dose never breaks mid-value. */
  .dosage, .frequency { font-variant-numeric: tabular-nums; white-space: nowrap;
                        color: #334155; }
  .missing { font-size: 0.75rem; color: #94a3b8; }
  .incomplete { font-size: 0.75rem; color: #64748b; margin-top: 8px; }
`;

const MedicationGridApi = {
  name: 'MedicationGrid',
  schema: z.object({
    medications: z.array(z.object({
      medication: z.string(),
      dosage: z.string(),
      frequency: z.string(),
    })).default([]),
    dropped_count: z.number().default(0),
    returned_passages: z.number().default(0),
  }).strict(),
};

class MedicationGridElement extends A2uiLitElement {
  static styles = [_MEDS_STYLES, BLOCK_SETTLE];

  createController() {
    return new A2uiController(this, MedicationGridApi);
  }

  render() {
    const props = this.controller?.props;
    if (!props) return nothing;

    const rows = props.medications || [];
    // No rows and no grid: the agent composes this component only when it has rows,
    // because an empty table reads as "this patient takes nothing". Rendering nothing
    // here keeps that true even if a fixture or a future composer sends one.
    if (rows.length === 0) return nothing;

    const dropped = Number(props.dropped_count) || 0;
    return html`
      <div class="grid">
        <table>
          <thead>
            <tr>
              <th scope="col">Medication</th>
              <th scope="col">Dosage</th>
              <th scope="col">Frequency</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => html`
              <tr>
                <td class="medication">${row.medication}</td>
                <td class="dosage">${row.dosage
                  || html`<span class="missing">not stated</span>`}</td>
                <td class="frequency">${row.frequency
                  || html`<span class="missing">not stated</span>`}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
      ${dropped > 0
        ? html`<div class="incomplete">
            ${dropped} further ${dropped === 1 ? 'row was' : 'rows were'} read from the
            note but could not be verified, and ${dropped === 1 ? 'is' : 'are'} not
            shown.
          </div>`
        : nothing}
    `;
  }
}

export const MedicationGrid = {
  ...MedicationGridApi, tagName: 'a2ui-medication-grid',
};
customElements.define('a2ui-medication-grid', MedicationGridElement);

