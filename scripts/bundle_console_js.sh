#!/bin/sh
# Bundle the console's JavaScript. Run from the repo root after editing
# static/js/*.js or re-vendoring the A2UI graph:
#
#     sh scripts/bundle_console_js.sh
#
# Why bundle at all: the A2UI renderer is 385 ES modules, and a browser fetches
# an unbundled module graph one dependency layer at a time — a module does not
# execute until its whole graph has arrived. That is what made the console page
# sit behind a spinner for ~10 seconds with the full patient list on screen.
#
# Why TWO entries rather than one bundle: the console entry (patient rail,
# thread, chips) must not contain the renderer, or the page is back to loading
# it up front. demo_a2ui.js pulls the renderer in with `import()` when it is
# actually needed.
#
# Why NOT --splitting (which does the same job in one invocation): splitting
# makes the console bundle contain its own `import("./chunk-xyz.js")`, and
# collectstatic renames every file it collects — that internal reference would
# 404. Two entries keep both URLs in Django's hands, both already hashed.
#
# Why the output is committed: the same reason the vendored tree is. The site
# then builds with no Node toolchain in its image or in Cloud Build. Re-run this
# script and commit the result whenever an input changes.
#
# a2ui_bundle.meta.json (repo root, gitignored) records which modules went into
# each bundle — the check that the graph has not silently grown or acquired a
# second copy of Lit.
set -e

ENTRY_CONSOLE=static/js/demo_a2ui.js
ENTRY_RENDERER=static/js/a2ui_renderer.js
OUT=static/js/bundled

rm -rf "$OUT"

npx --yes esbuild@0.25.0 \
  "$ENTRY_CONSOLE" "$ENTRY_RENDERER" \
  --bundle --format=esm --target=es2022 \
  --outdir="$OUT" --entry-names='[name]' \
  --metafile=a2ui_bundle.meta.json \
  --log-level=warning

# esbuild fails the build outright on an unresolvable specifier, and that IS the
# guard against the one silent breakage bundling can cause. The vendored modules
# import each other only by relative path, so a second copy of Lit cannot be
# pulled in from node_modules — and a second Lit would give two
# CustomElementRegistry attempts and components that never upgrade, with no
# error message anywhere. A bare specifier appearing in that tree is what would
# change that; it fails here instead.
for f in "$OUT"/*.js; do
  printf '%8d bytes  %s\n' "$(wc -c < "$f")" "$f"
done
