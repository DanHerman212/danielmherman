"""The seams between the console's islands, asserted from source.

Phase 5, 2026-10-25. `copilot_canvas.js` was one closure holding the feed, the thread
list, the TSV exporter and the citation reveal. Three of those moved out, which turns
calls that used to be free variables into a written interface — and an interface that
nothing checks is two files that agree today.

Both directions are asserted here, plus the two properties that made the split
possible: nothing on the page walks a shadow root, and the new scripts keep the
module-scope indentation this page's tests already depend on.

These read source because that is the right tool for THIS question: whether one file's
namespace still contains everything another file calls, and whether the script tags
that load them are in the order the page needs. Behaviour is tested by running the page
— `tests/js/` boots it in jsdom (`tests/js/support/page.mjs`) and drives it with
`node --test`, which is a different check and does not subsume this one: source
assertions fail on a rename or a missing namespace member, and a DOM test that never
takes the path a rename broke still passes.

Stronger than they look for that reason: every one of them fails on a rename, a missing
namespace member, or a script tag in the wrong order — the three ways this refactor
could have broken in a browser and passed CI silently.
"""

import re
from pathlib import Path

from django.test import SimpleTestCase

STATIC_JS = Path(__file__).resolve().parents[1] / 'static' / 'js'
TEMPLATE = Path(__file__).resolve().parent / 'templates' / 'demo' / 'a2ui_console.html'

CANVAS = (STATIC_JS / 'copilot_canvas.js').read_text(encoding='utf-8')
CLIPBOARD = (STATIC_JS / 'copilot_clipboard.js').read_text(encoding='utf-8')
THREADS = (STATIC_JS / 'copilot_threads.js').read_text(encoding='utf-8')
TSV = (STATIC_JS / 'copilot_tsv.js').read_text(encoding='utf-8')
COMPONENTS = (STATIC_JS / 'a2ui_clinical_components.js').read_text(encoding='utf-8')
NARRATIVE = (STATIC_JS / 'a2ui' / 'cited_narrative.js').read_text(encoding='utf-8')
SHARED = (STATIC_JS / 'a2ui' / 'shared.js').read_text(encoding='utf-8')
CONSOLE = TEMPLATE.read_text(encoding='utf-8')


def _frozen_keys(source, name):
    """The member names of a `window.NAME = Object.freeze({ ... })` literal."""
    match = re.search(
        r'window\.' + name + r'\s*=\s*Object\.freeze\(\{(.*?)\n  \}\);',
        source, re.S)
    assert match, f'window.{name} not found'
    return set(re.findall(r'^\s{4}([A-Za-z_]+):', match.group(1), re.M))


def _calls(source, handle):
    """Every `handle().member(` the source makes."""
    return set(re.findall(re.escape(handle) + r'\.([A-Za-z_]+)\(', source))


class FeedContractTests(SimpleTestCase):
    """`copilot_threads.js` may drive the feed through the namespace and nothing else."""

    def test_the_thread_module_only_calls_members_the_feed_exposes(self):
        exposed = _frozen_keys(CANVAS, 'CopilotFeed')
        called = _calls(THREADS, 'canvas()')

        self.assertTrue(called, 'the thread module calls no feed member at all')
        self.assertLessEqual(called, exposed,
                             f'not on window.CopilotFeed: {sorted(called - exposed)}')

    def test_the_canvas_only_calls_members_the_thread_module_exposes(self):
        exposed = _frozen_keys(THREADS, 'CopilotThreads')
        called = set(re.findall(
            r'window\.CopilotThreads\.([A-Za-z_]+)\(', CANVAS))

        self.assertTrue(called, 'the canvas calls no thread member at all')
        self.assertLessEqual(called, exposed,
                             f'not on window.CopilotThreads: {sorted(called - exposed)}')

    def test_the_thread_module_reads_the_feed_lazily(self):
        """It loads before the canvas, so a handle captured at load would be null.

        `canvas()` exists for exactly this and is called at every site; a cached
        `var feed = window.CopilotFeed` at the top of the file would be bind-time and
        wrong.
        """
        self.assertIn('function canvas()', THREADS)
        self.assertNotIn('var feed = window.CopilotFeed', THREADS)

    def test_the_tsv_exporter_is_a_frozen_namespace_with_two_members(self):
        self.assertEqual(_frozen_keys(TSV, 'CopilotTSV'),
                         {'percent', 'structuredRows'})
        self.assertIn('window.CopilotTSV.structuredRows(', CLIPBOARD)


class ShadowBoundaryTests(SimpleTestCase):
    """The page talks to the composed surface; it does not reach inside it."""

    def test_the_page_walks_no_shadow_root(self):
        self.assertNotIn('shadowRoot', CANVAS)
        self.assertNotIn('shadowRoot', THREADS)

    def test_the_page_never_writes_a_marker_style(self):
        """The highlight is a class in the component's own stylesheet now."""
        self.assertNotIn('style.outline', CANVAS)
        self.assertNotIn('outlineOffset', CANVAS)

    def test_the_narrative_owns_the_reveal(self):
        self.assertIn('revealCitation(index)', NARRATIVE)
        self.assertIn('.cite.is-target', SHARED)
        # The timer belongs to the element that owns the marker, so a replaced
        # node cannot be left outlined by a callback that outlived it.
        self.assertIn('clearTimeout(this._revealTimer)', NARRATIVE)

    def test_the_ready_event_crosses_both_shadow_boundaries(self):
        """`composed` carries it out of the component's root, `bubbles` out of the
        surface's — without both, the turn never hears it."""
        dispatch = NARRATIVE[NARRATIVE.index('a2ui-cited-narrative-ready'):]
        dispatch = dispatch[:dispatch.index('});')]

        self.assertIn('bubbles: true', dispatch)
        self.assertIn('composed: true', dispatch)


class ScriptLoadingTests(SimpleTestCase):
    """Load order, and the indentation the other frontend tests depend on."""

    def test_the_islands_load_before_the_script_that_boots_the_page(self):
        order = re.findall(r"js/(copilot_[a-z_]+\.js)", CONSOLE)

        self.assertIn('copilot_threads.js', order)
        self.assertIn('copilot_tsv.js', order)
        self.assertEqual(order[-1], 'copilot_canvas.js',
                         f'the canvas must boot last: {order}')

    def test_the_new_scripts_use_module_scope_indentation(self):
        """Two spaces, asserted as a literal elsewhere too.

        `test_ux_restoration.py` pins `'\\n  function askFollowUp('` because a nested
        definition once threw on every click; the same convention has to hold in the
        files that took the rest of the module-scope functions.
        """
        for name, source in (('copilot_threads.js', THREADS),
                             ('copilot_tsv.js', TSV)):
            with self.subTest(script=name):
                self.assertIn('\n  function ', source)
                self.assertNotIn('\n    function ', source.split('window.')[0])
