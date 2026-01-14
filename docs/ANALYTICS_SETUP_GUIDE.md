# Analytics Setup Guide: Google Analytics 4 (GA4)

This guide details how to add website traffic tracking to your Django application using Google Analytics 4.

---

## 📋 Step 1: Create a Google Analytics Account

1.  Go to [analytics.google.com](https://analytics.google.com).
2.  Log in with your Google account (ideally the same one you use for Google Cloud Platform).
3.  Click **Start measuring**.
4.  **Account Setup**:
    *   **Account Name**: Enter "Daniel Herman Website" (or similar).
    *   Configure data sharing settings as you prefer.
    *   Click **Next**.
5.  **Property Setup**:
    *   **Property Name**: "danielmherman.com".
    *   **Reporting Time Zone**: Select your local time zone.
    *   **Currency**: Select your local currency.
    *   Click **Next**.
6.  **Business Details**: Select your industry (e.g., "Hobbies & Leisure" or "Tech") and business size ("Small").
7.  **Business Objectives**: Select "Generate leads" or "Examine user behavior".
8.  Click **Create** and accept the Terms of Service.

---

## 📋 Step 2: Get Your Tracking Code

1.  In the **Data Streams** options, choose **Web**.
2.  **Set up data stream**:
    *   **Website URL**: Enter your domain (e.g., `danielmherman.com`). If testing locally, you can just put `example.com` for now, or your production domain.
    *   **Stream Name**: "Main Website".
    *   Click **Create stream**.
3.  **Web Stream Details**:
    *   You will see a **Measurement ID** (formatted like `G-XXXXXXXXXX`).
    *   Click on **View tag instructions** (or "Global Site Tag (gtag.js)").
    *   Copy the entire code block provided. It will look like this:

```html
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', 'G-XXXXXXXXXX');
</script>
```

---

## 📋 Step 3: Add Code to Django

You need to add this code to your base template so it loads on every page of your site.

**File**: `content/content/templates/content/base.html`

1.  Open `content/content/templates/content/base.html`.
2.  Paste the code **immediately after** the opening `<head>` tag.

**Example:**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <!-- PASTE GOOGLE ANALYTICS CODE HERE -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-YOUR_ID_HERE"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());

      gtag('config', 'G-YOUR_ID_HERE');
    </script>
    <!-- END GOOGLE ANALYTICS CODE -->

    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{% block title %}danielmherman.com{% endblock %}</title>
    <!-- ... rest of your head content ... -->
```

---

## 📋 Step 4: Verify Installation

1.  **Deploy your changes** (or run the server locally).
2.  Open your website in a new browser tab.
3.  Go back to your Google Analytics dashboard.
4.  Click on **Reports** > **Realtime**.
5.  You should see at least **1 user** active on the site (that's you!).

---

## 💡 Pro Tip: Environment Variables (Optional)

For better security and to prevent tracking local development traffic, you can use a Django template variable for the ID.

1.  **In `settings.py`**:
    ```python
    GOOGLE_ANALYTICS_ID = 'G-XXXXXXXXXX' # Or read from os.environ
    ```

2.  **In `content/context_processors.py`** (create if needed):
    ```python
    from django.conf import settings

    def ga_tracking_id(request):
        return {'GOOGLE_ANALYTICS_ID': settings.GOOGLE_ANALYTICS_ID}
    ```

3.  **In `settings.py`**, add to `TEMPLATES['OPTIONS']['context_processors']`:
    ```python
    'content.context_processors.ga_tracking_id',
    ```

4.  **In `base.html`**:
    ```html
    {% if GOOGLE_ANALYTICS_ID %}
    <script async src="https://www.googletagmanager.com/gtag/js?id={{ GOOGLE_ANALYTICS_ID }}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());

      gtag('config', '{{ GOOGLE_ANALYTICS_ID }}');
    </script>
    {% endif %}
    ```
