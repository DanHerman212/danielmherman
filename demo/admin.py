from django.contrib import admin

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
              'guardrail_flags', 'error', 'created_at')
    readonly_fields = fields

    def has_add_permission(self, request, obj=None):
        return False


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
