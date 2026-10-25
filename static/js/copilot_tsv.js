/* Enterprise Clinical Copilot — the turn's structured rows, as tab-separated text.

   Read from the surface the agent composed rather than from the DOM, because the DOM
   is where those rows are drawn, not where they are defined. Pure: a surface object
   in, text out — no DOM, no closure state, no async. That is why it is the first
   block that could leave `copilot_canvas.js`, and why it is a whole file now.

   Loaded before `copilot_canvas.js`, which reads it as `window.CopilotTSV`. The
   namespace is frozen: this is an island with one export, not a place to hang new
   page state. */

(function () {
  'use strict';

  function percent(value) {
    return (Number(value) * 100).toFixed(1) + '%';
  }

  /* The turn's structured rows as tab-separated text, or '' when it drew none.

     Tab rather than comma: a clinical value may contain a comma and may not contain a
     tab, so the delimiter cannot collide with a field. Read from the surface the agent
     composed rather than from the DOM, because the DOM is where these rows are drawn,
     not where they are defined — a reader who exports a grid should get the rows the
     tool returned, not what the widget happened to paint.

     One block per structured component, blank line between, so a turn carrying more
     than one table exports as more than one table rather than as one run-on sheet. */
  function structuredRows(surface) {
    var messages = (surface || {}).messages;
    var components = messages && messages[1] && messages[1].updateComponents
      && messages[1].updateComponents.components;
    if (!Array.isArray(components)) return '';

    var key = function (value) { return String(value == null ? '' : value); };
    var blocks = [];

    components.forEach(function (component) {
      var rows = null;
      if (component.component === 'RiskInfluencers') {
        rows = [['driver', 'contribution', 'direction']];
        (component.factors || []).forEach(function (factor) {
          var value = Number(factor.contribution) || 0;
          rows.push([factor.label, value.toFixed(4),
                     value >= 0 ? 'increases' : 'decreases']);
        });
      } else if (component.component === 'MedicationGrid') {
        rows = [['medication', 'dosage', 'frequency']];
        (component.medications || []).forEach(function (row) {
          rows.push([row.medication, row.dosage, row.frequency]);
        });
      } else if (component.component === 'LiteratureList') {
        rows = [['pmid', 'title', 'journal', 'pub_date', 'url']];
        (component.articles || []).forEach(function (article) {
          rows.push([article.pmid, article.title, article.journal,
                     article.pub_date, article.url]);
        });
      } else if (component.component === 'LabTrendCard') {
        /* One row per measurement, with the points joined rather than summarised.

           A lab course IS a series, and an export that gave one number per analyte would
           throw away the thing the card was drawn to show. Days, values and flags are three
           parallel lists in one row, because the shape of a lab table is a series per
           measurement and flattening it into repeated rows would lose which reading belongs
           to which day. */
        rows = [['measurement', 'unit', 'reference', 'days', 'values', 'flags']];
        (component.trends || []).forEach(function (trend) {
          var series = trend.series || [];
          rows.push([
            trend.label,
            trend.unit,
            trend.reference_low + '-' + trend.reference_high,
            series.map(function (point) { return point.day; }).join('; '),
            series.map(function (point) { return point.value; }).join('; '),
            series.map(function (point) { return point.flag; }).join('; '),
          ]);
        });
      } else if (component.component === 'ComparativeRiskMatrix') {
        /* The patient's row, then the cohorts — in one sheet, because that is what the
           reader is looking at. The provenance column carries the record's PMID for a
           cohort row: an export that omits the identifier omits the only thing in the row
           anyone can check. */
        rows = [['cohort', 'readmission_rate', 'cohort_definition',
                 'shared_risk_factors', 'provenance_or_pmid']];
        var baseline = component.baseline;
        if (baseline) {
          rows.push([baseline.source, percent(baseline.probability),
                     baseline.cohort, (baseline.drivers || []).join('; '),
                     baseline.provenance]);
        }
        (component.rows || []).forEach(function (row) {
          rows.push([row.source, row.reported_rate, row.cohort_summary,
                     (row.matched_features || []).join('; '), row.pmid]);
        });
      }
      if (rows && rows.length > 1) {
        blocks.push(rows.map(function (row) {
          return row.map(key).join('\t');
        }).join('\n'));
      }
    });

    return blocks.join('\n\n');
  }

  /* Ask a follow-up by putting it in the composer and submitting, rather than by a
     path of its own. A question built here would be a second way into the chain, with
     its own handling of intent, clearing and the in-flight guard — and the two would
     drift. Typed into the box, it is asked exactly as the reader would have asked it.

     Module scope, not per turn. It closes over `input`, `form` and `declaredIntent`,
     which live here, and TWO callers need it: a follow-up row inside a turn, and the
     feed's `a2ui-follow-up` listener, which hears a clicked risk driver for the whole
     column. Nested inside `createTurn` it was invisible to that listener, and every
     click threw `ReferenceError` before anything was sent — no turn, no request, no
     server-side trace of the failure (2026-10-22). */
  window.CopilotTSV = Object.freeze({
    percent: percent,
    structuredRows: structuredRows,
  });
})();
