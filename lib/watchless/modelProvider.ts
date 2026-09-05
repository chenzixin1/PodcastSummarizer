// Server-side only. Provider selection is explicit; never fall back across bills.
export type WatchlessModelProvider = 'openrouter' | 'cloudflare';
type Env = Record<string, string | undefined>;
export type ModelPayload = {
  model: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens: number;
  temperature?: number;
  response_format?: { type: string; json_schema?: Record<string, unknown> };
};

export function watchlessModelRequest(payload: ModelPayload, env: Env = process.env) {
  const provider = env.WATCHLESS_AI_PROVIDER || 'openrouter';
  if (provider !== 'openrouter' && provider !== 'cloudflare') throw new Error('Invalid WATCHLESS_AI_PROVIDER');
  if (provider === 'openrouter') {
    if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not configured');
    return { provider, url: 'https://openrouter.ai/api/v1/chat/completions',
      headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' } as Record<string, string>,
      body: payload };
  }
  const account = env.WATCHLESS_CF_ACCOUNT_ID || '';
  if (!/^[a-f0-9]{32}$/.test(account)) throw new Error('WATCHLESS_CF_ACCOUNT_ID is invalid');
  if (!env.WATCHLESS_CF_API_TOKEN) throw new Error('WATCHLESS_CF_API_TOKEN is not configured');
  const headers: Record<string, string> = { Authorization: `Bearer ${env.WATCHLESS_CF_API_TOKEN}`,
    'Content-Type': 'application/json', 'cf-aig-collect-log': 'false', 'cf-aig-max-attempts': '1' };
  if (env.WATCHLESS_CF_GATEWAY_ID) headers['cf-aig-gateway-id'] = env.WATCHLESS_CF_GATEWAY_ID;
  if (payload.model === '@cf/zai-org/glm-5.3-flash') {
    return { provider, url: `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${payload.model}`, headers,
      body: { messages: payload.messages, max_completion_tokens: payload.max_tokens,
        temperature: payload.temperature ?? 0, response_format: payload.response_format,
        chat_template_kwargs: { enable_thinking: false } } };
  }
  const format = payload.response_format;
  return { provider, url: `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1/responses`, headers,
    body: { model: payload.model, input: payload.messages, max_output_tokens: payload.max_tokens, store: false,
      ...(format ? { text: { format: format.type === 'json_schema'
        ? { type: 'json_schema', ...format.json_schema } : { type: format.type } } } : {}) } };
}

export function watchlessModelText(body: unknown, provider: string): string {
  const envelope = body as { result?: unknown; success?: boolean; errors?: unknown[] };
  if (provider === 'cloudflare' && envelope.result) {
    if (envelope.success === false || envelope.errors?.length) throw new Error('Cloudflare model request failed');
    return watchlessModelText(envelope.result, 'chat');
  }
  const data = body as { status?: string; error?: unknown; choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> };
  if (provider === 'cloudflare') {
    if (data.status !== 'completed' || data.error) throw new Error('Cloudflare model response incomplete or failed');
    const text = (data.output || []).filter(item => item.type === 'message')
      .flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text || '').join('');
    if (!text.trim()) throw new Error('Cloudflare model returned no text');
    return text;
  }
  if (data.choices?.[0]?.finish_reason === 'length') throw new Error('Translation truncated');
  const text = data.choices?.[0]?.message?.content;
  if (!text?.trim()) throw new Error('OpenRouter model returned no text');
  return text;
}
