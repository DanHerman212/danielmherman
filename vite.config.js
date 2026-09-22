import { defineConfig } from 'vite';

/**
 * Bundles the console page's JavaScript. Run with `npm run build`, or
 * `npm run dev` for rebuild-on-save.
 *
 * Two entries, deliberately, and NOT one bundle with code splitting:
 *   - demo_a2ui.js    — the patient rail, thread, chips, ask
 *   - a2ui_renderer.js — the A2UI/Lit renderer, loaded on demand by the console
 *
 * The page must not contain the renderer at load, or the rail's paging code
 * waits on the whole renderer graph — which is what made the page sit behind a
 * spinner. Splitting is also avoided because it emits `import("./chunk.js")`
 * references inside the output, and collectstatic renames every file it
 * collects, so those references would 404.
 */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'static/js/bundled',
    emptyOutDir: true,
    target: 'es2022',

    // Stable names, no hash: Django's collectstatic owns cache-busting (it
    // hashes the file names and writes the manifest). Two hashing authorities
    // would be two things that can disagree.
    rollupOptions: {
      // Vite defaults this to false for application builds, which makes Rollup
      // DROP the entry's exports: the renderer bundle then runs its side effects
      // (customElements.define) but exports nothing, and the console's
      // `import(url)` gets an object with no members. The failure is a
      // TypeError at the first property access, far from the cause.
      preserveEntrySignatures: 'strict',
      input: {
        demo_a2ui: 'static/js/demo_a2ui.js',
        a2ui_renderer: 'static/js/a2ui_renderer.js',
      },
      output: { entryFileNames: '[name].js' },
    },

    // Not minified on purpose: the local dev server serves this same file, so
    // keeping it readable keeps it debuggable. Set true to minify; Django
    // gzip/brotli-compresses it on the wire either way.
    minify: false,
    sourcemap: false,
  },
});
