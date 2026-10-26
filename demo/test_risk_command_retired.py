"""The `/risk` command is retired at the proxy, and the blank-composer default with it.

The charter item (2026-10-26): `/risk` produces nothing when a patient is submitted with
an empty composer, so it should not exist. The estimate is not going anywhere — `/ehr`
carries the score beside the summary that explains it, and a bar clicked in that chart
still declares `intent="risk_driver"` — but the command that asked for the score alone
is gone from every vocabulary this side holds.

Three things have to agree, and they are three different files: the chips the console
draws (`CHIPS`), the commands the composer offers and resolves (`SLASH_COMMANDS`), and
the allowlist this proxy checks before it spends a credit (`CHIP_NAMES`). A command
removed from one and left in another is a control that refuses for no visible reason.
"""

import json

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from demo.fixtures import CHIP_NAMES, SLASH_COMMANDS, chip_buttons, offered_commands
from demo.models import DemoPatient


class RiskCommandRetiredTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('demo', password='x')
        self.client.force_login(self.user)
        DemoPatient.objects.create(
            hadm_id=90000009, display_name='Test Patient', age=63,
            sex='F', summary='63F · urgent admission', split_name='test',
        )

    def _post(self, payload):
        return self.client.post(
            reverse('demo:a2ui_ask'),
            data=json.dumps(payload),
            content_type='application/json',
        )

    # --- the three vocabularies ------------------------------------------------

    def test_no_chip_is_named_risk(self):
        self.assertNotIn('risk', CHIP_NAMES)

    def test_no_command_is_named_risk(self):
        self.assertNotIn('/risk', {'/' + entry['command'] for entry in SLASH_COMMANDS})

    def test_the_menu_never_offers_it(self):
        self.assertNotIn('/risk',
                         {'/' + entry['command'] for entry in offered_commands()})

    def test_no_starter_button_is_drawn_for_it(self):
        self.assertNotIn('risk', {button['key'] for button in chip_buttons()})

    def test_the_four_commands_remain(self):
        self.assertLessEqual(
            {'/ehr', '/labs', '/meds', '/pubmed'},
            {'/' + entry['command'] for entry in offered_commands()},
        )

    # --- what the proxy refuses ------------------------------------------------

    def test_a_risk_chip_is_refused_before_a_credit_is_spent(self):
        response = self._post({'hadm_id': 90000009, 'chip': 'risk'})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], 'unknown chip.')

    def test_a_patient_with_no_question_is_refused(self):
        """The proxy used to forward this and let the agent compose its default, and that
        default was the retired command's own question."""
        response = self._post({'hadm_id': 90000009})

        self.assertEqual(response.status_code, 400)
        self.assertIn('question', response.json()['error'].lower())
