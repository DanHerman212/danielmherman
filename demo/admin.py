from django.conf import settings
from django.contrib import admin
from django.utils.html import format_html

from .models import Conversation, DemoPatient, DemoQuota, Turn


@admin.register(DemoPatient)
class DemoPatientAdmin(admin.ModelAdmin):
    list_display = ('display_name', 'hadm_id', 'age', 'sex', 'split_name', 'summary')
    list_filter = ('sex', 'split_name')
    search_fields = ('display_name', 'hadm_id')
    readonly_fields = ('updated_at',)


@admin.register(DemoQuota)
class DemoQuotaAdmin(admin.ModelAdmin):
    list_display = ('user', 'used', 'daily_limit', 'period_start', 'updated_at')
    list_filter = ('period_start',)
    search_fields = ('user__username',)
    readonly_fields = ('updated_at',)
    # `used` stays editable: raising someone's limit or clearing a counter
    # mid-demo is the whole reason this is in the admin.


class TurnInline(admin.TabularInline):
    model = Turn
    extra = 0
    can_delete = False
    fields = ('ordinal', 'role', 'question', 'answer', 'model', 'code_revision',
              'trace_link', 'guardrail_flags', 'error', 'created_at')
    readonly_fields = fields

    def has_add_permission(self, request, obj=None):
        return False

    @admin.display(description='Langfuse trace')
    def trace_link(self, obj):
        """The run behind this answer, as a link, when there is one.

        An operator reading a stored answer and asking "what did the model
        actually do" needs to reach the run, and the trace id is the only bridge
        between the two records. Rendered as text-without-a-link when either the
        id or the configured UI is absent: a dead link in a clinical transcript
        reads as an absent record, which is a worse failure than no link at all.
        """
        if not (settings.LANGFUSE_UI_URL and obj.langfuse_trace_id):
            return '—'
        return format_html(
            '<a href="{}/trace/{}" target="_blank" rel="noopener">{}</a>',
            settings.LANGFUSE_UI_URL,
            obj.langfuse_trace_id,
            obj.langfuse_trace_id,
        )


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    """Read-only, deliberately.

    The retention policy allows an administrator to read a conversation; it does
    not invite one to edit a record of what a clinician asked and what the
    copilot answered. Deletion stays available, because removing a conversation
    on request is a different act from rewriting one.
    """

    list_display = ('id', 'user', 'patient', 'created_at', 'expires_at',
                    'turn_count')
    list_filter = ('created_at', 'expires_at')
    search_fields = ('user__username', 'patient__display_name')
    readonly_fields = ('user', 'patient', 'created_at', 'last_turn_at',
                       'expires_at', 'turn_count')
    inlines = (TurnInline,)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
