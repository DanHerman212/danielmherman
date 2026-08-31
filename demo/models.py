"""The demo patient cohort and per-user usage quota.

The cohort is FULLY SYNTHETIC — hadm_id, age, sex, and everything the model
reads are generated values (synthetic_cohort.json), not real patient data.
Assigning names is part of the same deterministic synthetic generation; a
demo that appears to show real patients invites exactly the wrong question.

The name mapping is stored rather than generated at request time. Generated
names would change on every deploy, which breaks screenshots, a written demo
script, and any bug report that refers to a patient by name.
"""

from django.conf import settings
from django.db import models
from django.db.models import F
from django.utils import timezone


class DemoPatient(models.Model):
    class Sex(models.TextChoices):
        MALE = 'M', 'Male'
        FEMALE = 'F', 'Female'

    # The synthetic admission id (90000001+), and the key the MCP tool takes.
    # It is the natural primary key: reseeding must update a patient in place
    # rather than accumulate duplicates under new surrogate ids.
    hadm_id = models.BigIntegerField(primary_key=True)

    display_name = models.CharField(
        max_length=100,
        db_index=True,
        help_text='Synthetic. Never a real patient name.',
    )
    age = models.PositiveSmallIntegerField()
    sex = models.CharField(max_length=1, choices=Sex.choices)
    summary = models.CharField(
        max_length=255,
        help_text='Clinical descriptor. Must not hint at the predicted outcome.',
    )
    split_name = models.CharField(
        max_length=20,
        help_text='Source split. Demo patients must not be rows the model trained on.',
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['display_name']
        verbose_name = 'demo patient'
        verbose_name_plural = 'demo patients'

    def __str__(self):
        return f'{self.display_name} (synthetic patient) — synthetic record {self.hadm_id}'


class DemoQuota(models.Model):
    """A per-user daily allowance of agent calls.

    Every request costs a Gemini round trip and a Vertex prediction, so the
    quota is a spend limit, not a politeness measure. It is enforced in the
    database rather than in Python because two concurrent requests from the
    same account must not both be allowed through on the same last credit.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='demo_quota',
    )
    daily_limit = models.PositiveSmallIntegerField(
        default=10,
        help_text='Requests permitted per calendar day.',
    )
    used = models.PositiveSmallIntegerField(default=0)
    # Refunds granted today for failures that still incurred model spend
    # (agent timeout, downstream tool error). Capped by DEMO_DAILY_REFUND_CAP:
    # unlimited refunds would let a request engineered to always fail
    # downstream burn a Gemini round trip per attempt, forever (S1-09).
    refunds = models.PositiveSmallIntegerField(default=0)
    # The day `used` refers to. Storing it beats a nightly cron: the counter
    # resets lazily on the first request of a new day, so there is no scheduled
    # job to fail silently and no window where a stale count blocks everyone.
    # NOTE: rollover happens at midnight in TIME_ZONE (UTC here) for every
    # user, not local midnight.
    period_start = models.DateField(default=timezone.localdate)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'demo quota'
        verbose_name_plural = 'demo quotas'

    def __str__(self):
        return f'{self.user} — {self.used}/{self.daily_limit} on {self.period_start}'

    @classmethod
    def consume(cls, user):
        """Claim one credit. Returns the period (date) debited, or None.

        The returned date is the claim token a later `refund` must present, so
        a refund can only ever target the counter the consume actually
        debited — not whatever day it happens to be by then (S1-07).

        Every write here is a single UPDATE with the arithmetic evaluated by
        the database. The read-modify-write version of this method — load the
        row, `used += 1`, save — loses increments whenever two requests
        overlap: both read 4, both write 5, and the limit quietly stops
        holding. That failure is invisible in testing and only shows up on the
        bill.
        """
        today = timezone.localdate()
        quota, _ = cls.objects.get_or_create(
            user=user,
            defaults={'daily_limit': settings.DEMO_DAILY_LIMIT},
        )

        # Roll the counter over if it belongs to an earlier day. Guarded by
        # `period_start__lt`, so if two requests race the loser's UPDATE simply
        # matches no rows.
        cls.objects.filter(user=user, period_start__lt=today).update(
            used=0, refunds=0, period_start=today
        )

        granted = cls.objects.filter(
            user=user, period_start=today, used__lt=F('daily_limit')
        ).update(used=F('used') + 1)
        return today if granted else None

    @classmethod
    def refund(cls, user, period, spent=True):
        """Return a credit after a failure that was not the user's fault.

        Without this an agent outage silently eats the day's allowance: the
        credit was spent, no answer was produced, and the user has no way to
        tell the difference.

        `period` is the date `consume` returned; if the counter has since
        rolled to a new day the UPDATE matches no rows and the stale credit is
        dropped rather than deducted from the wrong day's count (S1-07).

        `spent=True` (the default) means the failed request still bought a
        Gemini round trip upstream — those refunds are capped per day so a
        request engineered to always fail downstream cannot loop the quota
        (S1-09). Pass `spent=False` only for provably-zero-spend failures
        (e.g. connection refused before dispatch), which refund freely.

        Guarded by `used__gt=0` so a refund can never drive the counter
        negative.
        """
        qs = cls.objects.filter(user=user, period_start=period, used__gt=0)
        if spent:
            qs.filter(refunds__lt=settings.DEMO_DAILY_REFUND_CAP).update(
                used=F('used') - 1, refunds=F('refunds') + 1
            )
        else:
            qs.update(used=F('used') - 1)

    @classmethod
    def remaining(cls, user):
        quota = cls.objects.filter(user=user).first()
        if quota is None:
            return settings.DEMO_DAILY_LIMIT
        if quota.period_start < timezone.localdate():
            return quota.daily_limit
        return max(quota.daily_limit - quota.used, 0)
