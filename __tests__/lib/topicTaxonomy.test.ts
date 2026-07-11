import {
  buildTopicExtractionInput,
  deterministicTopicFallback,
  labelsToTopicFacets,
  parseAndValidateTopicResponse,
  projectCompatibilityTags,
  retrieveTopicCandidates,
  toTopicFacets,
  type TopicDefinition,
} from '../../lib/topicTaxonomy';
import { getTopicTaxonomy } from '../../lib/topicTaxonomyData';

const definitions: TopicDefinition[] = [
  {
    id: 'artificial-intelligence',
    canonicalName: 'Artificial Intelligence',
    facet: 'topic',
    aliases: ['AI', '人工智能'],
    keywords: ['AI', '人工智能'],
    status: 'active',
    occurrenceCount: 30,
  },
  {
    id: 'reinforcement-learning',
    canonicalName: 'Reinforcement Learning',
    facet: 'topic',
    aliases: ['RL', '强化学习'],
    keywords: ['reward model', '强化学习'],
    status: 'active',
    occurrenceCount: 4,
  },
  {
    id: 'jensen-huang',
    canonicalName: 'Jensen Huang',
    facet: 'person',
    aliases: ['黄仁勋'],
    keywords: ['Jensen Huang', '黄仁勋'],
    status: 'active',
    occurrenceCount: 2,
  },
  {
    id: 'nvidia',
    canonicalName: 'NVIDIA',
    facet: 'organization_product',
    aliases: ['英伟达', 'Nvidia'],
    keywords: ['CUDA', 'GPU'],
    status: 'active',
    occurrenceCount: 5,
  },
  {
    id: 'ai-safety',
    canonicalName: 'AI Safety',
    facet: 'topic',
    aliases: ['AI安全'],
    keywords: ['AI alignment', '模型对齐'],
    status: 'active',
    occurrenceCount: 2,
  },
  {
    id: 'youtube',
    canonicalName: 'YouTube',
    facet: 'organization_product',
    aliases: [],
    keywords: ['YouTube'],
    status: 'blocked',
    occurrenceCount: 0,
  },
];

describe('topicTaxonomy', () => {
  it('loads a unique English-first production taxonomy', () => {
    const taxonomy = getTopicTaxonomy();
    expect(taxonomy.length).toBeGreaterThan(80);
    expect(new Set(taxonomy.map((definition) => definition.id)).size).toBe(taxonomy.length);
    expect(taxonomy.find((definition) => definition.id === 'reinforcement-learning')).toEqual(
      expect.objectContaining({ canonicalName: 'Reinforcement Learning', facet: 'topic', status: 'active' }),
    );
    expect(taxonomy.find((definition) => definition.id === 'youtube')).toEqual(
      expect.objectContaining({ status: 'blocked' }),
    );
  });

  it('builds extraction input from high-signal summary sections only', () => {
    const input = buildTopicExtractionInput({
      title: 'Jensen Huang on AI systems',
      briefSummary: '黄仁勋讨论英伟达如何训练开放模型。',
      summaryZh: `# 中文总结
## 核心观点
- 强化学习能让AI从经验中学习。
- NVIDIA构建开放模型。
## 关键数据
- 未明确提及
## 决策与行动项
- 负责人：未明确提及；时间点：未明确提及。`,
    });

    expect(input).toContain('强化学习能让AI从经验中学习');
    expect(input).not.toContain('未明确提及');
    expect(input).not.toContain('负责人');
    expect(input).not.toContain('时间点');
  });

  it('retrieves canonical definitions through English and Chinese aliases', () => {
    const candidates = retrieveTopicCandidates(
      definitions,
      '黄仁勋认为英伟达应使用强化学习构建 AI systems',
    );

    expect(candidates.map((candidate) => candidate.definition.id)).toEqual(
      expect.arrayContaining(['jensen-huang', 'nvidia', 'reinforcement-learning', 'artificial-intelligence']),
    );
    expect(candidates.map((candidate) => candidate.definition.id)).not.toContain('youtube');
  });

  it('validates strict model output and rejects noise, unknown ids, and invented evidence', () => {
    const input = 'Jensen Huang says NVIDIA uses reinforcement learning for AI systems.';
    const result = parseAndValidateTopicResponse(
      JSON.stringify({
        selected: [
          { topicId: 'jensen-huang', facet: 'person', confidence: 0.96, evidence: 'Jensen Huang' },
          { topicId: 'nvidia', facet: 'organization_product', confidence: 0.94, evidence: 'NVIDIA' },
          { topicId: 'reinforcement-learning', facet: 'topic', confidence: 0.9, evidence: 'reinforcement learning' },
          { topicId: 'youtube', facet: 'organization_product', confidence: 0.99, evidence: 'NVIDIA' },
          { topicId: 'unknown', facet: 'topic', confidence: 0.99, evidence: 'AI systems' },
          { topicId: 'artificial-intelligence', facet: 'topic', confidence: 0.9, evidence: 'not in source' },
          { topicId: 'ai-safety', facet: 'topic', confidence: 0.9, evidence: 'AI systems' },
        ],
        proposed: [
          { canonicalName: 'AI AI', facet: 'topic', aliases: [], confidence: 0.99, evidence: 'AI' },
        ],
      }),
      definitions,
      input,
    );

    expect(result.assignments.map((assignment) => assignment.topicId)).toEqual([
      'jensen-huang',
      'nvidia',
      'reinforcement-learning',
    ]);
    expect(result.proposals).toEqual([]);
    expect(result.rejections).toEqual(expect.objectContaining({
      blocked: 1,
      unknown: 1,
      evidence: 1,
      semantic_support: 1,
      proposal_noise: 1,
    }));
  });

  it('falls back to deterministic evidence-backed assignments without padding', () => {
    const assignments = deterministicTopicFallback(
      definitions,
      '黄仁勋表示 NVIDIA 将使用强化学习改进 AI。',
    );

    expect(assignments.map((assignment) => assignment.topicId)).toEqual(
      expect.arrayContaining(['jensen-huang', 'nvidia', 'reinforcement-learning', 'artificial-intelligence']),
    );
    expect(assignments).toHaveLength(4);
    expect(assignments.every((assignment) => assignment.extractionSource === 'deterministic_fallback')).toBe(true);
  });

  it('groups canonical labels by facet', () => {
    const assignments = deterministicTopicFallback(
      definitions,
      'Jensen Huang says NVIDIA uses reinforcement learning for AI.',
    );

    expect(toTopicFacets(assignments, definitions)).toEqual({
      topics: expect.arrayContaining(['Artificial Intelligence', 'Reinforcement Learning']),
      people: ['Jensen Huang'],
      organizationsProducts: ['NVIDIA'],
    });
  });

  it('projects structured assignments to legacy tags and reconstructs grouped facets', () => {
    const assignments = deterministicTopicFallback(
      definitions,
      'Jensen Huang says NVIDIA uses reinforcement learning for AI.',
    );
    const labels = projectCompatibilityTags(assignments, definitions);

    expect(labels).toEqual(expect.arrayContaining(['Reinforcement Learning', 'Jensen Huang', 'NVIDIA']));
    expect(labelsToTopicFacets(labels, definitions)).toEqual({
      topics: expect.arrayContaining(['Artificial Intelligence', 'Reinforcement Learning']),
      people: ['Jensen Huang'],
      organizationsProducts: ['NVIDIA'],
    });
  });
});
