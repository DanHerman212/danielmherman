/**
 * The A2UI renderer, as one bundle entry.
 *
 * This file holds no logic. It exists so that (a) the bundling script has a
 * single entry to walk, and (b) the console can pull the renderer in on demand
 * (`import(...)` in demo_a2ui.js) instead of at page load. Importing it at the
 * top is what made the patient rail wait on the whole module graph.
 *
 * Written in the bundler's terms, not the browser's: relative paths, and no
 * `?v=` query strings, because a bundler resolves specifiers from disk and
 * `?v=5` is not a filename. The cache-busting those queries did is now the
 * bundle filename's job (collectstatic hashes it).
 *
 * The graph beneath this file is a flat, fully relative module tree produced by
 * scripts/vendor_a2ui.py — it imports nothing by bare package name, so nothing
 * here can resolve to node_modules and pull in a second copy of Lit.
 */

export { MessageProcessor } from '../vendor/a2ui/a2ui_web_core_0.10.5_v0_9_external_lit_zod.js';
export { basicCatalog, Context } from '../vendor/a2ui/a2ui_lit_0.10.2_v0_9_external_lit_zod.js';
export { ContextProvider } from '../vendor/a2ui/lit_context_1.1.6_external_lit.js';
export { renderMarkdown } from '../vendor/a2ui/a2ui_markdown-it_0.1.0.js';
export { buildRiskCatalog } from '../vendor/a2ui/a2ui_risk_components.js';
