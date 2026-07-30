"""Load the demo cohort into Postgres from the seed artifact.

The artifact is produced by the harness
(projects/agent-harness/scripts/seed_demo_cohort.py), which is where cohort
selection and name assignment live. This command only loads it, so the website
needs no BigQuery or Vertex access and the harness needs no database
credentials.

    python manage.py seed_demo_patients
    python manage.py seed_demo_patients --path /path/to/demo_cohort.json --prune

Idempotent: reseeding updates in place, keyed on hadm_id.
"""

import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from demo.models import DemoPatient

# .../demo/management/commands/seed_demo_patients.py -> .../demo/data/
DEFAULT_PATH = Path(__file__).resolve().parents[2] / 'data' / 'demo_cohort.json'

REQUIRED_FIELDS = ('hadm_id', 'display_name', 'age', 'sex', 'summary', 'split_name')


class Command(BaseCommand):
    help = 'Load demo patients from the seed artifact produced by the harness.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--path',
            type=Path,
            default=DEFAULT_PATH,
            help=f'Seed JSON (default: {DEFAULT_PATH})',
        )
        parser.add_argument(
            '--prune',
            action='store_true',
            help='Delete patients absent from the artifact. Off by default: a '
                 'truncated file should not silently empty the cohort.',
        )

    def handle(self, *args, **options):
        path = options['path']
        if not path.exists():
            raise CommandError(
                f'Seed artifact not found: {path}\n'
                f'Generate it with scripts/seed_demo_cohort.py in the harness, '
                f'then copy it to demo/data/.'
            )

        patients = json.loads(path.read_text()).get('patients', [])
        if not patients:
            raise CommandError(f'{path} contains no patients.')

        for patient in patients:
            missing = [f for f in REQUIRED_FIELDS if f not in patient]
            if missing:
                raise CommandError(
                    f'Patient {patient.get("hadm_id", "?")} is missing {missing}. '
                    f'The artifact format changed — update this command rather '
                    f'than loading a partial record.'
                )

        created = updated = 0
        with transaction.atomic():
            for patient in patients:
                _, was_created = DemoPatient.objects.update_or_create(
                    hadm_id=patient['hadm_id'],
                    defaults={
                        'display_name': patient['display_name'],
                        'age': patient['age'],
                        'sex': patient['sex'],
                        'summary': patient['summary'],
                        'split_name': patient['split_name'],
                    },
                )
                created += was_created
                updated += not was_created

            pruned = 0
            if options['prune']:
                ids = [p['hadm_id'] for p in patients]
                pruned, _ = DemoPatient.objects.exclude(hadm_id__in=ids).delete()

        self.stdout.write(self.style.SUCCESS(
            f'{created} created, {updated} updated, {pruned} pruned. '
            f'Cohort now holds {DemoPatient.objects.count()} patients.'
        ))
