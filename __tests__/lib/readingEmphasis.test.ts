import { remarkReadingEmphasis } from '../../lib/readingEmphasis';

type Node = { type: string; value?: string; url?: string; children?: Node[] };
const text = (node: Node): string => node.value ?? node.children?.map(text).join('') ?? '';
const strong = (node: Node): string[] => node.type === 'strong' ? [text(node)] : node.children?.flatMap(strong) ?? [];
const paragraph = (value: string): Node => ({ type: 'paragraph', children: [{ type: 'text', value }] });
const apply = (node: Node) => { remarkReadingEmphasis()(node); return node; };

describe('display-only Full Text reading emphasis', () => {
  test.each([
    '我们讨论模型能力的进步，同时认真评估新的安全风险。原话继续完整保留，不会改成摘要，也不会删掉说话人的限定条件。',
    'We discussed reinforcement learning and how the experiments work. Every original word and all the surrounding context remain here for careful reading.',
    'Sam: AI is changing our work.\n山姆：模型能力的变化非常明显，不过所有尚未确定的事情依然需要认真验证和讨论。',
    'The company discussed cash flow in detail and explained the reasons for changes in the past year. The conversation includes its original qualifications.',
    '他们讨论了临床试验的结果，并且详细解释了研究方法和目前仍然存在的限制，没有得出任何超出当前证据能够支持的结论。',
  ])('preserves every original character: %s', value => {
    const node = apply(paragraph(value));
    expect(text(node)).toBe(value);
    expect(strong(node).length).toBeGreaterThan(0);
  });

  test('does not invent Chinese word boundaries or highlight generic English short words', () => {
    const node = apply(paragraph('我们仍在考虑我们应该如何讨论这件事情。 The people can think about all of this and have a conversation.'));
    expect(strong(node)).toEqual([]);
  });

  test('keeps code, ordinary links, timestamps and existing emphasis intact', () => {
    const children: Node[] = [
      { type: 'strong', children: [{ type: 'text', value: 'AI' }] },
      { type: 'inlineCode', value: 'AI' },
      { type: 'link', url: 'https://example.com/AI', children: [{ type: 'text', value: 'AI' }] },
      { type: 'strong', children: [{ type: 'text', value: '[00:00:12]' }] },
    ];
    const before = JSON.stringify(children);
    apply({ type: 'paragraph', children });
    expect(JSON.stringify(children)).toBe(before);
  });

  test('vocabulary link remains clickable and pronounceable around an emphasized term', () => {
    const link: Node = { type: 'link', url: '#pronounce:alignment', children: [{ type: 'text', value: 'alignment' }] };
    const node = apply({ type: 'paragraph', children: [{ type: 'text', value: 'We discussed the important problem of ' }, link, { type: 'text', value: ' while preserving the actual words of the interview and its complete context.' }] });
    expect(link.url).toBe('#pronounce:alignment');
    expect(strong(link)).toEqual(['alignment']);
    expect(text(node)).toContain('problem of alignment while');
  });

  test('caps new emphasis and avoids repeating the same keyword throughout a paragraph', () => {
    const value = 'AI GPT AGI LLM API GPU CPU RAM AI GPT AGI LLM API GPU CPU RAM. '.repeat(8);
    const node = apply(paragraph(value));
    expect(strong(node).length).toBeLessThanOrEqual(6);
    expect(new Set(strong(node)).size).toBe(strong(node).length);
    expect(strong(node).join('').length).toBeLessThanOrEqual(value.length * .18);
    const first = JSON.stringify(node);
    apply(node);
    // Existing emphasis remains non-nested even if another rendering pass runs.
    expect(text(node)).toBe(value);
    expect(first).toContain('strong');
  });
});
