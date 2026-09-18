"""Delete conversations past their retention window.

The retention policy says a conversation lives for a fixed number of hours from
the moment it opens. Lazy expiry — deleting a row when someone next reads it —
cannot honour that promise, because an abandoned conversation is by definition
never read again: it would sit in the database with a clinician's question and
the agent's answer in it, indefinitely. That is acceptable for the daily quota
counter, whose stale value costs nothing and holds nothing, and it is not
acceptable here.

So the sweep is a job. In production this runs under `pg_cron` inside the
Cloud SQL instance, or from a scheduler that runs this command; either way it is
the only thing that removes an expired conversation, and it is safe to run as
often as the schedule allows.

    python manage.py purge_expired_conversations [--batch-size 500] [--dry-run]
"""

from django.core.management.base import BaseCommand
from django.utils import timezone

from demo.models import Conversation


class Command(BaseCommand):
    help = 'Delete conversations whose retention window has passed.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--batch-size',
            type=int,
            default=500,
            help='Rows to delete per query, so a large sweep does not hold '
                 'locks for the whole run (default: 500).',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Report what would be deleted without deleting it.',
        )

    def handle(self, *args, **options):
        now = timezone.now()
        expired = Conversation.objects.filter(expires_at__lte=now)
        total = expired.count()
        if total == 0:
            self.stdout.write('no expired conversations')
            return

        if options['dry_run']:
            self.stdout.write(
                f'dry-run: {total} conversation(s) would be deleted '
                f'(expired at or before {now:%Y-%m-%d %H:%M:%S %Z})'
            )
            return

        # Delete by primary key in batches: the turns go with each conversation
        # by cascade, and a batch keeps the transaction short enough that
        # concurrent requests are not waiting on the sweep.
        batch_size = max(options['batch_size'], 1)
        deleted = 0
        while True:
            batch = list(expired.values_list('pk', flat=True)[:batch_size])
            if not batch:
                break
            deleted += Conversation.objects.filter(pk__in=batch).delete()[0]
        self.stdout.write(
            self.style.SUCCESS(
                f'deleted {total} expired conversation(s), {deleted} row(s) in '
                f'total including their turns'
            )
        )
