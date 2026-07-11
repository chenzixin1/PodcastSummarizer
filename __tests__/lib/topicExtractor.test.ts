import { extractStructuredTopics } from '../../lib/topicExtractor';

describe('topicExtractor', () => {
  it('uses one structured model call and returns canonical assignments', async () => {
    const callModel = jest.fn(async () => JSON.stringify({
      selected: [
        { topicId: 'ai-agents', facet: 'topic', confidence: 0.94, evidence: 'AI agents' },
        { topicId: 'jensen-huang', facet: 'person', confidence: 0.97, evidence: 'Jensen Huang' },
        { topicId: 'nvidia', facet: 'organization_product', confidence: 0.96, evidence: 'NVIDIA' },
      ],
      proposed: [],
    }));

    const result = await extractStructuredTopics({
      title: 'Jensen Huang explains why NVIDIA needs open AI agents',
      briefSummary: 'The company is building open agent systems.',
    }, callModel);

    expect(callModel).toHaveBeenCalledTimes(1);
    expect(result.usedFallback).toBe(false);
    expect(result.assignments.map((assignment) => assignment.topicId)).toEqual([
      'ai-agents',
      'jensen-huang',
      'nvidia',
    ]);
  });

  it('uses deterministic assignments when the model fails', async () => {
    const result = await extractStructuredTopics({
      title: 'Jensen Huang explains NVIDIA AI agents',
      briefSummary: 'NVIDIA is building AI agents.',
    }, async () => {
      throw new Error('timeout');
    });

    expect(result.usedFallback).toBe(true);
    expect(result.assignments.map((assignment) => assignment.topicId)).toEqual(
      expect.arrayContaining(['ai-agents', 'jensen-huang', 'nvidia']),
    );
  });

  it('uses deterministic assignments when every model selection is invalid', async () => {
    const result = await extractStructuredTopics({
      title: 'NVIDIA builds AI agents',
    }, async () => '{"selected":[{"topicId":"unknown","facet":"topic","confidence":1,"evidence":"NVIDIA"}]}');

    expect(result.usedFallback).toBe(true);
    expect(result.assignments.map((assignment) => assignment.topicId)).toEqual(
      expect.arrayContaining(['ai-agents', 'nvidia']),
    );
  });
});
