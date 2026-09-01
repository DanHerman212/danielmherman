"""Site-level auth-hardening tests (Cluster H).

Pins:
  * S1-05: the admin is off the default path; django-axes locks a username
    after AXES_FAILURE_LIMIT failed logins (403, even with correct creds);
  * S1-04: sessions expire when the browser closes;
  * S1-06: the password_reset/password_change routes are gone; logout works;
  * S1-12: production settings carry HSTS;
  * S6-13: inactive projects 404 on detail and section pages (in
    content/tests.py? kept here with the rest of the hardening checks —
    content/tests.py covers the sanitizer/sectioning surface).
"""

import os
import subprocess
import sys
from pathlib import Path

from axes.models import AccessAttempt
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase

from content.models import Project


class AdminPathAndAuthRoutesTests(TestCase):
    def test_admin_is_off_the_default_path(self):
        self.assertEqual(self.client.get('/admin/').status_code, 404)
        # The moved admin login page renders for anonymous visitors.
        resp = self.client.get(f'/{settings.ADMIN_PATH}/login/')
        self.assertEqual(resp.status_code, 200)

    def test_password_routes_are_not_mounted(self):
        # S1-06: no password_reset/password_change routes -> 404, not a
        # TemplateDoesNotExist 500.
        self.assertEqual(self.client.get('/accounts/password_reset/').status_code, 404)
        self.assertEqual(self.client.get('/accounts/password_change/').status_code, 404)

    def test_logout_redirects_home(self):
        User = get_user_model()
        user = User.objects.create_user(username='logout-user', password='pw')
        self.client.force_login(user)
        resp = self.client.post('/accounts/logout/')
        self.assertRedirects(resp, '/', fetch_redirect_response=False)


class SessionLifetimeTests(TestCase):
    def test_session_expires_at_browser_close(self):
        self.assertTrue(settings.SESSION_EXPIRE_AT_BROWSER_CLOSE)


class AxesLockoutTests(TestCase):
    def setUp(self):
        super().setUp()
        cache.clear()

    def tearDown(self):
        # Keep failed-attempt state out of sibling tests.
        AccessAttempt.objects.all().delete()
        cache.clear()
        super().tearDown()

    def test_login_locks_out_after_failure_limit(self):
        User = get_user_model()
        User.objects.create_user(username='axes-target', password='correct-pw')

        limit = settings.AXES_FAILURE_LIMIT
        for i in range(limit):
            resp = self.client.post('/accounts/login/', {
                'username': 'axes-target',
                'password': 'wrong-pw',
            })
            if i < limit - 1:
                self.assertEqual(resp.status_code, 200)  # form re-renders
            else:
                # The attempt that reaches the limit is itself refused.
                self.assertEqual(resp.status_code, 429)

        # Locked: even the CORRECT password is refused (axes 8 defaults the
        # lockout response to HTTP 429).
        resp = self.client.post('/accounts/login/', {
            'username': 'axes-target',
            'password': 'correct-pw',
        })
        self.assertEqual(resp.status_code, 429)
        attempt = AccessAttempt.objects.get(username='axes-target')
        # >= limit, not ==: the refused attempts while already locked still
        # count against the username.
        self.assertGreaterEqual(attempt.failures_since_start, limit)


class InactiveProjectTests(TestCase):
    """S6-13: deactivating a project retires its public URLs."""

    def setUp(self):
        super().setUp()
        self.active = Project.objects.create(
            title='Active Project', slug='active-project',
            content='<h2>Overview</h2><p>body</p>',
            drilldown=True, is_active=True,
        )
        self.inactive = Project.objects.create(
            title='Retired Project', slug='retired-project',
            content='<h2>Overview</h2><p>body</p>',
            drilldown=True, is_active=False,
        )

    def test_inactive_project_detail_is_not_served(self):
        self.assertEqual(
            self.client.get(f'/projects/{self.inactive.slug}/').status_code, 404
        )

    def test_inactive_project_section_is_not_served(self):
        self.assertEqual(
            self.client.get(f'/projects/{self.inactive.slug}/overview/').status_code,
            404,
        )

    def test_active_project_still_served(self):
        self.assertEqual(
            self.client.get(f'/projects/{self.active.slug}/').status_code, 200
        )


class ProductionSettingsTests(TestCase):
    """Load settings with ENVIRONMENT=production in a subprocess.

    The Secret Manager client is stubbed: prod settings fetch SECRET_KEY and
    the DB password from Secret Manager at import, which cannot work in CI.
    """

    def test_prod_settings_carry_hsts_and_hardening(self):
        script = (
            "import os, sys, types\n"
            "os.environ.update({\n"
            "  'ENVIRONMENT': 'production',\n"
            "  'GOOGLE_CLOUD_PROJECT': 'test-project',\n"
            "  'CLOUD_SQL_CONNECTION_NAME': 'test-project:us-east1:test-db',\n"
            "  'ALLOWED_HOSTS': 'example.com',\n"
            "  'CSRF_TRUSTED_ORIGINS': 'https://example.com',\n"
            "  'GS_BUCKET_NAME': 'test-media',\n"
            "  'DEMO_AGENT_URL': 'https://agent.example.run.app',\n"
            "})\n"
            "class _FakeClient:\n"
            "    def access_secret_version(self, request=None):\n"
            "        resp = types.SimpleNamespace()\n"
            "        resp.payload = types.SimpleNamespace(data=b's' * 64)\n"
            "        return resp\n"
            "sm = types.ModuleType('google.cloud.secretmanager')\n"
            "sm.SecretManagerServiceClient = lambda: _FakeClient()\n"
            "sys.modules['google.cloud.secretmanager'] = sm\n"
            "from django.conf import settings\n"
            "assert settings.IS_PRODUCTION\n"
            "assert settings.SECURE_HSTS_SECONDS == 2592000\n"
            "assert settings.SECURE_HSTS_INCLUDE_SUBDOMAINS is True\n"
            "assert settings.SECURE_HSTS_PRELOAD is False\n"
            "assert settings.SESSION_EXPIRE_AT_BROWSER_CLOSE is True\n"
            "assert settings.SESSION_COOKIE_SECURE is True\n"
            "assert 'axes' in settings.INSTALLED_APPS\n"
            "assert settings.CACHES['default']['BACKEND'].endswith('.DatabaseCache')\n"
            "print('PROD SETTINGS OK')\n"
        )
        env = {**os.environ, 'DJANGO_SETTINGS_MODULE': 'danielmherman.settings'}
        result = subprocess.run(
            [sys.executable, '-c', script],
            cwd=Path(__file__).resolve().parent.parent,
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
        )
        self.assertIn('PROD SETTINGS OK', result.stdout, result.stderr)
