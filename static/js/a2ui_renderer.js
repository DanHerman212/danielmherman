/**
 * The A2UI renderer, as one bundle entry.
 *
 * This file holds no logic. It exists so that (a) the bundler has a single
 * entry to walk, and (b) the console can pull the renderer in on demand
 * (`import(...)` in demo_a2ui.js) instead of at page load. Importing it at the
 * top is what made the patient rail wait on the whole module graph.
 *
 * The packages are ordinary npm dependencies (see package.json). This file
 * previously re-exported a hand-vendored copy of the module graph, downloaded
 * from esm.sh by scripts/vendor_a2ui.py and pinned through a custom import map;
 * both of those are gone, because a bundler resolving from node_modules makes
 * the duplicate-Lit problem they existed to work around impossible.
 */

export { MessageProcessor } from '@a2ui/web_core/v0_9';
export { basicCatalog, Context } from '@a2ui/lit/v0_9';
export { ContextProvider } from '@lit/context';
export { renderMarkdown } from '@a2ui/markdown-it';
export { buildRiskCatalog } from './a2ui_risk_components.js';
