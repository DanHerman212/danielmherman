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

from demo.fixtures import CHIP_NAMES, CHIPS, SLASH_COMMANDS, chip_buttons, offered_commands

_ECC_ROOT = Path(__file__).resolve().parents[2] / 'enterprise_clinical_copilot'


def _agent_chip_questions():
    """The agent's chip table, or None when the sibling repository is absent."""
    if not (_ECC_ROOT / 'services' / 'agent' / 'routing' / 'routing.py').is_file():
        return None
    if str(_ECC_ROOT) not in sys.path:
        sys.path.insert(0, str(_ECC_ROOT))
    from services.agent.routing.routing import CHIP_QUESTIONS

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


class SlashCommandTests(SimpleTestCase):
    """The composer's command menu, and the intents it names.

    A command is a second vocabulary for the same intents: what a clinician types
    (`/ehr`) and what the agent is sent (`summarize`) need not match. But every
    intent named here must be one the agent defines, or the menu offers a command
    that is refused the moment someone uses it.
    """

    def test_every_command_names_a_real_intent(self):
        for entry in SLASH_COMMANDS:
            with self.subTest(command=entry['command']):
                self.assertIn(entry['chip'], CHIP_NAMES)

    def test_the_commands_are_distinct(self):
        names = [entry['command'] for entry in SLASH_COMMANDS]
        self.assertEqual(len(names), len(set(names)))

    def test_every_command_is_typeable_and_described(self):
        """The name has to survive the composer's own pattern, which accepts a
        slash and then letters and nothing else."""
        for entry in SLASH_COMMANDS:
            with self.subTest(command=entry['command']):
                self.assertRegex(entry['command'], r'^[a-zA-Z]+$')
                self.assertTrue(entry['description'].strip())

    def test_the_risk_command_is_gone_from_the_menu_and_from_the_vocabulary(self):
        """Phase 1.1 §3 (2026-10-16) hid `/risk`; 2026-10-26 deleted it.

        `/ehr` carries the score and its drivers, so a separate control for the same
        number was one more thing to keep in step — and the command it left behind
        produced nothing at all when a patient was submitted with a blank composer,
        because that blank submission WAS the command. Hiding a control and deleting a
        capability are different acts, and this one was asked for: a typed `/risk` now
        reaches the agent as text and is refused by name.

        `/labs` joined the OFFERED list in Phase 4B, which is the other half of the same
        rule rather than a reversal of it: `/risk` left because `/ehr` swallowed its
        answer, while `/labs` entered because the capability had no bar entry at all.
        """
        self.assertNotIn('risk', [entry['command'] for entry in SLASH_COMMANDS])
        self.assertNotIn('risk', CHIP_NAMES,
                         'the proxy would accept an intent no console draws')
        self.assertEqual([entry['command'] for entry in offered_commands()],
                         ['meds', 'ehr', 'labs', 'pubmed'])

        # A hidden alias resolves to a real intent when typed, which is the whole point
        # of having it: the menu stays at four macros and a clinician's `/drugs` still
        # lands on the medication list instead of a dead end.
        for alias in ('drugs', 'drug'):
            entry = next(e for e in SLASH_COMMANDS if e['command'] == alias)
            self.assertEqual(entry['chip'], 'meds')
            self.assertIn(entry['chip'], CHIP_NAMES)


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
