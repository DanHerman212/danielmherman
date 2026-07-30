from django.contrib import admin

from .models import DemoPatient, DemoQuota


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
