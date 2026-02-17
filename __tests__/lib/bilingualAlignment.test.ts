/**
 * @jest-environment node
 */

import {
  buildFullTextBilingualPayload,
  buildSummaryBilingualPayload,
  BILINGUAL_MISSING_ZH_PLACEHOLDER,
} from '../../lib/bilingualAlignment';
import {
  applyLlmFallbackToFullTextPayload,
  applyLlmFallbackToSummaryPayload,
} from '../../lib/bilingualAlignmentLlm';

describe('bilingualAlignment', () => {
  test('full text aligns by exact timestamp', () => {
    const en = '**[00:00:02]** Space data centers are emerging.\n\n**[00:00:09]** Traditional centers consume huge energy.';
    const zh = '**[00:00:02]** 太空数据中心正在出现。\n\n**[00:00:09]** 传统数据中心消耗巨大能源。';

    const payload = buildFullTextBilingualPayload(en, zh);

    expect(payload.pairs).toHaveLength(2);
    expect(payload.pairs[0].matchMethod).toBe('ts_exact');
    expect(payload.pairs[1].matchMethod).toBe('ts_exact');
    expect(payload.pairs[0].zh).toContain('太空数据中心');
    expect(payload.stats.unmatched).toBe(0);
  });

  test('full text aligns by near timestamp within window', () => {
    const en = '**[00:00:10]** First line';
    const zh = '**[00:00:12]** 第一行';

    const payload = buildFullTextBilingualPayload(en, zh, { nearWindowSec: 12 });

    expect(payload.pairs).toHaveLength(1);
    expect(payload.pairs[0].matchMethod).toBe('ts_near');
    expect(payload.pairs[0].zh).toBe('第一行');
  });

  test('full text falls back by order when timestamp is unavailable', () => {
    const en = '**[00:00:10]** First line\n\n**[00:00:22]** Second line';
    const zh = '第一行（无时间戳）\n\n第二行（无时间戳）';

    const payload = buildFullTextBilingualPayload(en, zh);

    expect(payload.pairs).toHaveLength(2);
    expect(payload.pairs[0].matchMethod).toBe('order_fallback');
    expect(payload.pairs[1].matchMethod).toBe('order_fallback');
  });

  test('full text does not reuse chinese rows across multiple english rows', () => {
    const en = '**[00:00:10]** First line\n\n**[00:00:20]** Second line';
    const zh = '**[00:00:10]** 中文第一行';

    const payload = buildFullTextBilingualPayload(en, zh);

    expect(payload.pairs).toHaveLength(2);
    expect(payload.pairs[0].zh).toBe('中文第一行');
    expect(payload.pairs[0].matchMethod).toBe('ts_exact');
    expect(payload.pairs[1].zh).toBe(BILINGUAL_MISSING_ZH_PLACEHOLDER);
    expect(payload.pairs[1].matchMethod).toBe('missing');
  });

  test('summary aligns by normalized sections and index', () => {
    const en = '# English Summary\n## Key Takeaways\n- EN 1\n- EN 2\n## Data & Numbers\n- EN 3';
    const zh = '# 中文总结\n## 核心观点\n- 中文 1\n## 关键数据\n- 中文 2\n- 中文 3';

    const payload = buildSummaryBilingualPayload(en, zh);

    expect(payload.sections.length).toBeGreaterThan(0);
    const firstSection = payload.sections[0];
    expect(firstSection.sectionKey).toBe('key_takeaways');
    expect(firstSection.pairs[0].matchMethod).toBe('section_index');
    expect(payload.stats.unmatched).toBeGreaterThanOrEqual(1);
  });

  test('llm fallback only fills missing full-text entries', async () => {
    const previousApiKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'test-key';

    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                matches: [{ order: 1, candidateId: 'zh-1', confidence: 0.88 }],
              }),
            },
          },
        ],
      }),
    } as Response);

    const payload = buildFullTextBilingualPayload('**[00:00:02]** EN line', '');
    expect(payload.pairs[0].matchMethod).toBe('missing');

    const result = await applyLlmFallbackToFullTextPayload(payload, {
      fullTextZh: '**[00:00:03]** 中文候选',
      maxMissing: 20,
    });

    expect(result.attempted).toBe(1);
    expect(result.llmMatched).toBe(1);
    expect(result.payload.pairs[0].matchMethod).toBe('llm');
    expect(result.payload.pairs[0].zh).toBe('中文候选');

    fetchMock.mockRestore();
    process.env.OPENROUTER_API_KEY = previousApiKey;
  });

  test('llm fallback fills missing summary entries only', async () => {
    const previousApiKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'test-key';

    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                matches: [{ order: 1, candidateId: 's1-i1', confidence: 0.79 }],
              }),
            },
          },
        ],
      }),
    } as Response);

    const payload = buildSummaryBilingualPayload('# English Summary\n## Key Takeaways\n- EN 1', '');
    expect(payload.sections[0].pairs[0].zh).toBe(BILINGUAL_MISSING_ZH_PLACEHOLDER);

    const result = await applyLlmFallbackToSummaryPayload(payload, {
      summaryZh: '# 中文总结\n## 核心观点\n- 中文 1',
      maxMissing: 20,
    });

    expect(result.attempted).toBe(1);
    expect(result.llmMatched).toBe(1);
    expect(result.payload.sections[0].pairs[0].matchMethod).toBe('llm');
    expect(result.payload.sections[0].pairs[0].zh).toBe('中文 1');

    fetchMock.mockRestore();
    process.env.OPENROUTER_API_KEY = previousApiKey;
  });
});
