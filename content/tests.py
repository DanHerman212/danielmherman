from django.test import TestCase

from .sectioning import decorate_sections, split_sections

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

    def test_subheadings_build_toc(self):
        eval_sec = split_sections(LONGFORM_CONTENT)[2]
        self.assertEqual(
            [t["title"] for t in eval_sec["toc"]],
            ["Evaluation Methodology: LLM-as-a-Judge", "Scoring Rubric",
             "Faithfulness", "Groundedness", "Results"],
        )

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
        self.assertEqual(len(eval_sec["toc"]), 5)

    def test_existing_heading_id_is_respected(self):
        content = ('<h2>Agent Evaluation</h2>\n'
                   '<h3 id="my-custom-anchor">Method</h3>\n<p>x</p>')
        sec = split_sections(content)[0]
        self.assertEqual(sec["body"].count("id="), 1)
        self.assertEqual(sec["toc"], [{"slug": "my-custom-anchor",
                                       "title": "Method"}])

    def test_shallow_content_has_no_toc(self):
        content = "<h2>Overview</h2><p>body</p>"
        sec = split_sections(content)[0]
        self.assertEqual(sec["toc"], [])

