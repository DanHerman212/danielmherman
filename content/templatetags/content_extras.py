"""Custom template filters for content templates."""
from django import template

register = template.Library()


@register.filter(is_safe=True)
def first_sentence(value):
    """Everything before the first period — the first sentence, no ellipsis.

    Whitespace is collapsed so a card preview renders as a single flowing line.
    If no period is present the whole (collapsed) text is returned unchanged,
    which keeps the filter idempotent: applying it once or many times yields
    the same result.
    """
    text = " ".join(str(value).split())
    first, _sep, _rest = text.partition(".")
    return first.strip()
