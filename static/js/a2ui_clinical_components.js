/**
 * The clinical components, as one importable surface.
 *
 * The catalog id, the components, and the two functions a page needs: `mountSurfaces`,
 * which joins an envelope to the renderer, and `buildClinicalCatalog`. Each component is
 * its own module under `static/js/a2ui/`; importing this file registers all of them, so a
 * page that imports one entrypoint gets the whole set — which is what the Rollup entry and
 * the fixtures both rely on.
 */

import { basicCatalog, Context } from '@a2ui/lit/v0_9';
import { ContextProvider } from '@lit/context';
import { renderMarkdown } from '@a2ui/markdown-it';
import { MessageProcessor } from '@a2ui/web_core/v0_9';

import { CATALOG_ID } from './a2ui/shared.js';
import { RiskInfluencers } from './a2ui/risk_influencers.js';
import './a2ui/citation_popover.js';
import { CitedNarrative } from './a2ui/cited_narrative.js';
import { LiteratureList } from './a2ui/literature_list.js';
import { ComparativeRiskMatrix } from './a2ui/comparative_risk_matrix.js';
import { LabTrendCard } from './a2ui/lab_trend.js';
import { MedicationGrid } from './a2ui/medication_grid.js';

export { CATALOG_ID };

export {
  RiskInfluencers, CitedNarrative, LiteratureList, ComparativeRiskMatrix,
  LabTrendCard, MedicationGrid,
};

/**
 * The clinical catalog: the basic one, plus this file's components.
 *
 * Built as a plain object of the shape the renderer consumes (`id`,
 * `components: Map`, `functions`) rather than with a `Catalog` instance, because
 * `@a2ui/lit` does not export the class — the same construction the Q3 spike uses.
 */
export function buildClinicalCatalog(basicCatalog) {
  return {
    id: CATALOG_ID,
    components: new Map([
      ...basicCatalog.components,
      ['RiskInfluencers', RiskInfluencers],
      ['CitedNarrative', CitedNarrative],
      ['LiteratureList', LiteratureList],
      ['ComparativeRiskMatrix', ComparativeRiskMatrix],
      ['LabTrendCard', LabTrendCard],
      ['MedicationGrid', MedicationGrid],
    ]),
    functions: basicCatalog.functions,
  };
}

/**
 * Render one or more envelopes into `host`, in order.
 *
 * The whole of the binding layer, and the only thing a page has to know. An
 * envelope is the fixture's `messages` array — `createSurface` then
 * `updateComponents` — so a fixture-driven demo replays surfaces with no domain
 * logic anywhere: the same call renders a pinned fixture and a live answer, which
 * is what makes the anonymous experience a replay rather than a second
 * implementation.
 *
 * Each envelope gets its own MessageProcessor, because a processor carries the
 * surface into the next message and reusing one would draw the previous surface's
 * components inside the new one.
 */
export function mountSurfaces(host, envelopes) {
  // The markdown provider must sit above the surface: the basic catalog's Text
  // renders markdown, and without it a heading shows its literal `## `.
  new ContextProvider(host, { context: Context.markdown, initialValue: renderMarkdown });

  for (const envelope of envelopes) {
    const processor = new MessageProcessor([buildClinicalCatalog(basicCatalog)]);
    processor.onSurfaceCreated((surface) => {
      const element = document.createElement('a2ui-surface');
      // Property binding, not an attribute: the surface object cannot be
      // serialised into markup, and setting it as an attribute renders nothing
      // and reports nothing.
      element.surface = surface;
      host.appendChild(element);
    });
    processor.processMessages(envelope.messages);
  }
}
