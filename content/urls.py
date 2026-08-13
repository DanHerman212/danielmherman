# content/urls.py
from django.urls import path
from .import views

urlpatterns = [
    path('', views.HomeView.as_view(), name='home'),
    path('category/<str:category>/', views.CategoryView.as_view(), name='category'),
    path('article/<slug:slug>/preview/', views.ArticlePreviewView.as_view(), name='article_preview'),
    path('article/<slug:slug>/', views.ArticleDetailView.as_view(), name='article_detail'),
    path('resume/', views.ResumeView.as_view(), name='resume'),
    path('projects/', views.ProjectListView.as_view(), name='projects'),
    path('projects/<slug:slug>/preview/', views.ProjectPreviewView.as_view(), name='project_preview'),
    path('projects/<slug:slug>/<slug:section>/', views.ProjectSectionView.as_view(), name='project_section'),
    path('projects/<slug:slug>/', views.ProjectDetailView.as_view(), name='project_detail'),
    path('contact/', views.ContactView.as_view(), name='contact'),
]