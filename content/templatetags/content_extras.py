"""Custom template filters for content templates."""
import nh3
from django import template
from django.utils.safestring import mark_safe

register = template.Library()

# Server-side sanitization for CKEditor rich-HTML content (S6-01): the editor's
# htmlSupport config is client-side only, so this allowlist is the actual
# security boundary before |safe rendering. Everything the toolbar can produce
# is here; script/event-handler/foreign markup is stripped no matter how it got
# into the database (sourceEditing, a direct DB write, any client).
_ALLOWED_TAGS = {
    "p", "br", "hr", "blockquote",
    "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li",
    "strong", "em", "u", "s", "sup", "sub", "span", "mark",
    "a", "img", "figure", "figcaption", "oembed", "iframe",
    "pre", "code",
    "table", "thead", "tbody", "tr", "td", "th",
}
_ALLOWED_ATTRIBUTES = {
    # id: sectioning injects anchor ids on h3+ headings; class/style: CKEditor
    # font color/size/alignment. style cannot execute script; the CSP restricts
    # what a CSS url() could reach.
    "*": {"id", "class", "style"},
    "a": {"href", "title", "target", "rel"},
    "img": {"src", "alt", "width", "height", "srcset", "sizes"},
    "iframe": {"src", "width", "height", "allow", "allowfullscreen", "frameborder"},
    "oembed": {"url"},
    "td": {"colspan", "rowspan"},
    "th": {"colspan", "rowspan"},
    "ol": {"start", "type"},
}
_ALLOWED_URL_SCHEMES = {"http", "https", "mailto"}


@register.filter
def sanitize(value):
    """nh3-clean rich HTML so templates can render it without |safe risk."""
    return mark_safe(nh3.clean(
        str(value or ""),
        tags=_ALLOWED_TAGS,
        attributes=_ALLOWED_ATTRIBUTES,
        url_schemes=_ALLOWED_URL_SCHEMES,
        # rel is managed via the attribute allowlist above; nh3 forbids
        # allowlisting rel while its link_rel rewriting is active.
        link_rel=None,
    ))


@register.filter
def first_sentence(value):
    """Everything before the first period — the first sentence, no ellipsis.

    Whitespace is collapsed so a card preview renders as a single flowing line.
    If no period is present the whole (collapsed) text is returned unchanged,
    which keeps the filter idempotent: applying it once or many times yields
    the same result.

    No is_safe=True (S6-11): the filter does not escape, so it must not promise
    safeness — autoescape applies to its output like any other string.
    """
    text = " ".join(str(value).split())
    first, _sep, _rest = text.partition(".")
    return first.strip()
