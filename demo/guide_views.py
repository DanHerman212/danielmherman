"""The demo's endpoints, plus the Demo User Guide page.

The guide is a static, journey-structured page (extending the site base) that
teaches a reviewer how to evaluate the demo: assess risk, ask the agent,
verify evidence, and see the cohort spread. Screenshots are captured from the
live hybrid demo and stored under static/demo-guide/img/ — until those exist,
the template shows an honest "screenshot pending" placeholder so the layout
can be reviewed before images land.
"""

from django.contrib.auth.decorators import login_required
from django.shortcuts import render


@login_required
def guide(request):
    """The Demo User Guide: static content, structured by user journey."""
    return render(request, 'demo/guide.html', {})
