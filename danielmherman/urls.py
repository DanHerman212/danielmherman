# danielmherman/urls.py
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path('admin/', admin.site.urls),
    path('ckeditor5/', include('django_ckeditor_5.urls')),
    # Login/logout only. django.contrib.auth.urls deliberately does not include
    # a signup route — demo accounts are issued, not self-registered.
    path('accounts/', include('django.contrib.auth.urls')),
    path('demo/', include('demo.urls')),
    path('', include('content.urls'))
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
