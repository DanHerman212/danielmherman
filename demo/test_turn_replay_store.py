"""What the site keeps of a tool call, and why one set moved.

Phase 5C, 2026-10-25. A conversation whose first turn was `/labs` re-ran
`get_lab_trends` on **every** subsequent turn: the agent classified the lab series as
re-derivable, a re-derivable result is not stored, and the replay resolves what it was
not given. The call happened before the model was asked anything and emitted no progress
stage, so the reader saw it only as latency — and it got no cheaper as the thread grew.

The agent now classifies the series as a result a caller keeps. Nothing in this
repository changed to make that work: `_stored_calls` has always been driven by the
agent's own `derivable` flag, which is the point — the layer that ran the tool is the one
that says whether its result can be produced again. These tests pin that the flag is
still what decides, and that a kept payload survives the round trip into the replay.
"""

from django.test import SimpleTestCase

from demo import conversations

LABS = {
    "trends": [{"label": "Creatinine", "points": [{"day": 1, "value": 1.1}]}],
    "synthetic": True,
    "note": "Values are synthetic.",
    "hadm_id": 90000015,
}


class StoredCallTests(SimpleTestCase):
    """`derivable: False` is the only thing that keeps a result, and it now includes labs."""

    def test_a_kept_result_is_stored_with_its_payload(self):
        stored = conversations._stored_calls([{
            "name": "get_lab_trends",
            "args": {"hadm_id": 90000015},
            "response": LABS,
            "derivable": False,
        }])

        self.assertEqual(stored, [{
            "name": "get_lab_trends",
            "args": {"hadm_id": 90000015},
            "payload": LABS,
        }])

    def test_a_re_derivable_result_is_not(self):
        """Note text stays out of this database. The flag is the agent's to set, and the
        tools it leaves derivable are the ones that return prose."""
        stored = conversations._stored_calls([{
            "name": "rag_search",
            "args": {"hadm_id": 90000015, "query": "discharge diagnosis"},
            "response": {"passages": [{"text": "The patient was discharged on ..."}]},
            "derivable": True,
        }])

        self.assertEqual(stored, [{
            "name": "rag_search",
            "args": {"hadm_id": 90000015, "query": "discharge diagnosis"},
            "payload": None,
        }])

    def test_a_call_that_says_nothing_is_treated_as_derivable(self):
        """Guessing the other way would put note text in the store on a payload written
        by an agent that predates the flag."""
        stored = conversations._stored_calls([
            {"name": "rag_search", "args": {}, "response": {"passages": []}},
        ])

        self.assertIsNone(stored[0]["payload"])

    def test_a_kept_payload_survives_into_the_replay(self):
        stored = conversations._stored_calls([{
            "name": "get_lab_trends",
            "args": {"hadm_id": 90000015},
            "response": LABS,
            "derivable": False,
        }])

        replayed = conversations._replay_calls(stored)

        self.assertEqual(replayed[0]["payload"], LABS)
