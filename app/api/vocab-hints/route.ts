import { NextRequest, NextResponse } from 'next/server';

interface HintInputItem {
  word: string;
  context: string;
}

interface HintResultMap {
  [word: string]: string;
}

const MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

function normalizeItems(items: unknown): HintInputItem[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map((item) => {
      const source = item as Record<string, unknown>;
      return {
        word: String(source.word || '').toLowerCase().trim(),
        context: String(source.context || '').trim().slice(0, 320),
      };
    })
    .filter((item) => /^[a-z][a-z'-]{3,}$/.test(item.word) && item.context.length > 0)
    .slice(0, 48);
}

function extractJsonObject(input: string): Record<string, unknown> | null {
  const normalized = String(input || '')
    .replace(/```json/gi, '```')
    .replace(/```/g, '')
    .trim();
  if (!normalized) {
    return null;
  }

  try {
    const direct = JSON.parse(normalized);
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct as Record<string, unknown>;
    }
  } catch {
    // continue with substring parsing
  }

  const start = normalized.indexOf('{');
  const end = normalized.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }

  const maybeJson = normalized.slice(start, end + 1);
  try {
    const parsed = JSON.parse(maybeJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function flattenMessageContent(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        const source = item as Record<string, unknown>;
        return typeof source?.text === 'string' ? source.text : '';
      })
      .join('\n')
      .trim();
  }
  return '';
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const items = normalizeItems(payload?.items);
    if (items.length === 0) {
      return NextResponse.json({ success: true, hints: {} });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ success: true, hints: {} });
    }

    const prompt = [
      '请根据上下文给英文单词生成简短中文释义，用于英文学习。',
      '要求：',
      '1) 必须结合句子上下文，不要照抄词典定义。',
      '2) 每个释义控制在2-12个中文字符，禁止词性标注、禁止例句、禁止分号长串。',
      '3) 只返回JSON对象，key是单词小写，value是释义。',
      '4) 若上下文不足以判断，用最常见义。',
      '',
      JSON.stringify(items),
    ].join('\n');

    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.VERCEL_URL || 'http://localhost:3000',
        'X-Title': 'PodSum.cc',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 1200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '你是英语学习助教，只输出合法JSON。' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('[vocab-hints] model request failed', response.status, errorText.slice(0, 240));
      return NextResponse.json({ success: true, hints: {}, reason: `model-http-${response.status}` });
    }

    const data = await response.json();
    const content = flattenMessageContent(data?.choices?.[0]?.message?.content);
    if (!content) {
      console.error('[vocab-hints] model returned empty content');
      return NextResponse.json({ success: true, hints: {}, reason: 'empty-content' });
    }

    const parsed = extractJsonObject(content);
    if (!parsed) {
      console.error('[vocab-hints] json parse failed', content.slice(0, 280));
      return NextResponse.json({ success: true, hints: {}, reason: 'json-parse-failed' });
    }

    const hints: HintResultMap = {};
    for (const [word, gloss] of Object.entries(parsed)) {
      const key = String(word || '').toLowerCase().trim();
      const value = String(gloss || '').replace(/[()（）]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
      if (!/^[a-z][a-z'-]{3,}$/.test(key) || !value) {
        continue;
      }
      hints[key] = value;
    }

    return NextResponse.json({ success: true, hints, reason: Object.keys(hints).length > 0 ? undefined : 'empty-hints' });
  } catch {
    return NextResponse.json({ success: true, hints: {}, reason: 'unknown-error' });
  }
}
