"""Forms for the public content surface.

ContactForm (S6-02/S6-03): the public contact form previously wrote straight
to the database with no server-side validation — on production PostgreSQL,
oversized values raised DataError → unhandled 500, and the unbounded message
field accepted unlimited multi-MB rows. This ModelForm enforces the model's
length limits (plus a 5000-char cap on the message) and validates the email,
so a bad submission re-renders with errors instead of crashing. The hidden
`website` field is a honeypot: real visitors never fill it, bots do.
"""

from django import forms

from .models import ContactMessage


class ContactForm(forms.ModelForm):
    # Honeypot (S6-02): hidden, never filled by a human.
    website = forms.CharField(required=False, widget=forms.HiddenInput)
    # TextField has no DB max_length, so cap it at the form boundary (S6-02).
    message = forms.CharField(
        max_length=5000,
        widget=forms.Textarea(attrs={'class': 'form-control', 'rows': 5}),
    )

    class Meta:
        model = ContactMessage
        fields = ['name', 'email', 'subject', 'message']
        widgets = {
            'name': forms.TextInput(attrs={'class': 'form-control'}),
            'email': forms.EmailInput(attrs={'class': 'form-control'}),
            'subject': forms.TextInput(attrs={'class': 'form-control'}),
        }
