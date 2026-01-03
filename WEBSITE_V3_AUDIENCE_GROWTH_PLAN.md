# Website Development Plan - Version 3: Audience Growth
## RSS Feeds & Email Subscriptions

---

## 🎯 Project Overview

**Goal**: Transform the website from a passive content library into an active publication by pushing updates to users.
**Key Features**:
1.  **RSS Feed**: Standard XML feed for aggregators (Feedly, etc.).
2.  **Email Newsletter**: Automated notifications when new articles are published.

---

## 📋 Phase 1: RSS Feed Implementation (Native Django)

Django has a built-in Syndication Feed Framework that makes this incredibly straightforward.

### Step 1.1: Create the Feed Class
Create a new file `content/feeds.py`.
```python
from django.contrib.syndication.views import Feed
from django.urls import reverse
from .models import Article

class LatestEntriesFeed(Feed):
    title = "Daniel Herman's Blog"
    link = "/blog/"
    description = "Updates on Tech, Music, and Enlightenment."

    def items(self):
        return Article.objects.order_by('-pub_date')[:5]

    def item_title(self, item):
        return item.title

    def item_description(self, item):
        return item.body[:100]  # Truncate for preview

    # Link to the specific article
    def item_link(self, item):
        return reverse('article_detail', args=[item.slug])
```

### Step 1.2: Map the URL
In `content/urls.py`:
```python
from .feeds import LatestEntriesFeed

urlpatterns = [
    # ... existing urls ...
    path('rss/', LatestEntriesFeed(), name='rss_feed'),
]
```

**Outcome**: Users can point their RSS readers to `yourdomain.com/rss/`.

---

## 📋 Phase 2: Email Subscription System

This requires a mix of database work, frontend forms, and backend integration.

### Step 2.1: The Subscriber Model
Create a place to store emails in `content/models.py`.
```python
class Subscriber(models.Model):
    email = models.EmailField(unique=True)
    date_joined = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=True)
    confirmation_code = models.CharField(max_length=100) # For double opt-in

    def __str__(self):
        return self.email
```

### Step 2.2: The Subscription Form
Add a simple form to your `base.html` footer or sidebar.
```html
<form action="{% url 'subscribe' %}" method="post">
    {% csrf_token %}
    <input type="email" name="email" placeholder="Enter your email">
    <button type="submit">Subscribe</button>
</form>
```

### Step 2.3: Email Service Integration (The "Postman")
You need a transactional email provider to ensure delivery.
*   **Recommended**: SendGrid, Mailgun, or AWS SES.
*   **Configuration**: Update `settings.py` with the provider's API credentials.

```python
# settings.py
EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = 'smtp.sendgrid.net'
EMAIL_PORT = 587
EMAIL_USE_TLS = True
EMAIL_HOST_USER = 'apikey'
EMAIL_HOST_PASSWORD = 'YOUR_SENDGRID_API_KEY'
```

### Step 2.4: Automation with Signals
Use Django Signals to automatically send emails when you hit "Save" in the Admin panel.

In `content/signals.py`:
```python
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.core.mail import send_mail
from .models import Article, Subscriber

@receiver(post_save, sender=Article)
def send_new_post_notification(sender, instance, created, **kwargs):
    if created and instance.status == 'published': # Only for new, published posts
        subscribers = Subscriber.objects.filter(is_active=True)
        recipient_list = [sub.email for sub in subscribers]
        
        send_mail(
            subject=f"New Post: {instance.title}",
            message=f"Read it here: https://yourdomain.com/article/{instance.slug}",
            from_email='daniel@yourdomain.com',
            recipient_list=recipient_list,
            fail_silently=False,
        )
```

### Step 2.5: The Unsubscribe Link (Crucial)
Legally and politely, you must include an unsubscribe link in every email.
1.  Create a view that takes a subscriber's ID/Code.
2.  Sets `is_active = False`.
3.  Append this link to the email body in the signal above.

---

## 🚀 Summary of Skills for V3
- **Django Syndication Framework**: Generating XML feeds.
- **Django Signals**: Event-driven programming (Action A triggers Action B).
- **SMTP Integration**: Connecting Django to real-world email infrastructure.
- **Privacy Compliance**: Managing user data and opt-out mechanisms.
