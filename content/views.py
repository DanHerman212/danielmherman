# content/views.py
from typing import Any
from django.shortcuts import render, get_object_or_404, redirect
from django.views.generic import ListView, DetailView, TemplateView
from django.contrib import messages
from .models import Category, Article, Project, ContactMessage

class HomeView(TemplateView):
    """Homepage View"""
    template_name = 'content/home.html'

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs):
        context['categories'] = Category.objects.filter(is_active=True)
        context['featured_articles'] = Article.objects.filter(is_published=True)[:3]
        return context
    
class CategoryView(ListView):
    """List articles for a specific category"""
    model = Article
    template_name = 'content/category.html'
    context_object_name = 'articles'
    paginate_by = 10

    def get_queryset(self):
        self.category = get_object_or_404(
            Category,
            name=self.kwargs['category'],
            is_active=True
        )
        return Article.objects.filter(
            category=self.category,
            is_published=True
        )
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs):
        context['category'] = self.category
        return context
    
class ArticleDetailView(DetailView):
    """Individual article view"""
    model = Article
    template_name = 'content/article_detail.html'
    context_object_name = 'article'

    def get_queryset(self):
        return Article.objects.filter(is_published=True)
    
class ResumeView(TemplateView):
    """Resume page"""
    template_name = 'content/resume.html'

class ProjectListView(ListView):
    """Projects page"""
    model = Project
    template_name = 'content/project_list.html'
    context_object_name = 'projects'

    def get_queryset(self):
        return Project.objects.filter(is_active=True)
    
class ProjectDetailView(DetailView):
    """Project detail page"""
    model = Project
    template_name = 'content/project_detail.html'
    context_object_name = 'project'
        
    
class ContactView(TemplateView):
    """Contact page with form"""
    template_name = 'content/contact.html'

    def post(self, request):
        name = request.POST.get('name')
        email = request.POST.get('email')
        subject = request.POST.get('subject')
        message = request.POST.get('message')

        if all([name, email, subject, message]):
            ContactMessage.objects.create(
                name=name,
                email=email,
                subject=subject,
                message=message
            )
            
            messages.success(request, 'Thank you for your message! I will get back to you soon.')
            return redirect('contact')
        else:
            messages.error(request, "Please fill out all fields.")
        return render(request, self.template_name)