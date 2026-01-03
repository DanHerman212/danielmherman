# Personal Website Development Plan
## Django Website on Google Cloud Platform

---

## 🎯 Project Overview

**Purpose**: Personal content website with multiple topic sections  
**Framework**: Django (Python)  
**Hosting**: Google Cloud Platform  
**Menu Structure**: Tech | Music | Enlightenment | Resume | Services | Contact

---

## 📋 Phase 1: Environment Setup (Day 1)

### Step 1.1: Install Required Software
```bash
# Install Python 3.11+ (if not already installed)
python3 --version

# Install pip (Python package manager)
curl https://bootstrap.pypa.io/get-pip.py -o get-pip.py
python3 get-pip.py

# Install virtualenv
pip3 install virtualenv
```

### Step 1.2: Create Project Structure
```bash
# Navigate to your project directory
cd ~/Desktop/danielmherman

# Create virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate  # macOS/Linux

# Install Django
pip install django

# Create requirements.txt
pip freeze > requirements.txt
```

### Step 1.3: Initialize Django Project
```bash
# Create Django project (replace 'mysite' with your preferred name)
django-admin startproject personal_site .

# Create main app for content
python manage.py startapp content

# Test that everything works
python manage.py runserver
# Visit http://127.0.0.1:8000/ in browser
```

**Learning Goal**: Understand Django project vs app structure
- **Project**: Container for settings and configurations
- **App**: Component that does something specific (like managing content)

---

## 📋 Phase 2: Django Fundamentals (Days 2-3)

### Step 2.1: Configure Your App

**File**: `personal_site/settings.py`
```python
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'content',  # Add your app here
]

# Configure static files
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_DIRS = [BASE_DIR / 'static']

# Configure media files (for images, uploads)
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'
```

**Learning Goal**: Understand Django settings and how apps are registered

### Step 2.2: Create Database Models

**File**: `content/models.py`
```python
from django.db import models
from django.utils.text import slugify

class Category(models.Model):
    """Represents the main menu categories"""
    CATEGORY_CHOICES = [
        ('tech', 'Tech'),
        ('music', 'Music'),
        ('enlightenment', 'Enlightenment'),
        ('resume', 'Resume'),
        ('services', 'Services'),
        ('contact', 'Contact'),
    ]
    
    name = models.CharField(max_length=50, choices=CATEGORY_CHOICES, unique=True)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    
    class Meta:
        ordering = ['order']
        verbose_name_plural = 'Categories'
    
    def __str__(self):
        return self.get_name_display()


class Article(models.Model):
    """Content articles for Tech, Music, Enlightenment sections"""
    category = models.ForeignKey(Category, on_delete=models.CASCADE, related_name='articles')
    title = models.CharField(max_length=200)
    slug = models.SlugField(max_length=200, unique=True, blank=True)
    content = models.TextField()
    featured_image = models.ImageField(upload_to='articles/', blank=True, null=True)
    published_date = models.DateTimeField(auto_now_add=True)
    updated_date = models.DateTimeField(auto_now=True)
    is_published = models.BooleanField(default=True)
    
    class Meta:
        ordering = ['-published_date']
    
    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.title)
        super().save(*args, **kwargs)
    
    def __str__(self):
        return self.title


class Service(models.Model):
    """Services you offer"""
    title = models.CharField(max_length=200)
    description = models.TextField()
    icon = models.CharField(max_length=50, help_text="FontAwesome icon class")
    order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    
    class Meta:
        ordering = ['order']
    
    def __str__(self):
        return self.title


class ContactMessage(models.Model):
    """Store contact form submissions"""
    name = models.CharField(max_length=100)
    email = models.EmailField()
    subject = models.CharField(max_length=200)
    message = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    is_read = models.BooleanField(default=False)
    
    class Meta:
        ordering = ['-created_at']
    
    def __str__(self):
        return f"{self.name} - {self.subject}"
```

**Learning Goal**: Understanding Django ORM (Object-Relational Mapping)
- Models define your database structure
- Each class becomes a database table
- Fields define columns
- Relationships link data together

### Step 2.3: Create and Run Migrations
```bash
# Create migration files (instructions for database changes)
python manage.py makemigrations

# Apply migrations to database
python manage.py migrate

# Create superuser for admin access
python manage.py createsuperuser
# Follow prompts to create username/password
```

**Learning Goal**: Migrations track database schema changes over time

### Step 2.4: Register Models in Admin

**File**: `content/admin.py`
```python
from django.contrib import admin
from .models import Category, Article, Service, ContactMessage

@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ['name', 'title', 'order', 'is_active']
    list_editable = ['order', 'is_active']

@admin.register(Article)
class ArticleAdmin(admin.ModelAdmin):
    list_display = ['title', 'category', 'published_date', 'is_published']
    list_filter = ['category', 'is_published', 'published_date']
    search_fields = ['title', 'content']
    prepopulated_fields = {'slug': ('title',)}

@admin.register(Service)
class ServiceAdmin(admin.ModelAdmin):
    list_display = ['title', 'order', 'is_active']
    list_editable = ['order', 'is_active']

@admin.register(ContactMessage)
class ContactMessageAdmin(admin.ModelAdmin):
    list_display = ['name', 'email', 'subject', 'created_at', 'is_read']
    list_filter = ['is_read', 'created_at']
    readonly_fields = ['name', 'email', 'subject', 'message', 'created_at']
```

**Test Admin Interface**:
```bash
python manage.py runserver
# Visit http://127.0.0.1:8000/admin/
# Login with superuser credentials
# Add sample content for each category
```

**Learning Goal**: Django admin provides instant CRUD interface for your data

---

## 📋 Phase 3: Views and URLs (Days 4-5)

### Step 3.1: Create Views

**File**: `content/views.py`
```python
from django.shortcuts import render, get_object_or_404, redirect
from django.views.generic import ListView, DetailView, TemplateView
from django.contrib import messages
from .models import Category, Article, Service, ContactMessage

class HomeView(TemplateView):
    """Homepage view"""
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


class ResumeView(TemplateView):
    """Resume page"""
    template_name = 'content/resume.html'


class ServicesView(ListView):
    """Services page"""
    model = Service
    template_name = 'content/services.html'
    context_object_name = 'services'
    
    def get_queryset(self):
        return Service.objects.filter(is_active=True)


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
            messages.error(request, 'Please fill out all fields.')
        
        return render(request, self.template_name)
```

**Learning Goal**: Views control what data is sent to templates
- Function-based views (FBV): Simple, explicit
- Class-based views (CBV): Reusable, follow patterns

### Step 3.2: Configure URLs

**File**: `personal_site/urls.py` (Main project URLs)
```python
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', include('content.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
```

**File**: `content/urls.py` (App URLs - create this file)
```python
from django.urls import path
from . import views

urlpatterns = [
    path('', views.HomeView.as_view(), name='home'),
    path('category/<str:category>/', views.CategoryView.as_view(), name='category'),
    path('article/<slug:slug>/', views.ArticleDetailView.as_view(), name='article_detail'),
    path('resume/', views.ResumeView.as_view(), name='resume'),
    path('services/', views.ServicesView.as_view(), name='services'),
    path('contact/', views.ContactView.as_view(), name='contact'),
]
```

**Learning Goal**: URL patterns map web addresses to views

---

## 📋 Phase 4: Templates and Frontend (Days 6-8)

### Step 4.1: Create Template Structure
```bash
# Create template directories
mkdir -p content/templates/content
mkdir -p content/static/css
mkdir -p content/static/js
mkdir -p content/static/images
```

### Step 4.2: Base Template

**File**: `content/templates/content/base.html`
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{% block title %}My Personal Website{% endblock %}</title>
    
    <!-- Bootstrap CSS -->
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <!-- FontAwesome Icons -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <!-- Custom CSS -->
    {% load static %}
    <link rel="stylesheet" href="{% static 'css/style.css' %}">
    
    {% block extra_css %}{% endblock %}
</head>
<body>
    <!-- Navigation -->
    <nav class="navbar navbar-expand-lg navbar-dark bg-dark">
        <div class="container">
            <a class="navbar-brand" href="{% url 'home' %}">Your Name</a>
            <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
                <span class="navbar-toggler-icon"></span>
            </button>
            <div class="collapse navbar-collapse" id="navbarNav">
                <ul class="navbar-nav ms-auto">
                    <li class="nav-item">
                        <a class="nav-link" href="{% url 'home' %}">Home</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="{% url 'category' 'tech' %}">Tech</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="{% url 'category' 'music' %}">Music</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="{% url 'category' 'enlightenment' %}">Enlightenment</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="{% url 'resume' %}">Resume</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="{% url 'services' %}">Services</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="{% url 'contact' %}">Contact</a>
                    </li>
                </ul>
            </div>
        </div>
    </nav>

    <!-- Messages -->
    {% if messages %}
        <div class="container mt-3">
            {% for message in messages %}
                <div class="alert alert-{{ message.tags }} alert-dismissible fade show" role="alert">
                    {{ message }}
                    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
                </div>
            {% endfor %}
        </div>
    {% endif %}

    <!-- Main Content -->
    <main class="py-4">
        {% block content %}{% endblock %}
    </main>

    <!-- Footer -->
    <footer class="bg-dark text-white mt-5 py-4">
        <div class="container text-center">
            <p>&copy; 2026 Your Name. All rights reserved.</p>
            <div class="social-links">
                <a href="#" class="text-white me-3"><i class="fab fa-linkedin"></i></a>
                <a href="#" class="text-white me-3"><i class="fab fa-github"></i></a>
                <a href="#" class="text-white"><i class="fab fa-twitter"></i></a>
            </div>
        </div>
    </footer>

    <!-- Bootstrap JS -->
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    {% block extra_js %}{% endblock %}
</body>
</html>
```

### Step 4.3: Create Individual Page Templates

**File**: `content/templates/content/home.html`
```html
{% extends 'content/base.html' %}

{% block content %}
<div class="container">
    <!-- Hero Section -->
    <div class="jumbotron text-center bg-light p-5 rounded">
        <h1 class="display-4">Welcome to My Website</h1>
        <p class="lead">Explore my thoughts on Technology, Music, and Enlightenment</p>
        <a href="{% url 'contact' %}" class="btn btn-primary btn-lg">Get in Touch</a>
    </div>

    <!-- Featured Articles -->
    <div class="row mt-5">
        <h2 class="mb-4">Latest Articles</h2>
        {% for article in featured_articles %}
        <div class="col-md-4 mb-4">
            <div class="card h-100">
                {% if article.featured_image %}
                <img src="{{ article.featured_image.url }}" class="card-img-top" alt="{{ article.title }}">
                {% endif %}
                <div class="card-body">
                    <h5 class="card-title">{{ article.title }}</h5>
                    <p class="card-text">{{ article.content|truncatewords:30 }}</p>
                    <a href="{% url 'article_detail' article.slug %}" class="btn btn-primary">Read More</a>
                </div>
                <div class="card-footer text-muted">
                    {{ article.published_date|date:"F d, Y" }}
                </div>
            </div>
        </div>
        {% endfor %}
    </div>
</div>
{% endblock %}
```

**File**: `content/templates/content/category.html`
```html
{% extends 'content/base.html' %}

{% block title %}{{ category.title }} - My Website{% endblock %}

{% block content %}
<div class="container">
    <h1 class="mb-4">{{ category.title }}</h1>
    <p class="lead">{{ category.description }}</p>
    
    <div class="row">
        {% for article in articles %}
        <div class="col-md-6 mb-4">
            <div class="card">
                {% if article.featured_image %}
                <img src="{{ article.featured_image.url }}" class="card-img-top" alt="{{ article.title }}">
                {% endif %}
                <div class="card-body">
                    <h5 class="card-title">{{ article.title }}</h5>
                    <p class="card-text">{{ article.content|truncatewords:50 }}</p>
                    <a href="{% url 'article_detail' article.slug %}" class="btn btn-primary">Read More</a>
                </div>
                <div class="card-footer text-muted">
                    {{ article.published_date|date:"F d, Y" }}
                </div>
            </div>
        </div>
        {% empty %}
        <p>No articles in this category yet.</p>
        {% endfor %}
    </div>
    
    <!-- Pagination -->
    {% if is_paginated %}
    <nav>
        <ul class="pagination justify-content-center">
            {% if page_obj.has_previous %}
            <li class="page-item">
                <a class="page-link" href="?page=1">First</a>
            </li>
            <li class="page-item">
                <a class="page-link" href="?page={{ page_obj.previous_page_number }}">Previous</a>
            </li>
            {% endif %}
            
            <li class="page-item active">
                <span class="page-link">Page {{ page_obj.number }} of {{ page_obj.paginator.num_pages }}</span>
            </li>
            
            {% if page_obj.has_next %}
            <li class="page-item">
                <a class="page-link" href="?page={{ page_obj.next_page_number }}">Next</a>
            </li>
            <li class="page-item">
                <a class="page-link" href="?page={{ page_obj.paginator.num_pages }}">Last</a>
            </li>
            {% endif %}
        </ul>
    </nav>
    {% endif %}
</div>
{% endblock %}
```

**File**: `content/templates/content/article_detail.html`
```html
{% extends 'content/base.html' %}

{% block title %}{{ article.title }} - My Website{% endblock %}

{% block content %}
<div class="container">
    <article>
        <h1 class="mb-3">{{ article.title }}</h1>
        <p class="text-muted">
            Published on {{ article.published_date|date:"F d, Y" }} in 
            <a href="{% url 'category' article.category.name %}">{{ article.category.title }}</a>
        </p>
        
        {% if article.featured_image %}
        <img src="{{ article.featured_image.url }}" class="img-fluid mb-4" alt="{{ article.title }}">
        {% endif %}
        
        <div class="article-content">
            {{ article.content|linebreaks }}
        </div>
        
        <hr class="my-4">
        <a href="{% url 'category' article.category.name %}" class="btn btn-secondary">
            ← Back to {{ article.category.title }}
        </a>
    </article>
</div>
{% endblock %}
```

**File**: `content/templates/content/resume.html`
```html
{% extends 'content/base.html' %}

{% block title %}Resume - My Website{% endblock %}

{% block content %}
<div class="container">
    <h1 class="mb-4">Resume</h1>
    
    <!-- Summary -->
    <section class="mb-5">
        <h2>Professional Summary</h2>
        <p>Your professional summary goes here...</p>
    </section>
    
    <!-- Experience -->
    <section class="mb-5">
        <h2>Experience</h2>
        <div class="mb-4">
            <h4>Job Title - Company Name</h4>
            <p class="text-muted">Start Date - End Date</p>
            <ul>
                <li>Achievement or responsibility</li>
                <li>Achievement or responsibility</li>
            </ul>
        </div>
        <!-- Add more experience entries -->
    </section>
    
    <!-- Education -->
    <section class="mb-5">
        <h2>Education</h2>
        <div class="mb-4">
            <h4>Degree - Institution</h4>
            <p class="text-muted">Graduation Year</p>
        </div>
    </section>
    
    <!-- Skills -->
    <section class="mb-5">
        <h2>Skills</h2>
        <div class="row">
            <div class="col-md-6">
                <ul>
                    <li>Skill 1</li>
                    <li>Skill 2</li>
                </ul>
            </div>
            <div class="col-md-6">
                <ul>
                    <li>Skill 3</li>
                    <li>Skill 4</li>
                </ul>
            </div>
        </div>
    </section>
    
    <a href="/path/to/resume.pdf" class="btn btn-primary" download>
        <i class="fas fa-download"></i> Download PDF Resume
    </a>
</div>
{% endblock %}
```

**File**: `content/templates/content/services.html`
```html
{% extends 'content/base.html' %}

{% block title %}Services - My Website{% endblock %}

{% block content %}
<div class="container">
    <h1 class="mb-4">Services</h1>
    <p class="lead">Here's what I can help you with:</p>
    
    <div class="row mt-5">
        {% for service in services %}
        <div class="col-md-4 mb-4">
            <div class="card text-center h-100">
                <div class="card-body">
                    <i class="{{ service.icon }} fa-3x mb-3 text-primary"></i>
                    <h5 class="card-title">{{ service.title }}</h5>
                    <p class="card-text">{{ service.description }}</p>
                </div>
            </div>
        </div>
        {% endfor %}
    </div>
    
    <div class="text-center mt-5">
        <a href="{% url 'contact' %}" class="btn btn-primary btn-lg">Get in Touch</a>
    </div>
</div>
{% endblock %}
```

**File**: `content/templates/content/contact.html`
```html
{% extends 'content/base.html' %}

{% block title %}Contact - My Website{% endblock %}

{% block content %}
<div class="container">
    <h1 class="mb-4">Contact Me</h1>
    
    <div class="row">
        <div class="col-md-8">
            <form method="post">
                {% csrf_token %}
                <div class="mb-3">
                    <label for="name" class="form-label">Name</label>
                    <input type="text" class="form-control" id="name" name="name" required>
                </div>
                <div class="mb-3">
                    <label for="email" class="form-label">Email</label>
                    <input type="email" class="form-control" id="email" name="email" required>
                </div>
                <div class="mb-3">
                    <label for="subject" class="form-label">Subject</label>
                    <input type="text" class="form-control" id="subject" name="subject" required>
                </div>
                <div class="mb-3">
                    <label for="message" class="form-label">Message</label>
                    <textarea class="form-control" id="message" name="message" rows="5" required></textarea>
                </div>
                <button type="submit" class="btn btn-primary">Send Message</button>
            </form>
        </div>
        
        <div class="col-md-4">
            <h4>Get in Touch</h4>
            <p><i class="fas fa-envelope"></i> your.email@example.com</p>
            <p><i class="fas fa-phone"></i> (123) 456-7890</p>
            <p><i class="fas fa-map-marker-alt"></i> Your Location</p>
            
            <div class="mt-4">
                <h4>Connect</h4>
                <a href="#" class="btn btn-outline-primary me-2">
                    <i class="fab fa-linkedin"></i>
                </a>
                <a href="#" class="btn btn-outline-dark me-2">
                    <i class="fab fa-github"></i>
                </a>
                <a href="#" class="btn btn-outline-info">
                    <i class="fab fa-twitter"></i>
                </a>
            </div>
        </div>
    </div>
</div>
{% endblock %}
```

### Step 4.4: Custom CSS

**File**: `content/static/css/style.css`
```css
/* Custom styles */
:root {
    --primary-color: #007bff;
    --dark-color: #343a40;
}

body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
}

main {
    flex: 1;
}

.jumbotron {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
}

.card {
    transition: transform 0.3s ease;
    border: none;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}

.card:hover {
    transform: translateY(-5px);
    box-shadow: 0 5px 20px rgba(0,0,0,0.2);
}

.article-content {
    font-size: 1.1rem;
    line-height: 1.8;
}

.social-links a {
    font-size: 1.5rem;
    transition: color 0.3s ease;
}

.social-links a:hover {
    color: var(--primary-color) !important;
}

footer {
    margin-top: auto;
}

/* Responsive adjustments */
@media (max-width: 768px) {
    .jumbotron h1 {
        font-size: 2rem;
    }
}
```

**Learning Goal**: Templates render HTML with dynamic data from views

---

## 📋 Phase 5: Adding Rich Content Features (Days 9-10)

### Step 5.1: Add Rich Text Editor (Optional)
```bash
pip install django-ckeditor
pip freeze > requirements.txt
```

Update `settings.py`:
```python
INSTALLED_APPS = [
    # ... other apps
    'ckeditor',
    'ckeditor_uploader',
]

CKEDITOR_UPLOAD_PATH = "uploads/"
CKEDITOR_CONFIGS = {
    'default': {
        'toolbar': 'full',
        'height': 300,
    },
}
```

Update `content/models.py`:
```python
from ckeditor.fields import RichTextField

class Article(models.Model):
    # Replace: content = models.TextField()
    content = RichTextField()
```

### Step 5.2: Add Image Handling
```bash
pip install Pillow
pip freeze > requirements.txt
```

**Learning Goal**: Extend Django with third-party packages for enhanced functionality

---

## 📋 Phase 6: Testing Locally (Day 11)

### Step 6.1: Add Sample Data via Admin
```bash
python manage.py runserver
```

1. Visit http://127.0.0.1:8000/admin/
2. Add Categories for each menu item
3. Add at least 2-3 Articles per category
4. Add Services
5. Test Contact form submission

### Step 6.2: Test All Pages
- Navigate through all menu items
- Test responsive design (resize browser)
- Submit contact form
- Click through articles
- Check pagination

**Learning Goal**: Local development and testing before deployment

---

## 📋 Phase 7: Preparing for Production (Days 12-13)

### Step 7.1: Security Settings

**File**: `personal_site/settings.py`
```python
# Keep DEBUG = True for development
# Create production settings later

# Security settings for production
SECURE_SSL_REDIRECT = False  # Set to True in production
SESSION_COOKIE_SECURE = False  # Set to True in production
CSRF_COOKIE_SECURE = False  # Set to True in production
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'

# Allowed hosts (update for production)
ALLOWED_HOSTS = ['localhost', '127.0.0.1']
```

### Step 7.2: Environment Variables

Create `.env` file (add to .gitignore):
```
SECRET_KEY=your-secret-key-here
DEBUG=True
DATABASE_URL=sqlite:///db.sqlite3
ALLOWED_HOSTS=localhost,127.0.0.1
```

Install python-decouple:
```bash
pip install python-decouple
pip freeze > requirements.txt
```

Update settings.py:
```python
from decouple import config

SECRET_KEY = config('SECRET_KEY')
DEBUG = config('DEBUG', default=False, cast=bool)
ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='').split(',')
```

### Step 7.3: Create Production Settings

**File**: `personal_site/settings_production.py`
```python
from .settings import *

DEBUG = False
ALLOWED_HOSTS = ['your-domain.com', 'www.your-domain.com']

# Database (PostgreSQL for production)
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': config('DB_NAME'),
        'USER': config('DB_USER'),
        'PASSWORD': config('DB_PASSWORD'),
        'HOST': config('DB_HOST'),
        'PORT': '5432',
    }
}

# Security
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# Static files (will be served by GCS)
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
```

### Step 7.4: Create Requirements Files
```bash
pip freeze > requirements.txt
```

Add production requirements:
```
Django==5.0
psycopg2-binary==2.9.9
gunicorn==21.2.0
whitenoise==6.6.0
python-decouple==3.8
Pillow==10.1.0
```

**Learning Goal**: Separate development and production configurations

---

## 📋 Phase 8: Google Cloud Platform Setup (Days 14-15)

### Step 8.1: Create GCP Account and Project
1. Go to https://console.cloud.google.com/
2. Create new project: "personal-website"
3. Enable billing
4. Enable required APIs:
   - Cloud SQL Admin API
   - Cloud Storage API
   - Cloud Build API
   - Cloud Run API (for deployment)

### Step 8.2: Install Google Cloud SDK
```bash
# Download and install from https://cloud.google.com/sdk/docs/install
# Or use homebrew on macOS:
brew install --cask google-cloud-sdk

# Initialize gcloud
gcloud init

# Login
gcloud auth login

# Set project
gcloud config set project YOUR_PROJECT_ID
```

### Step 8.3: Set Up Cloud SQL (PostgreSQL)
```bash
# Create PostgreSQL instance
gcloud sql instances create personal-website-db \
    --database-version=POSTGRES_14 \
    --tier=db-f1-micro \
    --region=us-central1

# Create database
gcloud sql databases create personal_site_db \
    --instance=personal-website-db

# Create user
gcloud sql users create django_user \
    --instance=personal-website-db \
    --password=YOUR_SECURE_PASSWORD

# Note the connection name
gcloud sql instances describe personal-website-db
```

### Step 8.4: Set Up Cloud Storage for Static Files
```bash
# Create bucket for static files
gsutil mb gs://YOUR_PROJECT_ID-static/

# Create bucket for media files
gsutil mb gs://YOUR_PROJECT_ID-media/

# Make buckets publicly readable (for static files)
gsutil iam ch allUsers:objectViewer gs://YOUR_PROJECT_ID-static/
```

Install Django storage backend:
```bash
pip install django-storages[google]
pip freeze > requirements.txt
```

Update production settings:
```python
# settings_production.py
INSTALLED_APPS += ['storages']

# Google Cloud Storage
GS_BUCKET_NAME = 'YOUR_PROJECT_ID-static'
GS_MEDIA_BUCKET_NAME = 'YOUR_PROJECT_ID-media'
STATICFILES_STORAGE = 'storages.backends.gcloud.GoogleCloudStorage'
DEFAULT_FILE_STORAGE = 'storages.backends.gcloud.GoogleCloudStorage'
GS_DEFAULT_ACL = 'publicRead'
```

**Learning Goal**: Cloud infrastructure setup for production deployment

---

## 📋 Phase 9: Deployment to GCP (Days 16-17)

### Step 9.1: Using Cloud Run (Recommended)

Create `Dockerfile`:
```dockerfile
FROM python:3.11-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Set work directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy project
COPY . .

# Collect static files
RUN python manage.py collectstatic --noinput

# Run gunicorn
CMD exec gunicorn --bind 0.0.0.0:$PORT --workers 2 --threads 4 personal_site.wsgi:application
```

Create `cloudbuild.yaml`:
```yaml
steps:
  # Build the container image
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'gcr.io/$PROJECT_ID/personal-website', '.']
  
  # Push the container image to Container Registry
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'gcr.io/$PROJECT_ID/personal-website']
  
  # Deploy container image to Cloud Run
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - 'run'
      - 'deploy'
      - 'personal-website'
      - '--image'
      - 'gcr.io/$PROJECT_ID/personal-website'
      - '--region'
      - 'us-central1'
      - '--platform'
      - 'managed'
      - '--allow-unauthenticated'

images:
  - 'gcr.io/$PROJECT_ID/personal-website'
```

### Step 9.2: Deploy
```bash
# Build and deploy
gcloud builds submit --config cloudbuild.yaml

# Set environment variables
gcloud run services update personal-website \
    --update-env-vars="DEBUG=False,SECRET_KEY=your-secret-key" \
    --region=us-central1

# Connect to Cloud SQL
gcloud run services update personal-website \
    --add-cloudsql-instances YOUR_PROJECT_ID:us-central1:personal-website-db \
    --region=us-central1
```

### Step 9.3: Run Migrations
```bash
# Connect to Cloud SQL proxy
cloud_sql_proxy -instances=YOUR_CONNECTION_NAME=tcp:5432 &

# Run migrations
python manage.py migrate --settings=personal_site.settings_production

# Create superuser
python manage.py createsuperuser --settings=personal_site.settings_production
```

### Step 9.4: Configure Domain (GoDaddy & GCP)

#### 1. Get DNS Records from GCP
- Go to Cloud Run console > "Manage Custom Domains"
- Add your domain (e.g., `example.com`)
- GCP will provide A Records (IPs) or CNAME records

#### 2. Configure DNS in GoDaddy
- Log in to GoDaddy > DNS Management
- Add/Edit **A Record**: Host `@`, Value `[GCP IP Address]`
- Add/Edit **CNAME Record**: Host `www`, Value `[Your domain or GCP alias]`

#### 3. Update Django Settings
- Update `ALLOWED_HOSTS` in `settings.py`:
  ```python
  ALLOWED_HOSTS = ['yourdomain.com', 'www.yourdomain.com', '127.0.0.1']
  ```
- Ensure `DEBUG = False`

**Learning Goal**: Deploy Django application to production cloud environment

---

## 📋 Phase 10: Post-Deployment (Day 18)

### Step 10.1: Set Up Monitoring
```bash
# Enable logging
gcloud logging read "resource.type=cloud_run_revision" --limit 50

# Set up alerts in GCP Console
```

### Step 10.2: Performance Optimization
- Enable CDN for static files
- Configure caching headers
- Optimize images
- Add database indexes

### Step 10.3: Backup Strategy
```bash
# Automated backups for Cloud SQL (already enabled by default)
gcloud sql backups list --instance=personal-website-db

# Create on-demand backup
gcloud sql backups create --instance=personal-website-db
```

**Learning Goal**: Production monitoring and maintenance

---

## 📋 Ongoing Maintenance

### Regular Tasks
1. **Update dependencies**: Monthly security updates
2. **Monitor costs**: Check GCP billing dashboard
3. **Check logs**: Review for errors
4. **Backup verification**: Test restore process quarterly
5. **Content updates**: Add new articles via admin panel

### Git Workflow
```bash
# Initialize git
git init
git add .
git commit -m "Initial commit"

# Create GitHub repo and push
git remote add origin YOUR_REPO_URL
git push -u origin main

# For updates
git add .
git commit -m "Describe your changes"
git push
gcloud builds submit --config cloudbuild.yaml  # Re-deploy
```

---

## 🎓 Learning Resources

### Django Documentation
- Official Tutorial: https://docs.djangoproject.com/en/stable/intro/tutorial01/
- Models: https://docs.djangoproject.com/en/stable/topics/db/models/
- Views: https://docs.djangoproject.com/en/stable/topics/http/views/
- Templates: https://docs.djangoproject.com/en/stable/topics/templates/

### Google Cloud Platform
- GCP Documentation: https://cloud.google.com/docs
- Cloud Run: https://cloud.google.com/run/docs
- Cloud SQL: https://cloud.google.com/sql/docs

### Additional Skills
- Bootstrap: https://getbootstrap.com/docs/
- Git: https://git-scm.com/doc
- PostgreSQL: https://www.postgresql.org/docs/

---

## 💡 Key Concepts Summary

1. **MTV Pattern**: Django uses Model-Template-View (similar to MVC)
   - Models: Data structure
   - Templates: Presentation
   - Views: Business logic

2. **ORM**: Object-Relational Mapping converts Python objects to database queries

3. **Migrations**: Track and version database schema changes

4. **Admin Interface**: Automatic CRUD interface for models

5. **URL Routing**: Maps web addresses to view functions

6. **Static Files**: CSS, JavaScript, images served separately

7. **Templates**: HTML with Django template language for dynamic content

8. **Deployment**: Development → Testing → Production pipeline

---

## 🚀 Quick Start Checklist

- [ ] Install Python 3.11+
- [ ] Create virtual environment
- [ ] Install Django
- [ ] Create project and app
- [ ] Define models
- [ ] Create migrations
- [ ] Build templates
- [ ] Test locally
- [ ] Set up GCP project
- [ ] Configure Cloud SQL
- [ ] Set up Cloud Storage
- [ ] Create Dockerfile
- [ ] Deploy to Cloud Run
- [ ] Configure custom domain
- [ ] Add initial content
- [ ] Monitor and maintain

---

## 📞 Next Steps

Start with **Phase 1** and work through each phase sequentially. Don't rush - understanding each concept is more important than speed. Take time to experiment and break things - that's how you learn!

Good luck with your website! 🎉
