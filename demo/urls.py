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
    # Conversation recall: the sidebar's thread list, one thread's stored turns,
    # and the three things a clinician may do to a thread of their own.
    path('a2ui/conversations/', views.conversation_history,
         name='conversation_history'),
    path('a2ui/conversations/<int:pk>/', views.conversation_detail,
         name='conversation_detail'),
    path('a2ui/conversations/<int:pk>/rename/', views.conversation_rename,
         name='conversation_rename'),
    path('a2ui/conversations/<int:pk>/pin/', views.conversation_pin,
         name='conversation_pin'),
    path('a2ui/conversations/<int:pk>/delete/', views.conversation_delete,
         name='conversation_delete'),
    # Demo User Guide — static, journey-structured.
    path('guide/', guide_views.guide, name='guide'),
]
