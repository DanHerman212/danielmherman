"""Recall: the console reading its own conversations back.

The stored shape is tested in `test_conversation_memory.py`. This is the other
half — the endpoints that hand a stored thread back to the browser, and the
scoping that keeps one account's clinical threads away from another's (Phase 3).

Offline: conversations are written directly, because what is under test is the
read path rather than the ask path that fills it.
"""

from datetime import timedelta
import json

from django.conf import settings
from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import Conversation, DemoPatient, Turn

ENVELOPE = {
    'surface_id': 'main',
    'renders_prose': True,
    'messages': [
        {'version': 'v0.9',
         'createSurface': {'surfaceId': 'main', 'catalogId': 'catalog-v1'}},
        {'version': 'v0.9',
         'updateComponents': {
             'surfaceId': 'main',
             'components': [
                 {'id': 'root', 'component': 'Column', 'children': ['risk']},
                 {'id': 'risk', 'component': 'RiskInfluencers', 'decision': 0,
                  'probability': 0.0905, 'threshold': 0.11, 'factors': []},
             ],
         }},
    ],
}


def _patient(hadm_id=90000015, name='Cynthia Petrov'):
    return DemoPatient.objects.create(
        hadm_id=hadm_id, display_name=name, age=61, sex='F',
        summary='61F', split_name='test',
    )


def _store(user, patient, *, question='What is her risk?', answer='Below threshold.',
           a2ui=None, expired=False, asked=''):
    """One stored turn, written the way `record_answer` writes it."""
    conversation = Conversation.objects.create(user=user, patient=patient)
    Turn.objects.create(conversation=conversation, ordinal=1, role=Turn.Role.USER,
                        question=question, asked=asked or question)
    Turn.objects.create(conversation=conversation, ordinal=2, role=Turn.Role.AGENT,
                        answer=answer, presentation=a2ui or {})
    Conversation.objects.filter(pk=conversation.pk).update(
        turn_count=1, last_turn_at=timezone.now(),
    )
    if expired:
        Conversation.objects.filter(pk=conversation.pk).update(
            expires_at=timezone.now() - timedelta(hours=1))
    return conversation


class ConversationRecallTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('danherman', password='x')
        self.other = User.objects.create_user('someone-else', password='x')
        self.patient = _patient()
        self.client.force_login(self.user)

    # --- one thread ----------------------------------------------------------

    def test_a_stored_thread_comes_back_as_the_blocks_the_console_draws(self):
        conversation = _store(self.user, self.patient, a2ui=ENVELOPE)

        response = self.client.get(
            reverse('demo:conversation_detail', args=[conversation.pk]))

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['conversation_id'], conversation.pk)
        self.assertEqual(body['hadm_id'], 90000015)
        self.assertEqual(body['patient'], 'Cynthia Petrov')
        self.assertEqual(body['ceiling'], settings.DEMO_CONVERSATION_TURN_CEILING)
        self.assertEqual(len(body['turns']), 1)
        # The heading the console draws, kept as the reader saw it rather than as
        # the agent was asked it. A turn heads with its command, not with the prompt
        # that command composes into.
        self.assertEqual(body['turns'][0]['asked'], 'What is her risk?')
        # The presentation is the stored one, not a recomposition: recall shows the
        # canvas the turn showed.
        self.assertEqual(body['turns'][0]['a2ui'], ENVELOPE)

    def test_a_turn_with_no_canvas_comes_back_with_no_canvas(self):
        conversation = _store(self.user, self.patient, a2ui=None)

        body = self.client.get(
            reverse('demo:conversation_detail', args=[conversation.pk])).json()

        self.assertEqual(body['turns'][0]['a2ui'], {})

    def test_the_window_end_is_reported_with_the_thread(self):
        conversation = _store(self.user, self.patient)

        body = self.client.get(
            reverse('demo:conversation_detail', args=[conversation.pk])).json()

        self.assertEqual(body['expires_at'], conversation.expires_at.isoformat())

    # --- scoping -------------------------------------------------------------

    def test_another_accounts_thread_is_absent_rather_than_forbidden(self):
        """An id is not a capability. Answering "that exists but is not yours" hands
        one account a fact about another account's activity."""
        conversation = _store(self.other, self.patient)

        response = self.client.get(
            reverse('demo:conversation_detail', args=[conversation.pk]))

        self.assertEqual(response.status_code, 404)

    def test_a_thread_is_not_reachable_without_signing_in(self):
        conversation = _store(self.user, self.patient)
        self.client.logout()

        response = self.client.get(
            reverse('demo:conversation_detail', args=[conversation.pk]))

        self.assertEqual(response.status_code, 302)
        self.assertIn('/accounts/login/', response['Location'])

    # --- the history list ----------------------------------------------------

    def test_history_lists_this_accounts_threads_and_no_others(self):
        mine = _store(self.user, self.patient)
        _store(self.other, self.patient, question='Someone else asked this')

        body = self.client.get(reverse('demo:conversation_history')).json()

        self.assertEqual([row['conversation_id'] for row in body['conversations']],
                         [mine.pk])
        row = body['conversations'][0]
        # A row is a patient, so the patient's name is the whole of what it carries.
        # The first question, the turn count and the date used to be here and are
        # not: a reader scanning for a patient reads past all three.
        self.assertEqual(row['patient'], 'Cynthia Petrov')
        self.assertFalse(row['pinned'])
        self.assertNotIn('turns', row)

    def test_an_expired_thread_is_not_offered(self):
        """The list must not offer a conversation the sweep is about to delete."""
        _store(self.user, self.patient, expired=True)
        live = _store(self.user, self.patient, question='A live question')

        body = self.client.get(reverse('demo:conversation_history')).json()

        self.assertEqual([row['conversation_id'] for row in body['conversations']],
                         [live.pk])

    def test_the_search_matches_a_question(self):
        wanted = _store(self.user, self.patient, question='What about potassium?')
        _store(self.user, self.patient, question='And her medications?')

        body = self.client.get(
            reverse('demo:conversation_history'), {'q': 'potassium'}).json()

        self.assertEqual([row['conversation_id'] for row in body['conversations']],
                         [wanted.pk])

    def test_the_search_matches_a_patient_name_and_an_admission(self):
        wanted = _store(self.user, self.patient)
        other_patient = _patient(hadm_id=90000011, name='Marcus Webb')
        _store(self.user, other_patient, question='Unrelated question')

        by_name = self.client.get(
            reverse('demo:conversation_history'), {'q': 'cynthia'}).json()
        by_id = self.client.get(
            reverse('demo:conversation_history'), {'q': '90000011'}).json()

        self.assertEqual([row['conversation_id'] for row in by_name['conversations']],
                         [wanted.pk])
        self.assertEqual([row['conversation_id'] for row in by_id['conversations']],
                         [Conversation.objects.get(patient=other_patient).pk])

    def test_a_search_that_matches_nothing_is_an_empty_list_not_an_error(self):
        _store(self.user, self.patient)

        response = self.client.get(
            reverse('demo:conversation_history'), {'q': 'zzz-nothing'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['conversations'], [])


class ThreadActionTests(TestCase):
    """Rename, pin and delete: the three things a clinician may do to a thread.

    Every one of them is scoped to the account that owns the thread, and the
    scoping is the part worth testing rather than the write. An id is not a
    capability, and "it exists but is not yours" is a fact about another account's
    activity — so a thread belonging to somebody else is answered as absent.
    """

    def setUp(self):
        self.user = User.objects.create_user('danherman', password='x')
        self.other = User.objects.create_user('someone-else', password='x')
        self.patient = _patient()
        self.conversation = _store(self.user, self.patient)
        self.client.force_login(self.user)

    def _post(self, name, pk, body):
        return self.client.post(
            reverse(f'demo:{name}', args=[pk]),
            data=json.dumps(body), content_type='application/json',
        )

    # Thread naming was here and is not. `Conversation.title` and the rename
    # endpoint were removed on 2026-10-14: the row is the patient's name in every
    # state, so a second name had nowhere to appear. The tests went with the code
    # rather than staying to describe a capability the system does not have.

    # --- pin -----------------------------------------------------------------

    def test_a_thread_can_be_pinned_and_the_pin_is_not_flipped_by_repeats(self):
        first = self._post('conversation_pin', self.conversation.pk, {'pinned': True})
        second = self._post('conversation_pin', self.conversation.pk, {'pinned': True})

        self.assertTrue(first.json()['pinned'])
        self.assertTrue(second.json()['pinned'], 'the same request, not a toggle')

    def test_a_pin_that_is_not_a_boolean_is_refused(self):
        response = self._post('conversation_pin', self.conversation.pk,
                              {'pinned': 'yes'})

        self.assertEqual(response.status_code, 400)
        self.conversation.refresh_from_db()
        self.assertFalse(self.conversation.pinned)

    def test_pinned_threads_are_offered_first(self):
        older = _store(self.user, _patient(hadm_id=90000011, name='Marcus Webb'))
        Conversation.objects.filter(pk=older.pk).update(
            last_turn_at=timezone.now())

        self._post('conversation_pin', self.conversation.pk, {'pinned': True})

        body = self.client.get(reverse('demo:conversation_history')).json()

        self.assertEqual([row['conversation_id'] for row in body['conversations']],
                         [self.conversation.pk, older.pk])

    # --- delete --------------------------------------------------------------

    def test_deleting_a_thread_removes_it_and_its_turns(self):
        """A real delete rather than a hidden flag. The retention promise is that
        this store holds a conversation for seven days; a thread the clinician has
        deleted is one they expect gone."""
        response = self._post('conversation_delete', self.conversation.pk, {})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(Conversation.objects.filter(pk=self.conversation.pk).count(), 0)
        self.assertEqual(Turn.objects.filter(conversation_id=self.conversation.pk).count(), 0)

    def test_a_deleted_thread_is_no_longer_offered(self):
        self._post('conversation_delete', self.conversation.pk, {})

        body = self.client.get(reverse('demo:conversation_history')).json()

        self.assertEqual(body['conversations'], [])

    # --- scoping -------------------------------------------------------------

    def test_another_accounts_thread_cannot_be_pinned_or_deleted(self):
        theirs = _store(self.other, self.patient)

        for name, body in (
            ('conversation_pin', {'pinned': True}),
            ('conversation_delete', {}),
        ):
            with self.subTest(action=name):
                self.assertEqual(self._post(name, theirs.pk, body).status_code, 404)

        theirs.refresh_from_db()
        self.assertFalse(theirs.pinned)

    def test_the_thread_actions_are_not_reachable_without_signing_in(self):
        self.client.logout()

        response = self._post('conversation_delete', self.conversation.pk, {})

        self.assertEqual(response.status_code, 302)
        self.assertIn('/accounts/login/', response['Location'])

    def test_a_thread_action_must_be_a_post(self):
        response = self.client.get(
            reverse('demo:conversation_delete', args=[self.conversation.pk]))

        self.assertEqual(response.status_code, 405)
