"""CSP middleware with staff-route exemptions (S6-10 / S7-03).

The public site gets the full Content-Security-Policy. The admin (at its
non-default ADMIN_PATH) and /ckeditor5/ are exempted: the Django admin and the
CKEditor 5 widget rely on inline script the policy would break, and both
routes are staff-only — the CSP's job is protecting anonymous visitors from
stored-content XSS on the public pages.
"""

from csp.middleware import CSPMiddleware
from django.conf import settings

EXEMPT_PREFIXES = (f"/{settings.ADMIN_PATH}/", "/ckeditor5/")


class PathExemptCSPMiddleware(CSPMiddleware):
    def process_response(self, request, response):
        if request.path.startswith(EXEMPT_PREFIXES):
            return response
        return super().process_response(request, response)
