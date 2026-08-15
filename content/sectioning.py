"""Split Project.content rich HTML into heading-delimited sections.

Drives drill-down project pages: the landing renders a card per section (plus
a hero section), and each section is also its own URL. Authoring is unchanged
-- headings still delimit sections, so there is nothing new to maintain in the
admin.
"""

import re
from html.parser import HTMLParser

HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
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
        if tag in HEADING_TAGS and self.in_heading is None:
            self._emit("body")
            self.in_heading = int(tag[1])
            return  # heading tag itself is dropped; inner content is buffered
        self.buf.append(self._render(tag, attrs))

    def handle_startendtag(self, tag, attrs):
        self.buf.append(self._render(tag, attrs, selfclosing=True))

    def handle_endtag(self, tag):
        if tag in HEADING_TAGS and self.in_heading == int(tag[1]):
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
    return sections


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
