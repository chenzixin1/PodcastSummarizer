import { prompts } from './prompts';

export interface MindMapNode {
  label: string;
  children?: MindMapNode[];
}

export interface MindMapData {
  root: MindMapNode;
}

interface GenerateMindMapInput {
  title?: string | null;
  summary?: string | null;
  highlights?: string | null;
  sourceReference?: string | null;
  language?: 'zh' | 'en';
}

interface GenerateMindMapResult {
  success: boolean;
  data?: MindMapData;
  rawOutput?: string;
  error?: string;
}

const MIND_MAP_MODEL = process.env.OPENROUTER_MINDMAP_MODEL || 'google/gemini-3-flash-preview';
const MAX_TREE_DEPTH = 5; // root depth = 0, max 6 levels
const MAX_CHILDREN_PER_NODE = 14;
const TARGET_MIN_DEPTH = 5; // root depth = 1

function cleanLabel(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim().slice(0, 280);
}

function normalizeMindMapNode(value: unknown, depth: number): MindMapNode | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const source = value as Record<string, unknown>;
  const label = cleanLabel(source.label);
  if (!label) {
    return null;
  }

  const node: MindMapNode = { label };
  if (depth >= MAX_TREE_DEPTH) {
    return node;
  }

  const childrenRaw = Array.isArray(source.children) ? source.children : [];
  if (childrenRaw.length === 0) {
    return node;
  }

  const seenLabels = new Set<string>();
  const children: MindMapNode[] = [];
  for (const child of childrenRaw) {
    if (children.length >= MAX_CHILDREN_PER_NODE) {
      break;
    }
    const normalizedChild = normalizeMindMapNode(child, depth + 1);
    if (!normalizedChild) {
      continue;
    }
    const key = normalizedChild.label.toLowerCase();
    if (seenLabels.has(key)) {
      continue;
    }
    seenLabels.add(key);
    children.push(normalizedChild);
  }

  if (children.length > 0) {
    node.children = children;
  }
  return node;
}

function normalizeMindMapData(value: unknown): MindMapData | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const source = value as Record<string, unknown>;
  const rootCandidate = source.root ?? source;
  const root = normalizeMindMapNode(rootCandidate, 0);
  if (!root) {
    return null;
  }
  if (!root.children || root.children.length === 0) {
    return null;
  }

  return { root };
}

function extractJsonObject(raw: string): string {
  const withoutFence = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (withoutFence.startsWith('{') && withoutFence.endsWith('}')) {
    return withoutFence;
  }

  const start = withoutFence.indexOf('{');
  if (start === -1) {
    return withoutFence;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < withoutFence.length; i += 1) {
    const ch = withoutFence[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }

    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return withoutFence.slice(start, i + 1);
      }
    }
  }

  return withoutFence.slice(start);
}

function readChoiceContent(choice: unknown): string {
  if (!choice || typeof choice !== 'object') {
    return '';
  }
  const message = (choice as { message?: unknown }).message;
  if (!message || typeof message !== 'object') {
    return '';
  }

  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        if (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string') {
          return (item as { text: string }).text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

async function requestMindMapFromModel(payload: GenerateMindMapInput): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY || '';
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is missing');
  }
  const language = payload.language === 'en' ? 'en' : 'zh';
  const systemPrompt = language === 'en' ? prompts.mindMapSystemEn : prompts.mindMapSystemZh;
  const userPrompt = language === 'en' ? prompts.mindMapUserEn(payload) : prompts.mindMapUserZh(payload);
  const depthRule =
    language === 'en'
      ? 'Additional hard requirement: at least two branches must reach level 5; if enough detail exists, level 6 is allowed.'
      : '额外硬性要求：至少两个分支必须达到第5层；如果信息充足可达到第6层。';

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.VERCEL_URL || 'http://localhost:3000',
      'X-Title': 'PodSum.cc',
    },
    body: JSON.stringify({
      model: MIND_MAP_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `${userPrompt}\n\n${depthRule}`,
        },
      ],
      temperature: 0.35,
      max_tokens: 6000,
      stream: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OpenRouter error ${response.status}: ${text || response.statusText}`);
  }

  const json = await response.json();
  const content = readChoiceContent(json?.choices?.[0]);
  if (!content.trim()) {
    throw new Error('Model returned empty mind map content');
  }
  return content;
}

export function isMindMapData(value: unknown): value is MindMapData {
  return Boolean(normalizeMindMapData(value));
}

function getMindMapDepth(data: MindMapData): number {
  const walk = (node: MindMapNode, depth: number): number => {
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      return depth;
    }
    let maxDepth = depth;
    for (const child of children) {
      maxDepth = Math.max(maxDepth, walk(child, depth + 1));
    }
    return maxDepth;
  };
  return walk(data.root, 1);
}

export async function generateMindMapData(input: GenerateMindMapInput): Promise<GenerateMindMapResult> {
  const signalText = `${input.title || ''}\n${input.summary || ''}\n${input.highlights || ''}`.trim();
  if (!signalText) {
    return {
      success: false,
      error: 'Insufficient input content for mind map generation',
    };
  }

  let bestCandidate: { data: MindMapData; rawOutput: string; depth: number } | null = null;
  let lastError = '';

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const rawOutput = await requestMindMapFromModel(input);
      const jsonText = extractJsonObject(rawOutput);
      const parsed = JSON.parse(jsonText);
      const normalized = normalizeMindMapData(parsed);
      if (!normalized) {
        lastError = 'Model output is not a valid mind map tree';
        continue;
      }

      const depth = getMindMapDepth(normalized);
      if (!bestCandidate || depth > bestCandidate.depth) {
        bestCandidate = { data: normalized, rawOutput, depth };
      }
      if (depth >= TARGET_MIN_DEPTH) {
        return {
          success: true,
          data: normalized,
          rawOutput,
        };
      }
      lastError = `Mind map depth ${depth} is shallower than target ${TARGET_MIN_DEPTH}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  if (bestCandidate) {
    return {
      success: true,
      data: bestCandidate.data,
      rawOutput: bestCandidate.rawOutput,
    };
  }

  return {
    success: false,
    error: lastError || 'Failed to generate mind map',
  };
}
