import taxonomy from '../../data/topics/taxonomy.v1.json';
import backfill from '../../data/topics/backfill.v1.json';

describe('topic backfill manifests', () => {
  it('covers the complete production inventory exactly once', () => {
    expect(backfill).toHaveLength(75);
    expect(new Set(backfill.map((row) => row.podcastId)).size).toBe(75);
  });

  it('references active definitions and respects facet quotas', () => {
    const definitions = new Map(taxonomy.map((definition) => [definition.id, definition]));
    for (const row of backfill) {
      expect(new Set(row.topicIds).size).toBe(row.topicIds.length);
      expect(row.topicIds.length).toBeLessThanOrEqual(12);
      const counts = { topic: 0, person: 0, organization_product: 0 };
      for (const id of row.topicIds) {
        const definition = definitions.get(id);
        expect(definition).toBeDefined();
        expect(definition?.status).toBe('active');
        if (definition) counts[definition.facet as keyof typeof counts] += 1;
      }
      expect(counts.topic).toBeLessThanOrEqual(6);
      expect(counts.person).toBeLessThanOrEqual(3);
      expect(counts.organization_product).toBeLessThanOrEqual(4);
    }
  });

  it('contains none of the observed legacy noise labels', () => {
    const blocked = new Set(['AI AI', 'AI AI AI', 'is', 'of', 'to', 'YouTube', '未明确提及', '执行条件', '时间点', '负责人']);
    for (const definition of taxonomy.filter((item) => item.status === 'active')) {
      expect(blocked.has(definition.canonicalName)).toBe(false);
    }
  });
});
