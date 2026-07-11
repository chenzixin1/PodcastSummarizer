import { extractPodcastTags, normalizeDbTags } from '../../lib/podcastTags';

describe('podcastTags', () => {
  it('does not treat YouTube as a useful topic tag', () => {
    const tags = extractPodcastTags({
      title: 'AI Agents with Lex Fridman',
      sourceReference: 'https://www.youtube.com/watch?v=abc123xyz00',
    });

    expect(tags).not.toContain('YouTube');
    expect(tags).toEqual(expect.arrayContaining(['AI', 'Agents', 'Lex', 'Fridman']));
  });

  it('filters legacy generic tags from database rows', () => {
    expect(normalizeDbTags(['YouTube', 'in', 'of', 'to', '最佳拍档', 'AI'])).toEqual(['最佳拍档', 'AI']);
  });

  it('filters noisy person fragments and generic finance words', () => {
    expect(normalizeDbTags(['Andrej', 'Andrej Karpathy', '亿美元', '负责人', 'AI Agents'])).toEqual([
      'Andrej Karpathy',
      'AI Agents',
    ]);
  });

  it('filters observed generated-summary and n-gram noise', () => {
    expect(normalizeDbTags([
      'AI AI', 'AI AI AI', '未明确提及', '执行条件', '时间点', '负责人', 'is', 'of', 'to',
      'Reinforcement Learning', 'NVIDIA',
    ])).toEqual(['Reinforcement Learning', 'NVIDIA']);
  });
});
