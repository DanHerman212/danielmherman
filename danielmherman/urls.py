# danielmherman/urls.py
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.contrib.auth import views as auth_views
from django.urls import path, include

urlpatterns = [
    # Admin off the default path (S1-05); env-configurable via ADMIN_PATH.
    path(f'{settings.ADMIN_PATH}/', admin.site.urls),
    path('ckeditor5/', include('django_ckeditor_5.urls')),
    # Login/logout ONLY (S1-06). auth.urls also mounts password_change/reset,
    # which have no templates here (a 500 on every hit) and a password-reset
    # email path makes no sense when accounts are issued, not self-registered.
    path('accounts/login/', auth_views.LoginView.as_view(), name='login'),
    path('accounts/logout/', auth_views.LogoutView.as_view(), name='logout'),
    path('demo/', include('demo.urls')),
    path('', include('content.urls'))
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    # Serve the LIVE static/ sources (not the collected staticfiles/) so dev
    # reflects edits without re-running collectstatic (S9-07).
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATICFILES_DIRS[0])
