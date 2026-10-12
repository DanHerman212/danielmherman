# demo/urls.py
from django.urls import path

from . import views
from . import guide_views

app_name = 'demo'

urlpatterns = [
    # The public front door — no login. The project page links here.
    path('', views.landing, name='landing'),
    # A2UI — the guarded application behind the front door.
    path('a2ui/', views.a2ui_console, name='a2ui_console'),
    # The `@` selector's lookup, over the local patient table.
    path('a2ui/patients/', views.patient_autocomplete, name='patient_autocomplete'),
    path('a2ui/ask/', views.a2ui_ask, name='a2ui_ask'),
    # Demo User Guide — static, journey-structured.
    path('guide/', guide_views.guide, name='guide'),
]
