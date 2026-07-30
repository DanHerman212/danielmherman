# demo/urls.py
from django.urls import path

from . import views

app_name = 'demo'

urlpatterns = [
    path('', views.console, name='console'),
    path('ask/', views.ask, name='ask'),
]
