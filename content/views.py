# content/views.py
from typing import Any
from django.shortcuts import render, get_object_or_404, redirect
from django.views.generic import ListView, DetailView, TemplateView
from django.contrib import messages
from django.contrib.admin.views.decorators import staff_member_required
from django.utils.decorators import method_decorator
from .models import Category, Article, Project, ContactMessage

class HomeView(TemplateView):
    """Homepage View"""
    template_name = 'content/home.html'

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
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
        context = super().get_context_data(**kwargs)
        context['category'] = self.category
        return context
    
class ArticleDetailView(DetailView):
    """Individual article view"""
    model = Article
    template_name = 'content/article_detail.html'
    context_object_name = 'article'

    def get_queryset(self):
        return Article.objects.filter(is_published=True)


@method_decorator(staff_member_required, name='dispatch')
class ArticlePreviewView(DetailView):
    """Staff-only preview of an article — draft or published.

    Renders the same detail template with no `is_published` filter, so a draft
    preview is exactly the production look-and-feel before it goes live.
    """
    model = Article
    template_name = 'content/article_detail.html'
    context_object_name = 'article'
    
    
class ResumeView(TemplateView):
    """Resume page — experience rendered as an animated vertical timeline."""
    template_name = 'content/resume.html'

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['experience'] = [
            {
                'period': 'April 2024 - Present',
                'role': 'Machine Learning Engineer',
                'company': 'Data Science Consulting, LLC',
                'location': 'New York, NY',
                'bullets': [
                    'AI System Design, including agent runtime, MCP and RAG',
                    'ML System Design, including high performance model training with scalable inference',
                    'Industry expertise: high tech sales and marketing, urban transit, healthcare, ecommerce and fintech',
                ],
            },
            {
                'period': 'November 2019 - October 2022',
                'role': 'Caregiving Career Break',
                'description': 'I took a career break during the pandemic to raise my newborn daughter. During that period, I evaluated several career paths and by mid 2023, chose to pursue data science.',
            },
            {
                'period': 'August 2017 - October 2019',
                'role': 'Strategic Account Executive',
                'company': 'Intellect Design (Fintech)',
                'location': 'New York, NY',
                'bullets': [
                    'Built and executed go-to-market strategy for new customer acquisition of tier 1/2 banking segment',
                    'Developed new business pipeline with $25 total contract value (TCV)',
                    'Built and executed account based marketing strategy',
                ],
            },
            {
                'period': 'December 2014 - January 2015',
                'role': 'Enterprise Account Executive',
                'company': 'Backbase (Fintech)',
                'location': 'New York, NY',
                'bullets': [
                    'Closed 2 tier 2 bank launch customers, including Keybank and Goldman Sachs',
                    'Delivered $4.5 million in new business revenue in first 15 months',
                ],
            },
            {
                'period': 'December 2006 - October 2011',
                'role': 'Enterprise Account Executive',
                'company': 'Melbourne IT Group (Cybersecurity)',
                'location': 'New York, NY',
                'bullets': [
                    'Global sales leader, 2011 - 2012',
                    'Delivered $26 million in new business during 6 year period',
                ],
            },
        ]
        return context

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


@method_decorator(staff_member_required, name='dispatch')
class ProjectPreviewView(DetailView):
    """Staff-only preview of a project — active or not.

    Renders the same detail template with no `is_active` filter.
    """
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