from django.test import SimpleTestCase

from .agent_contract import AgentResponseError, validate_agent_response


class AgentContractTests(SimpleTestCase):
    def test_valid_response_preserves_wire_shape(self):
        response = {
            'answer': 'The patient has an elevated risk.',
            'model': 'gemini-3.1-flash-lite',
            'code_revision': 'abc1234',
            'tool_calls': [
                {'name': 'predict_readmission',
                 'args': {'hadm_id': 90000009},
                 'response': {'probability': 0.2},
                 'derivable': False},
            ],
            'a2ui': {'surface_id': 'risk-canvas'},
        }

        self.assertIs(validate_agent_response(response), response)

    def test_missing_optional_fields_remain_compatible(self):
        self.assertEqual(validate_agent_response({}), {})

    def test_invalid_answer_is_rejected(self):
        with self.assertRaises(AgentResponseError):
            validate_agent_response({'answer': {'text': 'not a string'}})

    def test_invalid_code_revision_is_rejected(self):
        """It is stored with the turn, so it is a string or it is nothing."""
        with self.assertRaises(AgentResponseError):
            validate_agent_response({'code_revision': 1234})

    def test_invalid_tool_call_name_is_rejected(self):
        with self.assertRaises(AgentResponseError):
            validate_agent_response({'tool_calls': [{'name': 123, 'response': {}}]})

    def test_invalid_tool_arguments_are_rejected(self):
        with self.assertRaises(AgentResponseError):
            validate_agent_response({
                'tool_calls': [{'name': 'rag_search', 'args': 'hadm_id=90000009'}],
            })

    def test_a_non_boolean_derivable_flag_is_rejected(self):
        with self.assertRaises(AgentResponseError):
            validate_agent_response({
                'tool_calls': [{'name': 'rag_search', 'derivable': 'yes'}],
            })

    def test_invalid_tool_response_is_rejected(self):
        with self.assertRaises(AgentResponseError):
            validate_agent_response({
                'tool_calls': [{'name': 'rag_search', 'response': 'not an object'}],
            })