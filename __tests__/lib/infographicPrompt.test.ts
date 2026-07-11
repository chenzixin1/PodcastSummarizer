import {
  buildInfographicPrompt,
  INFOGRAPHIC_PROMPT_TEMPLATE,
  INFOGRAPHIC_PROMPT_VERSION,
} from '../../lib/infographicPrompt';

describe('infographic prompt', () => {
  const input = {
    titleZh: '下一代训练范式是什么？',
    originalTitle: 'What does the next training paradigm look like?',
    summaryZh: [
      '# 中文总结',
      '## 核心观点',
      '- 部署后持续学习。',
      '## 关键数据',
      '- 30%–50% 用于推理。',
      '## 机制',
      '- 反馈闭环缩短模型迭代。',
    ].join('\n'),
  };

  test('pins the accepted v1 instructions and grounds the article facts', () => {
    const prompt = buildInfographicPrompt(input);

    expect(INFOGRAPHIC_PROMPT_TEMPLATE).toMatchInlineSnapshot(`
"为 PodSum 文章《{{TITLE_ZH}}》（{{ORIGINAL_TITLE}}）创作一张竖版中文信息图。

你是一位专门为视觉学习者设计高效信息图的艺术总监。目标是在 60 秒内让读者理解文章核心逻辑。信息图必须准确、清晰、信息密度高但不拥挤。每一段文字、图标、箭头和视觉隐喻都必须承担明确的学习功能，不添加纯装饰元素。概念清晰优先于装饰，术语准确，层级与间距清楚，关键思想同时用视觉和文字强化。

核心叙事：{{ONE_SENTENCE_THESIS}}

ARTICLE FACTS — 只可使用以下事实：
{{GROUNDED_FACTS}}

采用纵向学习路径：顶部是醒目标题和一句核心结论；中部用“旧范式 → 转型机制 → 新范式”或最适合本文的等价主流程连接模块；底部给出未来展望。使用一个中央视觉隐喻解释文章的核心变化，并在主流程周围加入简洁的小型关系图。

视觉风格：手绘编辑式信息图（Hand-drawn Editorial Infographic），干净纸张质感、清晰线条、简洁图标，专业、有温度，但不幼稚。暖白背景，深绿色结构色，金黄色强调发现，少量砖红色标记瓶颈。避免渐变、霓虹、纯黑背景、无意义机器人、发光大脑和装饰性科技线。

所有说明文字使用简体中文，关键术语第一次出现时保留英文。标题简短，单个模块不超过两句话。只使用 ARTICLE FACTS 中提供的事实，不编造数字、引语、来源或结论。确保中文清晰可读，不生成乱码、伪文字或无意义标签。

不要在信息图主体中显示 YouTube 标题、YouTube URL、PodSum URL 或来源脚注；这些信息将由程序在生成后加入图片白边。

竖版 3:4，高分辨率，安全边距充足。"
`);
    expect(prompt).toContain('视觉学习者');
    expect(prompt).toContain('ARTICLE FACTS');
    expect(prompt).toContain('30%–50%');
    expect(prompt).toContain('部署后持续学习。');
    expect(prompt).toContain('下一代训练范式是什么？');
    expect(prompt).not.toContain('https://youtu.be/');
  });

  test('exports the version Task 3 uses to identify this prompt contract', () => {
    expect(INFOGRAPHIC_PROMPT_VERSION).toBe('podsum-infographic-v1');
  });

  test('caps article facts, omits empty headings, and never invents facts', () => {
    const suppliedFact = '仅此一条外部事实。';
    const prompt = buildInfographicPrompt({
      originalTitle: 'A title',
      summaryZh: `#\n##\n- ${suppliedFact}\n## 空标题\n\n${'甲'.repeat(7_000)}`,
    });

    const groundedFacts = prompt.split('ARTICLE FACTS — 只可使用以下事实：\n')[1]
      .split('\n\n采用纵向学习路径：')[0];
    expect(groundedFacts).toContain(suppliedFact);
    expect(groundedFacts).not.toContain('空标题');
    expect(groundedFacts).not.toContain('未提供的事实');
    expect(groundedFacts.length).toBeLessThanOrEqual(6_000);
  });

  test('escapes template delimiters without rewriting ordinary article facts', () => {
    const prompt = buildInfographicPrompt({
      originalTitle: 'A {{template}} title',
      summaryZh: '- keep 30%–50% exactly as supplied.',
    });

    expect(prompt).toContain('keep 30%–50% exactly as supplied.');
    expect(prompt).not.toContain('{{template}}');
  });
});
