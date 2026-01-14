# Comment System Implementation Plan

This document outlines the step-by-step process for adding a user registration and moderated comment system to the website.

## Phase 1: User Authentication (Prerequisite)
Before users can comment, they need to be able to register and log in.

### 1.1 Setup Django Auth URLs
- [ ] Add `path('accounts/', include('django.contrib.auth.urls'))` to `danielmherman/urls.py`.
- [ ] Create a `users` app (optional but recommended) or handle registration views in `content`.

### 1.2 Create Authentication Templates
- [ ] Create `registration/login.html`.
- [ ] Create `registration/signup.html`.
- [ ] Create `registration/logged_out.html`.
- [ ] Add "Login" / "Sign Up" / "Logout" links to the `base.html` navbar based on `{% if user.is_authenticated %}`.

### 1.3 User Registration View
- [ ] Create a view for handling user signup (using Django's built-in `UserCreationForm`).
- [ ] Add a URL pattern for the signup page.

## Phase 2: The Comment Model

### 2.1 Define the Model
- [ ] In `content/models.py`, create the `Comment` class:
    - `article`: ForeignKey to Article (on_delete=models.CASCADE).
    - `user`: ForeignKey to User (on_delete=models.CASCADE).
    - `body`: TextField.
    - `created_on`: DateTimeField (auto_now_add=True).
    - `is_approved`: BooleanField (default=False).

### 2.2 Database Migration
- [ ] Run `python manage.py makemigrations`.
- [ ] Run `python manage.py migrate`.

## Phase 3: Admin & Moderation

### 3.1 Admin Configuration
- [ ] In `content/admin.py`, register the `Comment` model.
- [ ] Customize `CommentAdmin`:
    - `list_display`: ('user', 'body', 'article', 'created_on', 'is_approved')
    - `list_filter`: ('is_approved', 'created_on')
    - `search_fields`: ('user__username', 'body')
    - `actions`: Add a custom action `approve_comments` to bulk approve selected items.

## Phase 4: Forms & Views

### 4.1 Create Comment Form
- [ ] Create `content/forms.py`.
- [ ] Define `CommentForm` (ModelForm) including only the `body` field.

### 4.2 Update Article Detail View
- [ ] In `content/views.py`, update `article_detail`:
    - Handle POST requests:
        - Check if user is authenticated.
        - Validate form.
        - Save comment with `commit=False`.
        - Assign `article` and `user` to the comment instance.
        - Set `is_approved = False`.
        - Save to DB.
        - Add success message: "Comment awaiting moderation."
    - Handle GET requests:
        - Instantiate empty `CommentForm`.
        - Query *approved* comments: `comments = article.comments.filter(is_approved=True)`.

## Phase 5: Templates

### 5.1 Update Article Detail Template
- [ ] In `content/templates/content/article_detail.html`:
    - Display the list of approved comments.
    - If user is logged in: Show the `CommentForm`.
    - If user is NOT logged in: Show a button/link to "Log in to comment".

## Phase 6: Security & Polish

### 6.1 Bot Protection
- [ ] Install `django-recaptcha`.
- [ ] Add reCAPTCHA field to the Signup form to prevent bot registrations.

### 6.2 Privacy & Compliance
- [ ] Ensure `settings.py` has `SECURE_SSL_REDIRECT = True` (for production).
- [ ] Add a simple Privacy Policy page stating that email addresses are stored for authentication only.
