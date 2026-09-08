/** @jest-environment node */
import { callQaModel } from '../../lib/qaModel';

describe('explicit QA inference provider and bounded errors', () => {
  const env = process.env;
  const originalFetch = global.fetch;
  beforeEach(() => {
    process.env = { ...env, QA_AI_PROVIDER: 'cloudflare', QA_MODEL: '@cf/zai-org/glm-5.3-flash',
      WATCHLESS_CF_ACCOUNT_ID: 'a'.repeat(32), WATCHLESS_CF_API_TOKEN: 'test-only-token', QA_MODEL_MAX_RETRIES: '0' };
    global.fetch = jest.fn();
  });
  afterEach(() => { process.env = env; global.fetch = originalFetch; jest.useRealTimers(); });
  const success = () => new Response(JSON.stringify({ success:true, result:{ choices:[{ finish_reason:'stop', message:{content:'答案 chunk-1'} }] } }), {status:200});
  test('Cloudflare GLM is explicit; OpenRouter credentials never select a fallback', async () => {
    process.env.OPENROUTER_API_KEY = 'other-bill';
    (fetch as jest.Mock).mockResolvedValue(success());
    expect(await callQaModel('问题','原文证据','hybrid')).toBe('答案 chunk-1');
    const [url, request] = (fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/run/@cf/zai-org/glm-5.3-flash`);
    expect(request.headers.Authorization).toBe('Bearer test-only-token');
    const body = JSON.parse(request.body);
    expect(body.max_completion_tokens).toBe(1800);
    expect(body.chat_template_kwargs.enable_thinking).toBe(false);
    expect(body.messages[0].content).toContain('问句不能当作某人的观点');
    expect(body.messages[1].content).toBe(JSON.stringify({question:'问题',evidence:'原文证据'}));
  });
  test('403 never retries and never exposes the upstream response', async () => {
    process.env.QA_MODEL_MAX_RETRIES = '1';
    (fetch as jest.Mock).mockResolvedValue(new Response('SECRET raw provider body', { status:403 }));
    await expect(callQaModel('q','c','legacy')).rejects.toMatchObject({status:503, message:expect.stringContaining('服务地区')});
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  test('zero retry setting is honored on transient failures', async () => {
    (fetch as jest.Mock).mockResolvedValue(new Response('upstream internals', {status:500}));
    await expect(callQaModel('q','c','legacy')).rejects.toThrow('问答服务暂时不可用');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  test('a transient failure permits only one configured retry', async () => {
    jest.useFakeTimers(); process.env.QA_MODEL_MAX_RETRIES = '99';
    (fetch as jest.Mock).mockResolvedValueOnce(new Response('busy',{status:429})).mockResolvedValueOnce(success());
    const pending=callQaModel('q','c','hybrid');
    await jest.runAllTimersAsync();
    await expect(pending).resolves.toBe('答案 chunk-1');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  test.each(['missing', 'invalid'])('configuration fails closed: %s', async kind => {
    if(kind==='missing') delete process.env.WATCHLESS_CF_API_TOKEN;
    else process.env.QA_AI_PROVIDER='unknown';
    await expect(callQaModel('q','c','legacy')).rejects.toThrow('配置不完整');
    expect(fetch).not.toHaveBeenCalled();
  });
  test.each([{success:true,result:{choices:[{finish_reason:'length',message:{content:'partial'}}]}}, {success:true,result:{choices:[]}}])('incomplete output is not stored as an answer',async body=>{
    (fetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify(body)));
    await expect(callQaModel('q','c','legacy')).rejects.toThrow('内容不完整');
  });
});
