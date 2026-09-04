# demo/urls.py
from django.urls import path

from . import views
from . import guide_views

app_name = 'demo'

urlpatterns = [
    # A2UI — the canvas composed as A2UI messages.
    path('a2ui/', views.a2ui_console, name='a2ui_console'),
    path('a2ui/ask/', views.a2ui_ask, name='a2ui_ask'),
    # Demo User Guide — static, journey-structured.
    path('guide/', guide_views.guide, name='guide'),
]
