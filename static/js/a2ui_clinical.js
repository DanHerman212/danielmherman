/**
 * The Phase 2 clinical components, as one bundle entry.
 *
 * Holds no logic, like its renderer sibling: it exists so the bundler has an
 * entry to walk and so a page has one URL to import. `preserveEntrySignatures` is
 * 'strict' in vite.config.js — without it Rollup drops these exports and the
 * importing page gets an object with no members, which fails at the first property
 * access rather than here.
 *
 * Why a separate entry from `a2ui_renderer` at all: the legacy components are being
 * replaced, and keeping them in the same bundle means a clean sheet that still
 * ships the old widgets. This one carries the new set and nothing else, so it is
 * also the artifact an anonymous, fixture-driven demo can import on its own.
 */

export { MessageProcessor } from '@a2ui/web_core/v0_9';
export { basicCatalog, Context } from '@a2ui/lit/v0_9';
export { ContextProvider } from '@lit/context';
export { renderMarkdown } from '@a2ui/markdown-it';
export {
  CATALOG_ID,
  buildClinicalCatalog,
  mountSurfaces,
} from './a2ui_clinical_components.js';
