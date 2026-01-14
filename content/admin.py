# content/admin.py
from django.contrib import admin
from django_summernote.admin import SummernoteModelAdmin
from .models import Category, Article, Project, ContactMessage

@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ['name', 'title', 'order', 'is_active']
    list_editable = ['order', 'is_active']

@admin.register(Article)
class ArticleAdmin(SummernoteModelAdmin):
    summernote_fields = ('content',)
    list_display = ['title', 'category', 'published_date', 'is_published']
    list_filter = ['category', 'is_published', 'published_date']
    search_fields = ['title', 'content']
    prepopulated_fields = {'slug': ('title',)}

@admin.register(Project)
class ProjectAdmin(SummernoteModelAdmin):
    summernote_fields = ('content',)
    list_display = ['title', 'order', 'is_active']
    list_editable = ['order', 'is_active']
    prepopulated_fields = {'slug':('title',)}

@admin.register(ContactMessage)
class ContactMessageAdmin(admin.ModelAdmin):
    list_display = ['name', 'email', 'subject', 'created_at', 'is_read']
    list_filter = ['is_read', 'created_at']
    readonly_fields = ['name', 'email', 'subject', 'message', 'created_at']