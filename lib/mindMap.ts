import { modelConfig } from './modelConfig';
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
}

interface GenerateMindMapResult {
  success: boolean;
  data?: MindMapData;
  rawOutput?: string;
  error?: string;
}

const MAX_TREE_DEPTH = 3; // root depth = 0, max 4 levels
const MAX_CHILDREN_PER_NODE = 10;

function cleanLabel(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim().slice(0, 64);
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

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.VERCEL_URL || 'http://localhost:3000',
      'X-Title': 'PodSum.cc',
    },
    body: JSON.stringify({
      model: modelConfig.MODEL,
      messages: [
        { role: 'system', content: prompts.mindMapSystem },
        { role: 'user', content: prompts.mindMapUser(payload) },
      ],
      temperature: 0.2,
      max_tokens: 2600,
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

export async function generateMindMapData(input: GenerateMindMapInput): Promise<GenerateMindMapResult> {
  const signalText = `${input.title || ''}\n${input.summary || ''}\n${input.highlights || ''}`.trim();
  if (!signalText) {
    return {
      success: false,
      error: 'Insufficient input content for mind map generation',
    };
  }

  try {
    const rawOutput = await requestMindMapFromModel(input);
    const jsonText = extractJsonObject(rawOutput);
    const parsed = JSON.parse(jsonText);
    const normalized = normalizeMindMapData(parsed);
    if (!normalized) {
      return {
        success: false,
        rawOutput,
        error: 'Model output is not a valid mind map tree',
      };
    }
    return {
      success: true,
      data: normalized,
      rawOutput,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
