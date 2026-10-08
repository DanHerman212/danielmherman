"""The chip contract, held together where drift is actually introduced.

A chip is declared twice, in two repositories, and it has to be: neither production
image contains the other's code. The site's list (`demo/fixtures.py`) backs the
allowlist checked before a credit is spent and the buttons the console renders; the
agent's (`services/agent/questions.py`) backs the wording the model is asked and the
names it accepts.

Those two cannot be one list. They can, however, be *compared* — and this is the only
place they can be, because both repositories sit side by side on a development
machine and nowhere else. That is exactly where a new chip is introduced, so it is
exactly where the check belongs.

A missing sibling repository skips rather than fails. A checkout of this repository
alone is a supported state (fixture mode says so explicitly), and a test that fails
for it is a test people learn to ignore — which would leave the real drift unwatched.
"""

import sys
from pathlib import Path

from django.test import SimpleTestCase

from demo.fixtures import CHIP_NAMES, CHIPS, chip_buttons

_ECC_ROOT = Path(__file__).resolve().parents[2] / 'enterprise_clinical_copilot'


def _agent_chip_questions():
    """The agent's chip table, or None when the sibling repository is absent."""
    if not (_ECC_ROOT / 'services' / 'agent' / 'questions.py').is_file():
        return None
    if str(_ECC_ROOT) not in sys.path:
        sys.path.insert(0, str(_ECC_ROOT))
    from services.agent.questions import CHIP_QUESTIONS

    return CHIP_QUESTIONS


class ChipListTests(SimpleTestCase):
    """The site's own list, which needs no other repository to check."""

    def test_every_chip_carries_a_label_and_a_question(self):
        for name, chip in CHIPS.items():
            with self.subTest(chip=name):
                self.assertTrue(chip['label'].strip())
                self.assertTrue(chip['question'].strip())

    def test_the_label_is_not_the_wording(self):
        """A label is UI copy; the wording is the prompt.

        They read similarly by design, so the check is that they are not literally
        the same string — a distinct pair that happened to be identical would mean
        one of the two had been filled in by copying the other.
        """
        for name, chip in CHIPS.items():
            with self.subTest(chip=name):
                self.assertNotEqual(chip['label'], chip['question'])

    def test_the_buttons_are_derived_from_the_allowlist(self):
        """What the console renders and what the site accepts are one list."""
        self.assertEqual([b['key'] for b in chip_buttons()], list(CHIP_NAMES))

    def test_every_button_has_a_label_to_render(self):
        for button in chip_buttons():
            with self.subTest(chip=button['key']):
                self.assertTrue(button['label'].strip())


class ChipDriftTests(SimpleTestCase):
    """The site's list against the agent's, when both are present."""

    def setUp(self):
        self.agent = _agent_chip_questions()
        if self.agent is None:
            self.skipTest(
                'the sibling enterprise_clinical_copilot repository is not present, '
                'so there is nothing to compare against'
            )

    def test_the_agent_defines_every_chip_the_site_offers(self):
        """A chip the console offers and the agent does not define is a 400.

        The site's allowlist accepts it, so the request is sent, the credit is spent,
        and the agent refuses it as an unknown chip. The clinician sees a failure
        with nothing to explain it.
        """
        missing = sorted(set(CHIP_NAMES) - set(self.agent))

        self.assertEqual(
            missing, [],
            f'the console offers {missing}, which the agent does not define — its '
            f'CHIP_QUESTIONS would refuse them as unknown chips',
        )

    def test_the_site_carries_the_wording_the_agent_uses(self):
        """Fixture mode writes this wording into its response.

        It is not the live path's source of truth — the agent owns the prompt — but
        fixture mode claims the browser cannot tell the two paths apart, and a
        divergent sentence would be exactly how it could.
        """
        for name in sorted(set(CHIP_NAMES) & set(self.agent)):
            with self.subTest(chip=name):
                self.assertEqual(CHIPS[name]['question'], self.agent[name])

    def test_the_agent_defines_no_chip_the_console_cannot_offer(self):
        """The reverse direction, which is untidy rather than broken.

        An agent-side chip with no button is dead weight — nothing can ask for it —
        but it is not a defect the way the other direction is.
        """
        extra = sorted(set(self.agent) - set(CHIP_NAMES))

        self.assertEqual(extra, [], f'the agent defines {extra} with no console chip')
