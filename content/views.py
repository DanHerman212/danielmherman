# content/views.py
from typing import Any
from django.http import Http404
from django.shortcuts import render, get_object_or_404, redirect
from django.views.generic import ListView, DetailView, TemplateView
from django.contrib import messages
from django.contrib.admin.views.decorators import staff_member_required
from django.core.cache import cache
from django.utils.decorators import method_decorator
from .forms import ContactForm
from .models import Category, Article, Project, ContactMessage
from .sectioning import decorate_sections

# The blog taxonomy shown as filter chips on the Articles hub. These are the
# article categories; resume/projects/contact are separate site sections.
ARTICLE_CATEGORY_NAMES = ["tech", "music", "enlightenment"]

# Public contact-form throttle (S6-02): max valid submissions per client IP
# per hour. Behind the Cloud Run load balancer REMOTE_ADDR is the LB, so the
# client IP is read from X-Forwarded-For.
CONTACT_MAX_PER_HOUR = 5


def _client_ip(request) -> str:
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR', '')


def _contact_rate_limited(request) -> bool:
    ip = _client_ip(request)
    key = f'contact-throttle:{ip}'
    count = cache.get(key, 0)
    if count >= CONTACT_MAX_PER_HOUR:
        return True
    cache.set(key, count + 1, 3600)
    return False


def _article_categories():
    return Category.objects.filter(
        name__in=ARTICLE_CATEGORY_NAMES, is_active=True).order_by("order")

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
        context['article_categories'] = _article_categories()
        context['active'] = self.category.name
        return context


class ArticleListView(ListView):
    """All published articles — the consolidated Articles nav item.

    Filter chips on the page narrow to the existing per-category URLs, so the
    category pages stay the deep-link destination.
    """
    model = Article
    template_name = 'content/articles.html'
    context_object_name = 'articles'
    paginate_by = 10

    def get_queryset(self):
        return Article.objects.filter(
            is_published=True).order_by('-published_date')

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['article_categories'] = _article_categories()
        context['active'] = None
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
    """Project detail page.

    Drill-down projects (Project.drilldown) render the section card grid plus
    the first section as a hero, and each section lives on its own URL.
    Others keep the classic single-page linear layout.
    """
    model = Project
    template_name = 'content/project_detail.html'
    context_object_name = 'project'

    def get_queryset(self):
        # Inactive projects are not publicly served (S6-13): deactivating a
        # project in the admin retires its detail page too, not just the list.
        return Project.objects.filter(is_active=True)

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        project = self.object
        context['is_drilldown'] = project.drilldown
        if project.drilldown:
            context['sections'] = decorate_sections(project.content)
        return context


class ProjectSectionView(DetailView):
    """A single section of a drill-down project."""
    model = Project
    template_name = 'content/project_section.html'
    context_object_name = 'project'

    def get_queryset(self):
        # Same gate as ProjectDetailView (S6-13): section pages of inactive
        # projects must not stay reachable by slug.
        return Project.objects.filter(is_active=True)

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        project = self.object
        if not project.drilldown:
            raise Http404('This project does not use section pages.')
        sections = decorate_sections(project.content)
        section = next(
            (s for s in sections if s['slug'] == self.kwargs['section']), None)
        if section is None:
            raise Http404('No such section.')
        context['section'] = section
        context['sections'] = sections  # sibling nav
        return context


@method_decorator(staff_member_required, name='dispatch')
class ProjectPreviewView(DetailView):
    """Staff-only preview of a project — active or not.

    Renders the same detail template with no `is_active` filter.
    """
    model = Project
    template_name = 'content/project_detail.html'
    context_object_name = 'project'
        
    
class ContactView(TemplateView):
    """Contact page with form."""
    template_name = 'content/contact.html'

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['form'] = ContactForm()
        return context

    def post(self, request):
        # Honeypot (S6-02): a bot filling the hidden field is silently dropped.
        if request.POST.get('website'):
            return redirect('contact')

        form = ContactForm(request.POST)
        if form.is_valid():
            # Per-IP throttle (S6-02): cap submissions, drop silently so the
            # sender gets no signal (behind the Cloud Run LB, X-Forwarded-For
            # carries the client IP).
            if _contact_rate_limited(request):
                return redirect('contact')
            form.save()
            messages.success(request, 'Thank you for your message! I will get back to you soon.')
            return redirect('contact')

        # S6-03: server-side validation — re-render with errors instead of
        # crashing on PostgreSQL length limits.
        messages.error(request, 'Please correct the errors below.')
        return render(request, self.template_name, {'form': form})