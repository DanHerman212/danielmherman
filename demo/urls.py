# demo/urls.py
from django.urls import path

from . import views

app_name = 'demo'

urlpatterns = [
    path('', views.console, name='console'),
    path('ask/', views.ask, name='ask'),
    # A2UI spike — the same canvas composed as A2UI messages.
    path('a2ui/', views.a2ui_console, name='a2ui_console'),
    path('a2ui/ask/', views.a2ui_ask, name='a2ui_ask'),
]
