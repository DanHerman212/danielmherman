# content/admin.py
from django.contrib import admin
from django.urls import reverse
from django.utils.html import format_html
from .models import Category, Article, Project, ContactMessage

@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ['name', 'title', 'order', 'is_active']
    list_editable = ['order', 'is_active']

@admin.register(Article)
class ArticleAdmin(admin.ModelAdmin):
    list_display = ['title', 'category', 'published_date', 'is_published', 'preview_link']
    list_filter = ['category', 'is_published', 'published_date']
    search_fields = ['title', 'content']
    prepopulated_fields = {'slug': ('title',)}
    readonly_fields = ['preview_link']

    @admin.display(description='Preview')
    def preview_link(self, obj):
        """Staff-only link to the article preview (works for drafts)."""
        if not obj.pk:
            return '-'
        return format_html(
            '<a class="button" target="_blank" rel="noopener" href="{}">Preview</a>',
            reverse('article_preview', args=[obj.slug]),
        )

@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ['title', 'order', 'is_active', 'preview_link']
    list_editable = ['order', 'is_active']
    prepopulated_fields = {'slug': ('title',)}
    readonly_fields = ['preview_link']

    @admin.display(description='Preview')
    def preview_link(self, obj):
        """Staff-only link to the project preview (works for inactive)."""
        if not obj.pk:
            return '-'
        return format_html(
            '<a class="button" target="_blank" rel="noopener" href="{}">Preview</a>',
            reverse('project_preview', args=[obj.slug]),
        )

@admin.register(ContactMessage)
class ContactMessageAdmin(admin.ModelAdmin):
    list_display = ['name', 'email', 'subject', 'created_at', 'is_read']
    list_filter = ['is_read', 'created_at']
    readonly_fields = ['name', 'email', 'subject', 'message', 'created_at']