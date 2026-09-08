import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from watchless_provider import model_request, model_text

class ProviderTests(unittest.TestCase):
    def test_glm_request(self):
        provider, url, headers, body = model_request('@cf/zai-org/glm-5.3-flash', 'translate', {'type': 'object'}, 'test', 300, {
            'WATCHLESS_AI_PROVIDER': 'cloudflare', 'WATCHLESS_CF_ACCOUNT_ID': 'a' * 32, 'WATCHLESS_CF_API_TOKEN': 'test'})
        self.assertTrue(url.endswith('/ai/run/@cf/zai-org/glm-5.3-flash'))
        self.assertEqual(body['max_completion_tokens'], 300)
        self.assertFalse(body['chat_template_kwargs']['enable_thinking'])
        self.assertEqual(body['response_format']['type'], 'json_schema')

    def test_envelope(self):
        self.assertEqual(model_text({'success': True, 'result': {'choices': [{'finish_reason': 'stop', 'message': {'content': 'ok', 'reasoning_content': 'ignore'}}]}}, 'cloudflare'), 'ok')
        with self.assertRaises(RuntimeError):
            model_text({'result': {'choices': [{'finish_reason': 'length', 'message': {'content': 'partial'}}]}}, 'cloudflare')

    def test_missing_secret(self):
        with self.assertRaises(RuntimeError):
            model_request('@cf/zai-org/glm-5.3-flash', 'x', {}, 'test', 1, {'WATCHLESS_AI_PROVIDER':'cloudflare','WATCHLESS_CF_ACCOUNT_ID':'a'*32})
