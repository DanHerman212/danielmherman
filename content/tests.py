from django.test import TestCase

from .sectioning import decorate_sections, split_sections
from .templatetags.content_extras import first_sentence, sanitize

LONGFORM_CONTENT = """
<p>intro</p>
<h2>Project Overview</h2>
<p>overview body</p>
<h2>Architecture</h2>
<p>arch body</p>
<h2>Agent Evaluation</h2>
<p>eval intro</p>
<h3>Evaluation Methodology: LLM-as-a-Judge</h3>
<p>method body</p>
<h3>Scoring Rubric</h3>
<h4>Faithfulness</h4>
<p>faithfulness body</p>
<h4>Groundedness</h4>
<p>groundedness body</p>
<h3>Results</h3>
<p>results body</p>
"""


class SectioningTests(TestCase):
    """Option 1 (2026-08-18): h2 = section cards, h3+ = in-page TOC anchors.

    A long-form section (e.g. Agent Evaluation) must NOT turn its sub-headings
    into sibling cards. They stay inside the section body with id anchors and
    drive a per-section table of contents.
    """

    def test_only_h2_becomes_sections(self):
        titles = [s["title"] for s in split_sections(LONGFORM_CONTENT)]
        self.assertEqual(titles, ["Project Overview", "Architecture",
                                  "Agent Evaluation"])

    def test_subheadings_build_nested_toc(self):
        eval_sec = split_sections(LONGFORM_CONTENT)[2]
        top = [t["title"] for t in eval_sec["toc"]]
        self.assertEqual(top, ["Evaluation Methodology: LLM-as-a-Judge",
                               "Scoring Rubric", "Results"])
        rubric = eval_sec["toc"][1]
        self.assertEqual(
            [c["title"] for c in rubric["children"]],
            ["Faithfulness", "Groundedness"],
        )
        # a plain h3 has no children
        self.assertEqual(eval_sec["toc"][0]["children"], [])

    def test_subheadings_injected_with_stable_ids(self):
        body = split_sections(LONGFORM_CONTENT)[2]["body"]
        self.assertIn('id="evaluation-methodology-llm-as-a-judge"', body)
        self.assertIn('id="faithfulness"', body)
        self.assertIn('id="groundedness"', body)
        self.assertIn('id="results"', body)

    def test_subheading_html_stays_in_body(self):
        body = split_sections(LONGFORM_CONTENT)[2]["body"]
        self.assertIn("<h3", body)
        self.assertIn("<h4", body)

    def test_decorate_adds_icon_and_overview(self):
        dec = decorate_sections(LONGFORM_CONTENT)
        eval_sec = dec[2]
        self.assertEqual(eval_sec["icon"], "fa-cogs")  # 'agent' in title
        self.assertFalse(eval_sec["is_overview"])
        self.assertEqual(len(eval_sec["toc"]), 3)

    def test_existing_heading_id_is_respected(self):
        content = ('<h2>Agent Evaluation</h2>\n'
                   '<h3 id="my-custom-anchor">Method</h3>\n<p>x</p>')
        sec = split_sections(content)[0]
        self.assertEqual(sec["body"].count("id="), 1)
        self.assertEqual(sec["toc"], [{"slug": "my-custom-anchor",
                                       "title": "Method", "children": []}])

    def test_shallow_content_has_no_toc(self):
        content = "<h2>Overview</h2><p>body</p>"
        sec = split_sections(content)[0]
        self.assertEqual(sec["toc"], [])


class SanitizeFilterTests(TestCase):
    """S6-01: the nh3 render-time sanitizer is the stored-XSS boundary."""

    def test_script_tags_are_stripped(self):
        out = sanitize('<p>hi</p><script>alert(1)</script>')
        self.assertNotIn('<script', out)
        self.assertIn('<p>hi</p>', out)

    def test_event_handlers_are_stripped(self):
        out = sanitize('<img src="/x.png" onerror="alert(1)">')
        self.assertNotIn('onerror', out)
        self.assertIn('src="/x.png"', out)

    def test_javascript_urls_are_stripped(self):
        out = sanitize('<a href="javascript:alert(1)">x</a>')
        self.assertNotIn('javascript:', out)

    def test_editor_output_survives(self):
        html = ('<h3 id="anchor" class="c" style="color:red">T</h3>'
                '<a href="https://example.com" target="_blank" rel="noopener">l</a>'
                '<figure><img src="/m.png" alt="a"></figure>')
        out = sanitize(html)
        for fragment in ('id="anchor"', 'class="c"', 'style="color:red"',
                         'href="https://example.com"', 'rel="noopener"',
                         '<figure>', 'alt="a"'):
            self.assertIn(fragment, out)

    def test_none_and_empty_are_safe(self):
        self.assertEqual(sanitize(None), "")
        self.assertEqual(sanitize(""), "")

    def test_first_sentence_output_is_not_marked_safe(self):
        # S6-11: no is_safe=True — autoescape must apply to the output.
        from django.utils.safestring import SafeString
        self.assertNotIsInstance(first_sentence("<b>x</b>. y"), SafeString)


class SectioningEscapingTests(TestCase):
    """S6-06: the sectioning round-trip must not un-escape stored entities."""

    def test_escaped_script_stays_escaped(self):
        content = ('<h2>Overview</h2>'
                   '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
        body = split_sections(content)[0]["body"]
        self.assertNotIn('<script>', body)
        self.assertIn('&lt;script&gt;', body)

    def test_attribute_quotes_are_reescaped(self):
        content = ('<h2>Overview</h2>'
                   '<p><img src="/x.png" alt="a&quot;b"></p>')
        body = split_sections(content)[0]["body"]
        self.assertIn('alt="a&quot;b"', body)

    def test_titles_are_unescaped_plain_text(self):
        secs = split_sections('<h2>AT&amp;T Deal</h2><p>x</p>'
                              '<h2>Agent Evaluation</h2>'
                              '<h3>Q&amp;A Results</h3><p>y</p>')
        self.assertEqual(secs[0]["title"], "AT&T Deal")
        self.assertEqual(secs[1]["toc"][0]["title"], "Q&A Results")


class CSPHeaderTests(TestCase):
    """S6-10 / S7-03: public pages carry the CSP; staff routes are exempt."""

    def test_public_page_has_csp_header(self):
        resp = self.client.get('/')
        policy = resp.headers.get('Content-Security-Policy', '')
        self.assertIn("default-src 'self'", policy)
        self.assertIn("object-src 'none'", policy)

    def test_nonce_is_emitted_on_pages_with_inline_scripts(self):
        # resume.html tags its inline AOS init with {{ request.csp_nonce }},
        # which also makes django-csp add the nonce to the header.
        resp = self.client.get('/resume/')
        self.assertIn('nonce-', resp.headers.get('Content-Security-Policy', ''))
        self.assertIn(b'<script nonce="', resp.content)

    def test_admin_route_is_exempt(self):
        from django.conf import settings
        resp = self.client.get(f'/{settings.ADMIN_PATH}/login/')
        self.assertNotIn('Content-Security-Policy', resp.headers)

