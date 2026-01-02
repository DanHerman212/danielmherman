# content/models.py
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
        return self.get_name_display() # type: ignore

class Article(models.Model):
    """Content articles for Tech, Music, Enlightment sections"""
    category = models.ForeignKey(Category, on_delete=models.CASCADE, related_name='articles')
    title = models.CharField(max_length=200)
    slug = models.SlugField(max_length=200, unique=True, blank=True)
    content = models.TextField()
    featured_image = models.ImageField(upload_to='articles/', blank=True, null=True)
    published_date = models.DateTimeField(auto_now_add=True)
    updated_date = models.DateTimeField(auto_now=True)
    is_published = models.BooleanField(default=True)

    class Meta:
        ordering =['-published_date']

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