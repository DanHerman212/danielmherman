"""
ASGI config for danielmherman project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/6.0/howto/deployment/asgi/
"""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'danielmherman.settings')

# Initialize the Django ASGI application early to ensure the app registry is
# populated before importing anything that touches models or settings.
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter  # noqa: E402

# Only HTTP is routed today. To add WebSockets later, import URLRouter and
# AuthMiddlewareStack from channels and add a 'websocket' key here.
application = ProtocolTypeRouter({
    'http': django_asgi_app,
})
