"""The demo cohort is a subset of what the agent will answer for.

Phase 4, 2026-10-25. Two repositories hold half the cohort each: this one seeds the
patients a clinician can pick, and the agent refuses anything outside
`SERVED_HADM_IDS` before it runs a single tool. A seeded patient the agent refuses
is a patient offered and then denied — the `@` autocomplete lists them, and the answer
comes back "Admission not found."

Nothing compared the two until now. They agreed, by generation order rather than by
construction: the site's seed artifact and the agent's literal are both derived from
the same census, and no test said so.

Subset, not equality. The served set is expected to outgrow the demo cohort; a demo
patient the agent cannot open is always a bug. The agent asserts the same rule from
its own side (`tests/agent/test_eval_contract.py`), so whichever repository is checked
out with a sibling catches a regeneration that breaks it.
"""

import ast
import json
from pathlib import Path
from unittest import skipUnless

from django.test import SimpleTestCase

# The sibling repository, when it is checked out beside this one. CI mounts one
# repository at a time, so the read is guarded rather than assumed.
SIBLING = Path(__file__).resolve().parents[2] / 'enterprise_clinical_copilot'
AGENT_SERVED = SIBLING / 'services' / 'agent' / 'served_admissions.py'

SEED = Path(__file__).resolve().parent / 'data' / 'demo_cohort.json'

HAS_SIBLING = AGENT_SERVED.exists()
NO_SIBLING = 'the agent repository is not checked out beside this one'


def _served_ids():
    """`SERVED_HADM_IDS` read out of the agent's module, not imported from it.

    Importing would put this repository's test process on the agent's import path for
    a frozenset of integers. The literal is the whole fact, so the literal is what is
    read.
    """
    tree = ast.parse(AGENT_SERVED.read_text())
    for node in tree.body:
        # `SERVED_HADM_IDS: frozenset[int] = ...` is an AnnAssign, not an Assign.
        if isinstance(node, ast.AnnAssign):
            target, value = node.target, node.value
        elif isinstance(node, ast.Assign):
            if len(node.targets) != 1:
                continue
            target, value = node.targets[0], node.value
        else:
            continue
        if getattr(target, 'id', None) != 'SERVED_HADM_IDS':
            continue
        if isinstance(value, ast.Call):  # frozenset({...})
            value = value.args[0]
        return {element.value for element in value.elts}
    raise AssertionError(f'SERVED_HADM_IDS not found in {AGENT_SERVED}')


def _seeded_ids():
    payload = json.loads(SEED.read_text())
    patients = payload['patients'] if isinstance(payload, dict) else payload
    return {int(patient['hadm_id']) for patient in patients}


class CohortParityTests(SimpleTestCase):
    """The seed artifact against the agent's authorization boundary."""

    def test_the_seed_artifact_names_patients(self):
        """A guard on the guard: an empty or renamed artifact would make the
        subset assertion below vacuously true."""
        seeded = _seeded_ids()

        self.assertTrue(seeded, f'no patients in {SEED}')
        # The synthetic MIMIC ids this deployment uses, so a renamed or replaced
        # artifact fails loudly rather than comparing two empty sets.
        self.assertTrue(all(hadm >= 90000000 for hadm in seeded))

    @skipUnless(HAS_SIBLING, NO_SIBLING)
    def test_every_seeded_patient_is_one_the_agent_will_answer_for(self):
        refused = sorted(_seeded_ids() - _served_ids())

        self.assertEqual(
            refused, [],
            'seeded but not served — the console would offer these and the agent '
            'would answer "Admission not found": ' + str(refused),
        )

    @skipUnless(HAS_SIBLING, NO_SIBLING)
    def test_the_two_unscoreable_orphans_are_not_seeded(self):
        """90000039 and 90000107 are inside the authorization boundary with neither
        a note nor a feature row. The agent excludes them deliberately, so the demo
        cohort must not offer them either."""
        self.assertFalse({90000039, 90000107} & _seeded_ids())
