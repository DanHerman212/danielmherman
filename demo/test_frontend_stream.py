"""The streaming and settle contract, and the gate that executes it.

Phase 5B, 2026-10-25. Two defects are fixed here and neither is visible from Python. The
draft used to be truncated at the terminal frame, and the settled surface used to replace
it in one uncompensated jump. What can be checked from this side is the part that does not
move: the two stylesheets agree about how the answer is set, the order of the three steps
in `fillTurn` is the order that makes the handover invisible, and the JavaScript gate that
drives the state machine actually runs.

That last one is why this file shells out. `demo/test_frontend_boundaries.py` asserts the
shape of the islands from source, which is what could be done when nothing in this
repository could execute browser code. `tests/js/` can now, through `node --test` and
`jsdom`, so `manage.py test` runs it — a gate nobody invokes from the standard command is
a gate that gets skipped.
"""

import re
import shutil
import subprocess
import unittest
from pathlib import Path

from django.test import SimpleTestCase

ROOT = Path(__file__).resolve().parents[1]
STATIC_JS = ROOT / 'static' / 'js'
CANVAS = (STATIC_JS / 'copilot_canvas.js').read_text(encoding='utf-8')
REVEAL = (STATIC_JS / 'copilot_reveal.js').read_text(encoding='utf-8')
DRAFT = (STATIC_JS / 'copilot_draft.js').read_text(encoding='utf-8')
COMPONENTS = (STATIC_JS / 'a2ui_clinical_components.js').read_text(encoding='utf-8')
SHELL = (ROOT / 'static' / 'css' / 'demo_shell.css').read_text(encoding='utf-8')
CONSOLE = (ROOT / 'demo' / 'templates' / 'demo' / 'a2ui_console.html').read_text(
    encoding='utf-8')


def _flat(source):
    return ' '.join(source.split())


def _declarations(source, selector):
    """The declarations of one rule, whitespace-collapsed, keyed by property."""
    match = re.search(re.escape(_flat(selector)) + r' \{([^}]*)\}', _flat(source))
    assert match, f'{selector} not found'
    found = {}
    for part in match.group(1).split(';'):
        if ':' in part:
            name, value = part.split(':', 1)
            found[name.strip()] = value.strip()
    return found


def _index(source, needle):
    position = source.find(needle)
    assert position != -1, f'{needle} not in the file'
    return position


def _function(source, signature):
    """The body of one top-level function inside the canvas's closure."""
    start = _index(source, signature)
    end = source.find('\n    }\n', start)
    assert end != -1, f'{signature} is not closed where this expected'
    return source[start:end]


def _last(source, needle):
    position = source.rfind(needle)
    assert position != -1, f'{needle} not in the file'
    return position


class DraftTypographyTests(SimpleTestCase):
    """The draft and the settled answer are set the same, so the handover moves nothing.

    These two stylesheets cannot see each other — one is a page, the other is a shadow
    root inside a bundle — so the numbers are duplicated. This is the only thing keeping
    the duplicate honest: the old draft was 1.65 leading against the narrative's 1.6, and
    the swap reflowed every paragraph of a long answer at the moment the reader finished
    it.
    """

    def test_the_body_text_is_set_identically_in_both(self):
        draft = _declarations(SHELL, '.cp-answer-text')
        narrative = _declarations(COMPONENTS, '.narrative')

        self.assertEqual(draft['font-size'], narrative['font-size'])
        self.assertEqual(draft['line-height'], narrative['line-height'])

    def test_a_heading_has_the_same_metrics_wherever_it_is_drawn(self):
        draft = _declarations(
            SHELL, '.cp-answer-text > h1, .cp-answer-text > h2, '
                   '.cp-answer-text > h3, .cp-answer-text > h4')
        narrative = _declarations(
            COMPONENTS, '.prose > h1, .prose > h2, .prose > h3, .prose > h4')

        for name in ('font-size', 'font-weight', 'line-height', 'margin'):
            self.assertEqual(draft[name], narrative[name], f'{name} differs')

    def test_a_paragraph_is_followed_by_the_same_space_in_both(self):
        draft = _declarations(
            SHELL, '.cp-answer-text > p, .cp-answer-text > ul, .cp-answer-text > ol')
        narrative = _declarations(COMPONENTS, '.prose > p')

        self.assertEqual(draft['margin'], narrative['margin'])

    def test_the_draft_draws_inert_citation_pills(self):
        # Kept deliberately: a marker is what a clinical reader scans for, and the draft
        # used to drop every one of them and give them back when the answer stopped.
        assert '.cp-cite {' in _flat(SHELL)
        self.assertIn('dashed', _declarations(SHELL, '.cp-cite')['border'])

    def test_a_finished_block_fades_in_where_it_lands(self):
        block = _declarations(SHELL, '.cp-draft-block')
        self.assertIn('cp-settle', block['animation'])

        # ...and nothing animates for a reader who asked their system not to.
        reduced = _flat(SHELL)
        assert '@media (prefers-reduced-motion: reduce) { .cp-draft-block' in reduced


class SettleOrderTests(SimpleTestCase):
    """The three steps of a settled turn, in the order that makes the handover silent.

    The old order was a wipe, then a mount, then nothing: the draft's queue was discarded
    on the first statement and the whole surface appeared on the third. What replaced it
    is a pour that finishes, a surface laid out over it at zero opacity, and a cross-fade
    with the draft emptying at the end, when nothing on screen is changing.
    """

    def test_the_draft_is_poured_before_the_surface_is_mounted(self):
        start = _index(CANVAS, 'async function fillTurn')
        end = _index(CANVAS, 'The frames of one run')
        body = CANVAS[start:end]

        self.assertLess(_index(body, 'await block.flushProse()'),
                        _index(body, 'await mountSurface'))

    def test_the_settled_answer_no_longer_wipes_the_draft(self):
        # `block.answer('')` was the truncation, and it cannot come back by accident.
        self.assertNotIn("block.answer('')", CANVAS)

    def test_the_surface_is_laid_out_before_it_is_faded_in(self):
        body = _function(CANVAS, 'function settle(surface) {')

        # Both children share one grid cell, so the two answers overlap rather than stack.
        self.assertIn("classList.add('is-settling')", body)
        self.assertLess(_index(body, 'nextFrame()'), _index(body, "remove('cp-entering')"))
        # The draft goes last, after the surface has appeared over it. Compared against
        # the LAST `resetDraft`, because the guard at the top of `settle` — the turn with
        # no surface at all — resets the draft first and that is not this step.
        self.assertLess(_index(body, "remove('cp-entering')"), _last(body, 'resetDraft()'))

    def test_the_two_children_share_one_grid_cell_while_they_cross_over(self):
        settling = _declarations(SHELL, '.cp-answer.is-settling > *')
        self.assertEqual(settling['grid-area'], '1 / 1')

    def test_the_draft_takes_no_clicks_while_it_fades(self):
        draft = _declarations(SHELL, '.cp-answer.is-settling > .cp-answer-text')
        self.assertEqual(draft['pointer-events'], 'none')


class IslandWiringTests(SimpleTestCase):
    """The new modules are loaded, in an order that works, and the old loop is gone."""

    def test_the_reveal_and_draft_modules_load_before_the_canvas(self):
        flat = _flat(CONSOLE)
        canvas = _index(flat, 'copilot_canvas.js')
        self.assertLess(_index(flat, 'copilot_reveal.js'), canvas)
        self.assertLess(_index(flat, 'copilot_draft.js'), canvas)

    def test_the_cadence_is_not_defined_in_the_canvas_any_more(self):
        self.assertNotIn('charsPerSecond', CANVAS)
        self.assertNotIn('catchUpQueue', CANVAS)
        # The table the canvas used to own, and the two properties that replaced the
        # fixed rate: a bounded lag and a cap on the opening paint.
        self.assertIn('lagMs', REVEAL)
        self.assertIn('firstPaintCap', REVEAL)

    def test_the_canvas_uses_the_two_namespaces_and_defines_neither(self):
        self.assertIn('window.CopilotReveal.create(', CANVAS)
        self.assertIn('window.CopilotDraft.partition(', CANVAS)
        self.assertIn('window.CopilotDraft.segments(', CANVAS)
        self.assertEqual(CANVAS.count('window.CopilotReveal ='), 0)
        self.assertEqual(CANVAS.count('window.CopilotDraft ='), 0)

    def test_the_page_cache_busters_moved_with_the_code(self):
        # A rebuilt bundle behind an unchanged query string is a rebuild nobody sees.
        self.assertIn("a2ui_clinical.js' %}?v=16", CONSOLE)
        self.assertIn("copilot_canvas.js' %}?v=38", CONSOLE)
        self.assertIn("copilot_threads.js' %}?v=2", CONSOLE)


class JavascriptGateTests(SimpleTestCase):
    """`npm test`, run as part of `manage.py test`.

    The state machine and the draft renderer are exercised on a virtual clock; the
    component is exercised in a DOM. Both are new in this phase, and both exist because
    the previous phase had to record that no gate executed a line of the browser code it
    shipped.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if not shutil.which('npm') or not (ROOT / 'node_modules').is_dir():
            raise unittest.SkipTest('npm or node_modules is not available')

    def test_the_javascript_suite_passes(self):
        finished = subprocess.run(  # nosec B603 B607 — fixed argv, no shell
            ['npm', 'test', '--silent'],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=180,
        )
        output = (finished.stdout or '') + (finished.stderr or '')
        self.assertEqual(finished.returncode, 0, output[-4000:])
        self.assertIn('# fail 0', output)
