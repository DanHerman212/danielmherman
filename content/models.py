# content/models.py
from django.db import models
from django.utils.text import slugify
from django_ckeditor_5.fields import CKEditor5Field


def _unique_slug(model_cls, instance, base):
    """Dedupe a slug against existing rows (S6-04).

    Two rows with the same title used to slugify to the same value and collide
    on the unique constraint, 500ing on admin save. Append a -2, -3, … suffix
    until the slug is free (excluding the instance itself on update).
    """
    slug = base
    n = 1
    while model_cls.objects.filter(slug=slug).exclude(pk=instance.pk).exists():
        n += 1
        slug = f"{base}-{n}"
    return slug


class Category(models.Model):
    """Represents the main menu categories"""
    CATEGORY_CHOICES = [
            ('tech', 'Tech'),
            ('music', 'Music'),
            ('enlightenment', 'Enlightenment'),
            ('resume', 'Resume'),
            ('projects', 'Projects'),
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
        return self.get_name_display() # type: ignore

class Article(models.Model):
    """Content articles for Tech, Music, Enlightment sections"""
    category = models.ForeignKey(Category, on_delete=models.CASCADE, related_name='articles')
    title = models.CharField(max_length=200)
    slug = models.SlugField(max_length=200, unique=True, blank=True)
    content = CKEditor5Field('Content', config_name='default')
    featured_image = models.ImageField(upload_to='articles/', blank=True, null=True)
    published_date = models.DateTimeField(auto_now_add=True)
    updated_date = models.DateTimeField(auto_now=True)
    is_published = models.BooleanField(default=True)

    class Meta:
        ordering =['-published_date']

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = _unique_slug(type(self), self, slugify(self.title) or 'untitled')
        super().save(*args, **kwargs)

    def __str__(self):
        return self.title

    
class Project(models.Model):
    """data science projects I'm working on"""
    title = models.CharField(max_length=200)
    slug = models.SlugField(max_length=200, unique=True, blank=True)
    description = models.TextField(help_text="Brief description shown on project list page")
    content = CKEditor5Field('Content', config_name='default', blank=True)
    image = models.ImageField(upload_to='projects/', blank=True, null=True)
    demo_link = models.URLField(blank=True, help_text="Link to hosted UI")
    github_link = models.URLField(blank=True, help_text="Link to source code")
    technologies = models.CharField(max_length=200, help_text="e.g. Python, TensorFlow, GCO ")
    order = models.IntegerField(default=0) 
    is_active = models.BooleanField(default=True)
    drilldown = models.BooleanField(
        default=False,
        help_text="Split content into section cards + per-section pages",
    )

    class Meta:
        ordering = ['order']

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = _unique_slug(type(self), self, slugify(self.title) or 'untitled')
        super().save(*args, **kwargs)

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