"""The per-user profile: what the shell shows, and what a social sign-in fills.

The model is small, but it is the seam OAuth arrives through, so the fallbacks
are pinned here rather than left to the page that renders them. A blank
display_name is the normal state today, and most of these tests are about the
shell still having a name and an avatar to draw while it is blank.
"""

from django.contrib.auth.models import User
from django.test import TestCase

from .models import Profile


class ProfileTests(TestCase):
    def test_for_user_creates_the_row_once(self):
        user = User.objects.create_user('demo', password='x')
        first = Profile.for_user(user)
        second = Profile.for_user(user)
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(Profile.objects.count(), 1)

    def test_name_prefers_the_name_the_provider_gave(self):
        user = User.objects.create_user(
            'demo', password='x', first_name='Local', last_name='Name')
        profile = Profile.for_user(user)
        profile.display_name = 'Lena Ortiz'
        self.assertEqual(profile.name, 'Lena Ortiz')

    def test_name_falls_back_to_the_django_name(self):
        user = User.objects.create_user(
            'demo', password='x', first_name='Dan', last_name='Herman')
        self.assertEqual(Profile.for_user(user).name, 'Dan Herman')

    def test_name_falls_back_to_the_username(self):
        user = User.objects.create_user('danherman', password='x')
        self.assertEqual(Profile.for_user(user).name, 'danherman')

    def test_email_prefers_the_address_on_the_account(self):
        user = User.objects.create_user(
            'demo', password='x', email='lena@example.com')
        self.assertEqual(Profile.for_user(user).email, 'lena@example.com')

    def test_email_falls_back_to_the_username(self):
        """An issued account may carry no address, and the shell still needs
        something to show under the name."""
        user = User.objects.create_user('danherman', password='x')
        self.assertEqual(Profile.for_user(user).email, 'danherman')

    def test_initials_take_the_first_and_last_name(self):
        user = User.objects.create_user('demo', password='x')
        profile = Profile.for_user(user)
        profile.display_name = 'Lena Ortiz'
        self.assertEqual(profile.initials, 'LO')

    def test_initials_of_a_single_token_are_one_letter(self):
        user = User.objects.create_user('danherman', password='x')
        self.assertEqual(Profile.for_user(user).initials, 'D')

    def test_initials_are_derived_rather_than_stored(self):
        """Pinned as absent: a stored copy would be a second thing to keep in
        step with `name`, and the page only ever renders it."""
        fields = {field.name for field in Profile._meta.get_fields()}
        self.assertNotIn('initials', fields)

    def test_deleting_the_account_deletes_the_profile(self):
        user = User.objects.create_user('demo', password='x')
        Profile.for_user(user)
        user.delete()
        self.assertEqual(Profile.objects.count(), 0)
