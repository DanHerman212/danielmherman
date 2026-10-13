import { defineConfig } from 'vite';

/**
 * The Phase 2 clinical bundle, built on its own.
 *
 * Separate from `vite.config.js` on purpose. The console's config has two
 * entries that both import Lit, so Rollup hoists the shared graph into a chunk
 * under `assets/` and the entry imports it by relative path. That is survivable
 * while a local server serves the source tree, but Django's collectstatic
 * renames every file it collects and rewrites only the references it knows
 * about — a relative `./assets/lit-<hash>.js` inside a collected bundle is not
 * one of them, so it 404s in production. One entry can share nothing, so one
 * entry emits one file.
 *
 * Run after the console build. It does not empty the output directory, because
 * the other build owns it; run it on its own and the console's files survive.
 *
 * The result is deliberately portable: a single self-contained file that,
 * together with a folder of JSON fixtures, is the whole of what a fixture-driven
 * page needs. That is the artifact the anonymous demo lifts.
 */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'static/js/bundled',
    // The console build empties this directory at the start of `npm run build`;
    // emptying it here would delete the console's output when this config is run
    // on its own.
    emptyOutDir: false,
    target: 'es2022',

    // One entry, so there is no shared graph for Rollup to hoist: no `assets/`
    // directory, no relative chunk import, nothing for collectstatic to rename
    // out from under us.
    rollupOptions: {
      input: 'static/js/a2ui_clinical.js',

      // Without this, Vite treats the build as an application and DROPS the
      // entry's exports — `mountSurfaces` and the catalog builder would be
      // absent from the output with no error, and the page would fail at the
      // first import.
      preserveEntrySignatures: 'strict',

      output: {
        // Stable names, no hash: Django's collectstatic is the only hashing
        // authority, and two of them can disagree.
        entryFileNames: 'a2ui_clinical.js',
        assetFileNames: 'a2ui_clinical.[ext]',
      },
    },

    // Not minified on purpose, same as the console bundle: the dev server serves
    // this file too, so readable wins over small. Django compresses on the wire.
    minify: false,
    sourcemap: false,
  },
});
