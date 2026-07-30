"""Vendor the A2UI module graph from esm.sh into static/vendor/a2ui/.

Why this exists: the render path pulls eight ES modules, and every one of them
is a live third-party fetch at page load. During the §16 spike esm.sh returned
ERR_CONNECTION_CLOSED on a cold artifact and the page did not boot. That is an
outage sitting directly in the demo you may be showing to an employer, plus the
supply-chain exposure of executing CDN-served JavaScript that can change under
you. Vendoring removes both.

The work is not just "download eight files". esm.sh modules import each other by
absolute path (`/@a2ui/web_core@0.10.5/...?target=es2022`), so the whole graph
has to be walked and every specifier rewritten to a local relative path.

Run from the repo root:

    python3 scripts/vendor_a2ui.py

Re-run it to upgrade; it rewrites the directory from scratch and prints the
import map to paste into the template. Pin versions in ROOTS — an unpinned
range would silently change what ships.
"""

import json
import re
import shutil
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urljoin

BASE = "https://esm.sh"
OUT = Path(__file__).resolve().parents[1] / "static" / "vendor" / "a2ui"

# The verified import map from BUILD_GUIDE §16a. `?external=lit,zod` is
# load-bearing: without it esm.sh bundles a private copy of Lit into each
# package, producing two CustomElementRegistry attempts and components that
# never upgrade — with no error message.
ROOTS = {
    "lit": "https://esm.sh/lit@3.2.1",
    "zod": "https://esm.sh/zod@3.25.76",
    "@lit/context": "https://esm.sh/@lit/context@1.1.6?external=lit",
    "@a2ui/markdown-it": "https://esm.sh/@a2ui/markdown-it@0.1.0",
    "@a2ui/web_core/v0_9": "https://esm.sh/@a2ui/web_core@0.10.5/v0_9?external=lit,zod",
    "@a2ui/lit/v0_9": "https://esm.sh/@a2ui/lit@0.10.2/v0_9?external=lit,zod",
}

# `?external=lit,zod` means those packages emit BARE `lit` / `zod` imports for
# the host to resolve. On the CDN an import map did that. Vendored, they have to
# be resolved here instead — and every one must land on the SAME pinned version,
# or a second copy of Lit reintroduces the duplicate-registry bug the import map
# existed to prevent.
BARE_PREFIXES = {
    "lit": "https://esm.sh/lit@3.2.1",
    "zod": "https://esm.sh/zod@3.25.76",
    "@lit/context": "https://esm.sh/@lit/context@1.1.6?external=lit",
}


def resolve(spec: str, referrer: str) -> str | None:
    """Turn any specifier into an absolute esm.sh URL, or None if unknown."""
    if spec.startswith(("http://", "https://")):
        return spec
    if spec.startswith(("/", "./", "../")):
        return urljoin(referrer, spec)

    # Bare: `lit`, `lit/decorators.js`, `zod/v3`.
    parts = spec.split("/")
    head = "/".join(parts[:2]) if spec.startswith("@") else parts[0]
    base = BARE_PREFIXES.get(head)
    if base is None:
        return None

    rest = spec[len(head):].lstrip("/")
    if not rest:
        return base
    # Keep the query (`?external=...`) while appending the subpath.
    package, _, query = base.partition("?")
    joined = f"{package}/{rest}"
    return f"{joined}?{query}" if query else joined

# Matches the specifier in `from "x"`, `import "x"` and `import("x")`. esm.sh
# ships minified output, so there is often no whitespace before the quote.
SPECIFIER = re.compile(
    r"""(?P<lead>\bfrom\s*|\bimport\s*\(?\s*)(?P<q>["'])(?P<spec>[^"']+)(?P=q)"""
)

SOURCEMAP = re.compile(r"//# sourceMappingURL=.*$", re.MULTILINE)


def local_name(url: str) -> str:
    """A flat, filesystem-safe filename for a module URL.

    Flat rather than mirroring the URL structure because esm.sh paths contain
    characters (`@`, `^`, `?`, `=`) that are awkward in nested directories, and
    a flat directory keeps every rewritten specifier a simple `./name.js`.
    """
    name = url[len(BASE):] if url.startswith(BASE) else url
    name = re.sub(r"[^A-Za-z0-9._-]", "_", name).strip("_")
    if not name.endswith(".js"):
        name += ".js"
    return name[:180]


def fetch(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "vendor-a2ui/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8")


def vendor() -> dict[str, str]:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    seen: dict[str, str] = {}
    queue = list(ROOTS.values())

    while queue:
        url = queue.pop()
        if url in seen:
            continue

        try:
            source = fetch(url)
        except Exception as exc:
            print(f"FAILED {url}\n  {type(exc).__name__}: {exc}")
            sys.exit(1)

        name = local_name(url)
        seen[url] = name

        def rewrite(match: re.Match) -> str:
            spec = match.group("spec")
            absolute = resolve(spec, url)
            if absolute is None:
                # An unrecognised bare specifier means the graph wants something
                # BARE_PREFIXES does not know about. Failing loudly beats
                # shipping a page that 404s one module at load time.
                print(f"UNRESOLVED bare specifier {spec!r} in {url}")
                sys.exit(1)
            if absolute not in seen and absolute not in queue:
                queue.append(absolute)
            return f'{match.group("lead")}{match.group("q")}./{local_name(absolute)}{match.group("q")}'

        rewritten = SPECIFIER.sub(rewrite, source)
        # The map files are not vendored, so keeping the comment would mean a
        # 404 in the console on every page load.
        rewritten = SOURCEMAP.sub("", rewritten)
        (OUT / name).write_text(rewritten, encoding="utf-8")

    return seen


def main() -> None:
    seen = vendor()

    # No import map is emitted, and that is deliberate: every specifier in the
    # graph was rewritten to a relative path, so the page imports these entry
    # files by URL and no name resolution happens in the browser at all. One
    # fewer mechanism to get wrong, and the duplicate-Lit failure becomes
    # impossible rather than merely prevented.
    entries = {bare: f"/static/vendor/a2ui/{seen[url]}" for bare, url in ROOTS.items()}

    total = sum(f.stat().st_size for f in OUT.glob("*.js"))
    print(f"vendored {len(seen)} modules, {total / 1024:.0f} KB -> {OUT}")
    print("\nentry points:\n")
    print(json.dumps(entries, indent=2))


if __name__ == "__main__":
    main()
