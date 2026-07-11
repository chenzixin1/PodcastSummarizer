export interface InfographicPromptInput {
  originalTitle: string;
  summaryZh: string;
  titleZh?: string | null;
  keyData?: string | null;
  actionItems?: string | null;
}

export const INFOGRAPHIC_PROMPT_VERSION = 'podsum-infographic-v1';

export const INFOGRAPHIC_PROMPT_TEMPLATE = `为 PodSum 文章《{{TITLE_ZH}}》（{{ORIGINAL_TITLE}}）创作一张竖版中文信息图。

你是一位专门为视觉学习者设计高效信息图的艺术总监。目标是在 60 秒内让读者理解文章核心逻辑。信息图必须准确、清晰、信息密度高但不拥挤。每一段文字、图标、箭头和视觉隐喻都必须承担明确的学习功能，不添加纯装饰元素。概念清晰优先于装饰，术语准确，层级与间距清楚，关键思想同时用视觉和文字强化。

核心叙事：{{ONE_SENTENCE_THESIS}}

ARTICLE FACTS — 只可使用以下事实：
{{GROUNDED_FACTS}}

采用纵向学习路径：顶部是醒目标题和一句核心结论；中部用“旧范式 → 转型机制 → 新范式”或最适合本文的等价主流程连接模块；底部给出未来展望。使用一个中央视觉隐喻解释文章的核心变化，并在主流程周围加入简洁的小型关系图。

视觉风格：手绘编辑式信息图（Hand-drawn Editorial Infographic），干净纸张质感、清晰线条、简洁图标，专业、有温度，但不幼稚。暖白背景，深绿色结构色，金黄色强调发现，少量砖红色标记瓶颈。避免渐变、霓虹、纯黑背景、无意义机器人、发光大脑和装饰性科技线。

所有说明文字使用简体中文，关键术语第一次出现时保留英文。标题简短，单个模块不超过两句话。只使用 ARTICLE FACTS 中提供的事实，不编造数字、引语、来源或结论。确保中文清晰可读，不生成乱码、伪文字或无意义标签。

不要在信息图主体中显示 YouTube 标题、YouTube URL、PodSum URL 或来源脚注；这些信息将由程序在生成后加入图片白边。

竖版 3:4，高分辨率，安全边距充足。`;

const MAX_GROUNDED_FACTS_LENGTH = 6_000;

function escapeTemplateDelimiters(value: string): string {
  return value.replace(/{{/g, '\\{\\{').replace(/}}/g, '\\}\\}');
}

function cleanFactLine(line: string): string {
  return line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\s*#{1,6}\s+/, '')
    .trim();
}

function highSignalLines(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .filter(line => !/^\s*#{1,6}(?:\s|$)/.test(line))
    .map(cleanFactLine)
    .filter(line => Boolean(line) && !/^[-=_*`\s]+$/.test(line));
}

function capFacts(lines: string[]): string {
  let result = '';
  for (const line of lines) {
    const fact = escapeTemplateDelimiters(line);
    const next = result ? `${result}\n- ${fact}` : `- ${fact}`;
    if (next.length > MAX_GROUNDED_FACTS_LENGTH) {
      const remaining = MAX_GROUNDED_FACTS_LENGTH - result.length - (result ? 3 : 2);
      if (remaining > 0) result += `${result ? '\n- ' : '- '}${fact.slice(0, remaining)}`;
      break;
    }
    result = next;
  }
  return result;
}

export function buildInfographicPrompt(input: InfographicPromptInput): string {
  const facts = highSignalLines([
    input.summaryZh || '',
    input.keyData || '',
    input.actionItems || '',
  ].filter(Boolean).join('\n'));
  const originalTitle = escapeTemplateDelimiters(String(input.originalTitle || '').trim());
  const titleZh = escapeTemplateDelimiters(String(input.titleZh || input.originalTitle || '').trim());
  const thesis = escapeTemplateDelimiters(facts[0] || String(input.titleZh || input.originalTitle || '').trim());

  return INFOGRAPHIC_PROMPT_TEMPLATE
    .replace('{{TITLE_ZH}}', titleZh)
    .replace('{{ORIGINAL_TITLE}}', originalTitle)
    .replace('{{ONE_SENTENCE_THESIS}}', thesis)
    .replace('{{GROUNDED_FACTS}}', capFacts(facts));
}
