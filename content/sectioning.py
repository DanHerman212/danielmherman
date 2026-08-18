"""Split Project.content rich HTML into heading-delimited sections.

Drives drill-down project pages: the landing renders a card per section (plus
a hero section), and each section is also its own URL. Authoring is unchanged
-- headings still delimit sections, so there is nothing new to maintain in the
admin.
"""

import re
from html.parser import HTMLParser

HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
# Only this level creates a section card / section page. Deeper headings
# (h3+) are kept INSIDE the section body, get auto-injected id anchors, and
# drive an in-page table of contents. (Option 1 — 2026-08-18: the ECC project
# pages are long-form, so sub-headings must not become sibling cards.)
TOP_LEVEL = 2
_SLUG_STRIP = re.compile(r"[^a-z0-9\s-]")
_SPACES = re.compile(r"\s+")
_DASHES = re.compile(r"-+")
_TAG = re.compile(r"<[^>]+>")

# Icon per section, matched against the heading text (fallback: arrow).
SECTION_ICONS = {
    "overview": "fa-rocket",
    "architecture": "fa-sitemap",
    "rag": "fa-database",
    "machine": "fa-brain",
    "learning": "fa-brain",
    "agent": "fa-cogs",
    "harness": "fa-cogs",
    "interface": "fa-desktop",
    "ui": "fa-desktop",
    "demo": "fa-play-circle",
}


def section_slug(title: str) -> str:
    """Match the client-side anchor id scheme so deep links stay stable."""
    s = _SPACES.sub("-", _SLUG_STRIP.sub("", title.lower()).strip())
    return _DASHES.sub("-", s)[:50]


def icon_for(title: str) -> str:
    t = title.lower()
    for key, icon in SECTION_ICONS.items():
        if key in t:
            return icon
    return "fa-arrow-right"


def strip_tags(html: str) -> str:
    return _TAG.sub("", html or "")


class _Splitter(HTMLParser):
    """Splits HTML on top-level heading tags, preserving everything else."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []          # [{'kind': 'heading'|'body', 'level', 'html'}]
        self.buf = []
        self.in_heading = None   # heading level while inside a heading element

    def _emit(self, kind, level=None):
        if self.buf:
            html = "".join(self.buf)
            self.buf = []
            if kind == "body":
                html = html.replace("[TOC]", "")
            self.parts.append({"kind": kind, "level": level, "html": html})

    def handle_starttag(self, tag, attrs):
        # Only TOP_LEVEL headings split a new section. Sub-headings (h3+)
        # are buffered as ordinary body content so they stay inside the
        # current section and can carry in-page anchors.
        if tag == f"h{TOP_LEVEL}" and self.in_heading is None:
            self._emit("body")
            self.in_heading = TOP_LEVEL
            return  # heading tag itself is dropped; inner content is buffered
        self.buf.append(self._render(tag, attrs))

    def handle_startendtag(self, tag, attrs):
        self.buf.append(self._render(tag, attrs, selfclosing=True))

    def handle_endtag(self, tag):
        if tag == f"h{TOP_LEVEL}" and self.in_heading == TOP_LEVEL:
            self._emit("heading", level=self.in_heading)
            self.in_heading = None
            return
        self.buf.append(f"</{tag}>")

    def handle_data(self, data):
        self.buf.append(data)

    @staticmethod
    def _render(tag, attrs, selfclosing=False):
        attr_html = "".join(
            f' {k}="{v}"' if v is not None else f" {k}" for k, v in attrs
        )
        return f"<{tag}{attr_html}{' /' if selfclosing else ''}>"


def split_sections(content_html: str) -> list:
    """Return [{level, title, slug, body}] for each heading in the content."""
    if not content_html:
        return []
    parser = _Splitter()
    parser.feed(content_html or "")
    parser.close()
    parser._emit("body")  # trailing body after the last heading

    sections = []
    pending = None
    for part in parser.parts:
        if part["kind"] == "heading":
            if pending is not None:
                sections.append(pending)
            title = strip_tags(part["html"]).replace("\xa0", " ").strip() or "Section"
            pending = {"level": part["level"], "title": title,
                       "slug": section_slug(title), "body": ""}
        elif part["kind"] == "body" and pending is not None:
            pending["body"] += part["html"]
    if pending is not None:
        sections.append(pending)
    for sec in sections:
        _add_subheading_toc(sec)
    return sections


# h3+ heading inside a section body: used to (a) inject an in-page id anchor
# and (b) build the section's table of contents. Only matches headings that are
# NOT already carrying an id (CKEditor may emit ids on its own).
_SUB_HEADING_RE = re.compile(r"<h([3-6])([^>]*)>(.*?)</h\1>", re.S | re.I)


def _add_subheading_toc(sec: dict) -> None:
    """Inject id anchors on the section's h3+ headings and record a NESTED TOC.

    Mutates sec['body'] (adds id attrs) and sec['toc']. Structure:
        [{"slug", "title", "children": [{"slug", "title"}, ...]}, ...]
    An h3 starts a new top-level TOC entry; deeper headings (h4+) become its
    children, so the rubric dimensions nest under "Scoring Rubric & Assessment
    Criteria" instead of flattening into one long list. Anchors use the same
    section_slug scheme as section URLs. A heading that already has an id is
    left untouched but still listed under that id.
    """
    toc: list[dict] = []
    parent: dict | None = None

    def _repl(m: re.Match) -> str:
        nonlocal parent
        level, attrs, inner = m.group(1), m.group(2), m.group(3)
        title = strip_tags(inner).replace("\xa0", " ").strip() or "Section"
        existing = re.search(r'id="([^"]+)"', attrs, re.I)
        slug = existing.group(1) if existing else section_slug(title)
        if int(level) <= 3:
            parent = {"slug": slug, "title": title, "children": []}
            toc.append(parent)
        elif parent is not None:
            parent["children"].append({"slug": slug, "title": title})
        else:
            # A stray deeper heading with no preceding h3 in this section:
            # keep it as a standalone top-level entry rather than dropping it.
            toc.append({"slug": slug, "title": title, "children": []})
        if existing:
            return m.group(0)  # already anchored; leave the heading untouched
        return f"<h{level} id=\"{slug}\"{attrs}>{inner}</h{level}>"

    sec["body"] = _SUB_HEADING_RE.sub(_repl, sec["body"])
    sec["toc"] = toc


def decorate_sections(content_html: str) -> list:
    """sections + {icon, is_overview} for card rendering (landing + sibling nav).

    is_overview lets the section template keep the sidebar rail on the
    overview page while deep-dive sections expand to full width.
    """
    sections = split_sections(content_html)
    for sec in sections:
        sec["icon"] = icon_for(sec["title"])
        sec["is_overview"] = "overview" in sec["title"].lower()
    return sections
