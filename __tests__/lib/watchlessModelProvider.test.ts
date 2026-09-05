import { watchlessModelRequest, watchlessModelText } from '../../lib/watchless/modelProvider';

const env = { WATCHLESS_AI_PROVIDER: 'cloudflare', WATCHLESS_CF_ACCOUNT_ID: 'a'.repeat(32), WATCHLESS_CF_API_TOKEN: 'test-token' };
test('GLM uses Workers AI and preserves structured output limits', () => {
  const request = watchlessModelRequest({ model: '@cf/zai-org/glm-5.3-flash', messages: [{role:'user',content:'test'}], max_tokens: 100, response_format: {type:'json_object'} }, env);
  expect(request.url).toBe(`https://api.cloudflare.com/client/v4/accounts/${env.WATCHLESS_CF_ACCOUNT_ID}/ai/run/@cf/zai-org/glm-5.3-flash`);
  expect(request.body).toMatchObject({max_completion_tokens:100,response_format:{type:'json_object'}});
});
test('Workers AI envelope extracts only final content', () => {
  expect(watchlessModelText({success:true,result:{choices:[{finish_reason:'stop',message:{content:'{"ok":true}',reasoning_content:'private'}}]}}, 'cloudflare')).toBe('{"ok":true}');
});
test.each(['<think>Internal draft</think> Final answer', 'Internal draft</think> Final answer'])('reasoning mixed into content is not returned: %s', content => {
  expect(watchlessModelText({ success: true, result: { choices: [{ finish_reason: 'stop', message: { content } }] } }, 'cloudflare')).toBe('Final answer');
});
test.each(['<think>Unfinished draft', 'Draft</think>'])('reasoning without a final answer fails closed: %s', content => {
  expect(() => watchlessModelText({ success: true, result: { choices: [{ finish_reason: 'stop', message: { content } }] } }, 'cloudflare')).toThrow('incomplete');
});
test('rejects truncated and failed responses', () => {
  expect(() => watchlessModelText({result:{choices:[{finish_reason:'length',message:{content:'partial'}}]}}, 'cloudflare')).toThrow('truncated');
  expect(() => watchlessModelText({success:false,result:{},errors:[{}]}, 'cloudflare')).toThrow();
});
test('missing CF credential fails closed', () => {
  expect(() => watchlessModelRequest({model:'@cf/zai-org/glm-5.3-flash',messages:[],max_tokens:1},{...env,WATCHLESS_CF_API_TOKEN:undefined})).toThrow('not configured');
});
