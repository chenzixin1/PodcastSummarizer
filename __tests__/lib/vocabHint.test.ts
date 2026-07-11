import {
  annotateEnglishWithHints,
  buildHintDictionaryCard,
  buildFullTextBilingualMarkdown,
  buildSummaryBilingualMarkdown,
  emphasizeSummaryMarkdown,
  extractHintCandidates,
  stripPronunciationLinks,
  type AdvancedWordDict,
} from '../../lib/vocabHint';

describe('vocabHint helpers', () => {
  test('buildSummaryBilingualMarkdown pairs english/chinese lines', () => {
    const en = '# English Summary\n## Key Takeaways\n- First point\n- Second point';
    const zh = '# 中文总结\n## 核心观点\n- 第一条\n- 第二条';

    const output = buildSummaryBilingualMarkdown(en, zh);

    expect(output).toContain('First point');
    expect(output).toContain('\n第一条\n');
    expect(output).toContain('\n---\n');
    expect(output).toContain('Second point');
    expect(output).toContain('\n第二条\n');
  });

  test('buildFullTextBilingualMarkdown aligns by timestamp', () => {
    const en = '**[00:00:02]** Space data centers are emerging.\n\n**[00:00:09]** Traditional centers consume huge energy.';
    const zh = '**[00:00:02]** 太空数据中心正在出现。\n\n**[00:00:09]** 传统数据中心消耗巨大能源。';

    const output = buildFullTextBilingualMarkdown(en, zh);

    expect(output).toContain('**[00:00:02]** Space data centers are emerging.');
    expect(output).toContain('\n太空数据中心正在出现。\n');
    expect(output).toContain('\n---\n');
    expect(output).toContain('**[00:00:09]** Traditional centers consume huge energy.');
    expect(output).toContain('\n传统数据中心消耗巨大能源。\n');
  });

  test('annotateEnglishWithHints adds chinese gloss and avoids duplicate hint in one paragraph', () => {
    const dict: AdvancedWordDict = {
      terrestrial: { zh: '地球上的' },
      infrastructure: { zh: '基础设施' },
    };

    const input = 'Terrestrial infrastructure needs upgrades. Terrestrial systems evolve slowly.';
    const output = annotateEnglishWithHints(input, dict, { maxHintsPerParagraph: 8 });

    expect(output).toContain('Terrestrial（地球上的） infrastructure（基础设施） needs upgrades.');
    expect(output).toContain('Terrestrial systems evolve slowly.');
  });

  test('annotateEnglishWithHints annotates hard fallback words that are missing from the dictionary', () => {
    const input = 'The agent keeps working despite errors, mistakes, and ambiguity.';
    const output = annotateEnglishWithHints(input, {}, { maxHintsPerParagraph: 8 });

    expect(output).toContain('ambiguity（歧义）');
  });

  test('annotateEnglishWithHints ranks hard words across the whole paragraph before applying the limit', () => {
    const dict: AdvancedWordDict = {
      verifiable: { zh: '可验证的' },
      reinforcement: { zh: '强化' },
      creation: { zh: '创造' },
      artificial: { zh: '人工的' },
    };
    const input =
      'A research bet is that verifiable tasks across Reinforcement Learning environments will lead to the creation of Artificial General Intelligence, even in the face of ambiguity.';
    const output = annotateEnglishWithHints(input, dict, {
      maxHintsPerParagraph: 3,
      interactionMode: 'pronounceLink',
    });

    expect(output).toContain('[ambiguity](#pronounce:ambiguity)');
  });

  test('extractHintCandidates keeps hard fallback vocabulary missing from the dictionary', () => {
    const output = extractHintCandidates('Open-ended tasks can still include ambiguity.', {}, { maxHintsPerParagraph: 4 });

    expect(output.some((item) => item.word === 'ambiguity')).toBe(true);
  });

  test('emphasizeSummaryMarkdown bolds key summary phrases without touching existing markdown', () => {
    const input = '- AI agents improve through continual learning and in-context learning across millions of verifiable tasks.\n- 已有**重点**不应重复处理。';
    const output = emphasizeSummaryMarkdown(input);

    expect(output).toContain('**AI**');
    expect(output).toContain('**continual learning**');
    expect(output).toContain('**in-context learning**');
    expect(output).toContain('**millions**');
    expect(output).toContain('**verifiable tasks**');
    expect(output).toContain('已有**重点**不应重复处理。');
  });

  test('annotateEnglishWithHints does not annotate urls', () => {
    const dict: AdvancedWordDict = {
      infrastructure: { zh: '基础设施' },
    };

    const input = 'Visit https://example.com/infrastructure for details about infrastructure.';
    const output = annotateEnglishWithHints(input, dict, { maxHintsPerParagraph: 8 });

    expect(output).toContain('https://example.com/infrastructure');
    expect(output).toContain('infrastructure（基础设施）.');
    expect(output).not.toContain('https://example.com/infrastructure（');
  });

  test('extractHintCandidates filters simple words and keeps advanced words', () => {
    const dict: AdvancedWordDict = {
      summary: { zh: '总结' },
      infrastructure: { zh: '基础设施', level: ['IELTS'] },
    };
    const input = 'Summary of orbital infrastructure in space.';
    const output = extractHintCandidates(input, dict, { maxHintsPerParagraph: 4, maxCandidates: 10 });

    expect(output.find((item) => item.word === 'summary')).toBeUndefined();
    expect(output.find((item) => item.word === 'infrastructure')).toBeTruthy();
  });

  test('annotateEnglishWithHints can emit pronounce links', () => {
    const dict: AdvancedWordDict = {
      terrestrial: { zh: '地球上的' },
      infrastructure: { zh: '基础设施' },
    };
    const hints = {
      terrestrial: '地面端的',
      infrastructure: '底层设施',
    };

    const input = 'Terrestrial infrastructure evolves rapidly.';
    const output = annotateEnglishWithHints(input, dict, {
      maxHintsPerParagraph: 3,
      generatedHints: hints,
      requireGeneratedHints: true,
      interactionMode: 'pronounceLink',
    });

    expect(output).toContain('[Terrestrial](#pronounce:terrestrial)');
    expect(output).toContain('[infrastructure](#pronounce:infrastructure)');
  });

  test('stripPronunciationLinks removes pronounce:// wrappers for copy', () => {
    const input = '[Terrestrial](#pronounce:terrestrial) systems.';
    const output = stripPronunciationLinks(input);
    expect(output).toBe('Terrestrial systems.');
  });

  test('buildHintDictionaryCard extracts part-of-speech and senses', () => {
    const card = buildHintDictionaryCard('terrestrial', {
      zh: 'adj. 陆地的；地球上的；n. 陆地生物',
    });

    expect(card).toBeTruthy();
    expect(card?.word).toBe('terrestrial');
    expect(card?.posSummary.join(' ')).toContain('adj.');
    expect(card?.senses.some((item) => item.meaning.includes('陆地'))).toBe(true);
  });
});
