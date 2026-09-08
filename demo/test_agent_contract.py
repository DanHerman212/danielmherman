from django.test import SimpleTestCase

from .agent_contract import AgentResponseError, validate_agent_response


class AgentContractTests(SimpleTestCase):
    def test_valid_response_preserves_wire_shape(self):
        response = {
            'answer': 'The patient has an elevated risk.',
            'tool_calls': [
                {'name': 'predict_readmission', 'response': {'probability': 0.2}},
            ],
            'a2ui': {'surface_id': 'risk-canvas'},
        }

        self.assertIs(validate_agent_response(response), response)

    def test_missing_optional_fields_remain_compatible(self):
        self.assertEqual(validate_agent_response({}), {})

    def test_invalid_answer_is_rejected(self):
        with self.assertRaises(AgentResponseError):
            validate_agent_response({'answer': {'text': 'not a string'}})

    def test_invalid_tool_call_name_is_rejected(self):
        with self.assertRaises(AgentResponseError):
            validate_agent_response({'tool_calls': [{'name': 123, 'response': {}}]})

    def test_invalid_tool_response_is_rejected(self):
        with self.assertRaises(AgentResponseError):
            validate_agent_response({
                'tool_calls': [{'name': 'rag_search', 'response': 'not an object'}],
            })