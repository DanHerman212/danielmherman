"""The request this repository sends is the request the agent accepts.

Two repositories, one wire. Neither can import the other — CI builds each one on
its own runner — so the contract is kept in two places and has to be checked in
both. This file holds the checks that are true from this side:

  * every key the proxy forwards is a key this repository admits a browser to
    send, which is the internal half and runs everywhere;
  * the constants that exist in both repositories agree — the question ceiling,
    the chip vocabulary, the served tool names and the refusal vocabulary —
    which needs the sibling checkout and is skipped where there is none.

The second group is the one that would have caught the drift this file exists for:
`CORE_TOOLS` named three tools while the server served seven, so an error from a
medication or lab tool refunded nothing and read as an outage, and no test in
either repository noticed.
"""

import ast
import json
from pathlib import Path
from unittest import skipUnless
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import reverse

from .fixtures import CHIP_NAMES
from .models import DemoPatient
from .views import (
    APPROVED_REQUEST_FIELDS,
    CORE_TOOLS,
    MAX_QUESTION_CHARS,
    POLICY_REFUSALS,
    _intent_for,
    _with_replay,
)

# The sibling repository, when it is checked out beside this one. CI mounts one
# repository at a time, so every read of it is guarded rather than assumed.
SIBLING = Path(__file__).resolve().parents[2] / 'enterprise_clinical_copilot'
AGENT_CONTRACTS = SIBLING / 'services' / 'agent' / 'contracts.py'
AGENT_HTTP = SIBLING / 'services' / 'agent' / 'http.py'
AGENT_QUESTIONS = SIBLING / 'services' / 'agent' / 'questions.py'
MCP_SERVER = SIBLING / 'services' / 'mcp' / 'server.py'

HAS_SIBLING = AGENT_CONTRACTS.exists()
NO_SIBLING = 'the agent repository is not checked out beside this one'


def _assignment(path, name):
    """The value node of a top-level `name = ...` in `path`."""
    for node in ast.parse(path.read_text()).body:
        if isinstance(node, ast.Assign):
            if any(getattr(target, 'id', None) == name for target in node.targets):
                return node.value
    raise AssertionError(f'{name} not found in {path}')


def _declared_names(path, name):
    """The string members of a `name = frozenset({...})` or a dict literal.

    Read with `ast` rather than imported: these modules belong to the other
    repository and importing them would drag its import graph and its environment
    into this test run. The literal is the whole contract, so reading the literal
    is the honest check.
    """
    value = _assignment(path, name)
    if isinstance(value, ast.Call):  # frozenset({...})
        value = value.args[0]
    if isinstance(value, ast.Dict):
        return {key.value for key in value.keys if isinstance(key, ast.Constant)}
    return {
        element.value
        for element in value.elts
        if isinstance(element, ast.Constant) and isinstance(element.value, str)
    }


def _registered_tools(path):
    """The tool names a server registers, read from its own calls."""
    names = set()
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Call) and getattr(node.func, 'attr', None) == 'add_tool':
            if node.args and isinstance(node.args[0], ast.Name):
                names.add(node.args[0].id)
    return names


class ForwardedRequestTests(TestCase):
    """What leaves this repository for `/ask`, key by key."""

    def setUp(self):
        self.user = User.objects.create_user('demo', password='x')
        self.client.force_login(self.user)
        DemoPatient.objects.create(
            hadm_id=90000009, display_name='Test Patient', age=63, sex='F',
            summary='63F', split_name='test',
        )

    def _forwarded(self, payload):
        intent, error = _intent_for(payload)
        self.assertIsNone(error)
        return intent

    def test_every_intent_this_proxy_builds_is_a_body_a_browser_may_send(self):
        """A field the proxy adds and this repository does not admit is a field no
        browser could have asked for, which means the proxy invented a capability.

        The reverse — admitted and never forwarded — is `conversation_id` and
        `asked`, both consumed here, and the comment on the constant says so.
        """
        bodies = [
            {'chip': 'risk', 'hadm_id': 90000009},
            {'chip': 'risk', 'hadm_id': 90000009, 'question': 'and his meds?'},
            {'hadm_id': 90000009},
            {'question': 'What was her course?'},
            {'hadm_id': 90000009, 'question': 'Why does her RDW drive risk?',
             'intent': 'risk_driver'},
        ]

        for body in bodies:
            with self.subTest(body=sorted(body)):
                self.assertLessEqual(set(self._forwarded(body)),
                                     APPROVED_REQUEST_FIELDS)

    def test_the_replay_adds_turns_and_nothing_else(self):
        """Continuity is the one thing this side contributes to a follow-up, and it
        contributes it as structure the agent replays rather than as text it
        pastes."""
        intent = self._forwarded({'chip': 'risk', 'hadm_id': 90000009})
        earlier = [{'question': 'q', 'answer': 'a'}]

        with patch('demo.views.replay_turns', return_value=earlier):
            replayed = _with_replay(dict(intent), conversation=object())

        self.assertEqual(set(replayed) - set(intent), {'turns'})
        # `turns` is the one key the proxy forwards that a browser may not send:
        # it is this side's replay of the thread, not a capability on offer.
        self.assertLessEqual(set(replayed) - {'turns'}, APPROVED_REQUEST_FIELDS)

    @override_settings(DEMO_FIXTURE_MODE=False)
    def test_the_stream_adds_its_two_flags_and_nothing_else(self):
        """`stream_prose` and `follow_ups` are capabilities the page asks for, not
        intent, so they are merged at the last moment. Asserted on what the client
        layer was actually handed."""
        sent = []
        requested = {'chip': 'risk', 'hadm_id': 90000009}

        def fake_stream(body, trace=''):
            sent.append(dict(body))
            return iter(())

        with patch('demo.views.ask_agent_stream', side_effect=fake_stream):
            self.client.post(
                reverse('demo:a2ui_ask'),
                data=json.dumps({**requested, 'stream_prose': True,
                                 'follow_ups': True}),
                content_type='application/json',
                HTTP_ACCEPT='text/event-stream',
            )

        self.assertEqual(len(sent), 1)
        self.assertEqual(set(sent[0]) - set(requested),
                         {'stream_prose', 'follow_ups'})
        self.assertLessEqual(set(sent[0]), APPROVED_REQUEST_FIELDS)

    def test_an_unknown_field_is_refused_before_anything_is_spent(self):
        response = self.client.post(
            reverse('demo:a2ui_ask'),
            data=json.dumps({'chip': 'risk', 'hadm_id': 90000009,
                             'temperature': 0.2}),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('temperature', response.json()['error'])


class SiblingContractTests(SimpleTestCase):
    """The constants both repositories hold, checked against each other.

    Skipped when the sibling is not checked out. That is the point of the guard:
    the parity is verified wherever both repositories exist, and the suite still
    runs on a runner that has one.
    """

    @skipUnless(HAS_SIBLING, NO_SIBLING)
    def test_the_question_ceiling_is_the_same_number_in_both(self):
        ceiling = ast.literal_eval(_assignment(AGENT_HTTP, 'MAX_QUESTION_CHARS'))

        self.assertEqual(ceiling, MAX_QUESTION_CHARS)

    @skipUnless(HAS_SIBLING, NO_SIBLING)
    def test_the_chip_vocabulary_is_the_same_words_in_both(self):
        self.assertEqual(set(CHIP_NAMES),
                         _declared_names(AGENT_QUESTIONS, 'CHIP_QUESTIONS'))

    @skipUnless(HAS_SIBLING, NO_SIBLING)
    def test_every_core_tool_is_a_tool_the_server_registers(self):
        """The drift this file exists for. A core tool that is not served can never
        fail, so its absence from the outage rule is invisible."""
        self.assertLessEqual(CORE_TOOLS, _registered_tools(MCP_SERVER))

    @skipUnless(HAS_SIBLING, NO_SIBLING)
    def test_the_agent_admits_every_field_this_proxy_forwards(self):
        """`turns` is the one forwarded field a browser never sends, so it is
        admitted by the agent's request schema rather than by this repository's,
        which admits only what a browser may ask for."""
        accepted = _declared_names(AGENT_CONTRACTS, 'ACCEPTED_REQUEST_FIELDS')

        self.assertIn('turns', accepted)
        self.assertLessEqual(APPROVED_REQUEST_FIELDS - {'conversation_id', 'asked'},
                             accepted)

    @skipUnless(HAS_SIBLING, NO_SIBLING)
    def test_the_policy_refusals_are_a_subset_of_what_the_agent_can_say(self):
        spoken = {
            node.value
            for path in sorted((SIBLING / 'services' / 'agent').glob('*.py'))
            for node in ast.walk(ast.parse(path.read_text()))
            if isinstance(node, ast.Constant) and isinstance(node.value, str)
        }

        self.assertLessEqual(POLICY_REFUSALS, spoken)
