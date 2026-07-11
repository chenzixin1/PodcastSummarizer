import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const taxonomy = JSON.parse(fs.readFileSync(path.join(root, 'data/topics/taxonomy.v1.json'), 'utf8'));
const backfill = JSON.parse(fs.readFileSync(path.join(root, 'data/topics/backfill.v1.json'), 'utf8'));
const apply = process.argv.includes('--apply');
const configArg = process.argv.find((value) => value.startsWith('--config='));
const config = configArg ? configArg.slice('--config='.length) : 'wrangler.jsonc';
const bindingArg = process.argv.find((value) => value.startsWith('--binding='));
const binding = bindingArg ? bindingArg.slice('--binding='.length) : 'PODSUM_DB';
const expectedArg = process.argv.find((value) => value.startsWith('--expected-count='));
const expectedCount = expectedArg ? Number(expectedArg.slice('--expected-count='.length)) : backfill.length;

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runWrangler(args, options = {}) {
  return execFileSync('npx', ['wrangler', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
}

function queryRemote(command) {
  const output = runWrangler([
    'd1', 'execute', binding, '--remote', '--config', config, '--command', command, '--json',
  ]);
  const payload = JSON.parse(output);
  return payload.flatMap((entry) => entry.results || []);
}

function validateManifest(liveRows) {
  const errors = [];
  const definitionById = new Map();
  for (const definition of taxonomy) {
    if (definitionById.has(definition.id)) errors.push(`duplicate taxonomy id: ${definition.id}`);
    definitionById.set(definition.id, definition);
  }
  const liveIds = new Set(liveRows.map((row) => String(row.id)));
  const manifestIds = new Set();
  for (const row of backfill) {
    if (manifestIds.has(row.podcastId)) errors.push(`duplicate podcast id: ${row.podcastId}`);
    manifestIds.add(row.podcastId);
    if (!liveIds.has(row.podcastId)) errors.push(`manifest podcast missing from live database: ${row.podcastId}`);
    const counts = { topic: 0, person: 0, organization_product: 0 };
    const relationIds = new Set();
    for (const topicId of row.topicIds) {
      if (relationIds.has(topicId)) errors.push(`duplicate topic ${topicId} for ${row.podcastId}`);
      relationIds.add(topicId);
      const definition = definitionById.get(topicId);
      if (!definition) {
        errors.push(`unknown topic ${topicId} for ${row.podcastId}`);
        continue;
      }
      if (definition.status !== 'active') errors.push(`inactive topic ${topicId} for ${row.podcastId}`);
      counts[definition.facet] += 1;
    }
    if (row.topicIds.length > 12) errors.push(`more than 12 topics for ${row.podcastId}`);
    if (counts.topic > 6 || counts.person > 3 || counts.organization_product > 4) {
      errors.push(`facet quota exceeded for ${row.podcastId}: ${JSON.stringify(counts)}`);
    }
  }
  for (const id of liveIds) {
    if (!manifestIds.has(id)) errors.push(`live podcast missing from manifest: ${id}`);
  }
  if (liveRows.length !== expectedCount) errors.push(`expected ${expectedCount} live podcasts, found ${liveRows.length}`);
  if (backfill.length !== expectedCount) errors.push(`expected ${expectedCount} manifest rows, found ${backfill.length}`);
  return { errors, definitionById };
}

function buildApplySql(liveRows, definitionById) {
  const liveById = new Map(liveRows.map((row) => [String(row.id), row]));
  const statements = [];
  for (const definition of taxonomy) {
    statements.push(`INSERT INTO topic_definitions (
      id, canonical_name, facet, aliases_json, parent_id, keywords_json, status, occurrence_count, updated_at
    ) VALUES (
      ${sqlString(definition.id)}, ${sqlString(definition.canonicalName)}, ${sqlString(definition.facet)},
      ${sqlString(JSON.stringify(definition.aliases || []))}, ${sqlString(definition.parentId || null)},
      ${sqlString(JSON.stringify(definition.keywords || []))}, ${sqlString(definition.status)}, 0, CURRENT_TIMESTAMP
    ) ON CONFLICT (id) DO UPDATE SET
      canonical_name = excluded.canonical_name,
      facet = excluded.facet,
      aliases_json = excluded.aliases_json,
      parent_id = excluded.parent_id,
      keywords_json = excluded.keywords_json,
      status = excluded.status,
      updated_at = CURRENT_TIMESTAMP;`);
  }
  statements.push('DELETE FROM podcast_topics;');
  for (const row of backfill) {
    const live = liveById.get(row.podcastId);
    const evidence = String(live?.title || row.podcastId).slice(0, 240);
    const labels = row.topicIds.map((id) => definitionById.get(id).canonicalName);
    for (const [index, topicId] of row.topicIds.entries()) {
      const score = Math.max(0.65, 0.98 - index * 0.025).toFixed(3);
      statements.push(`INSERT INTO podcast_topics (
        podcast_id, topic_id, relevance_score, evidence, extraction_source, extractor_version
      ) VALUES (
        ${sqlString(row.podcastId)}, ${sqlString(topicId)}, ${score}, ${sqlString(evidence)},
        'codex_backfill', 'topic-taxonomy-v1'
      );`);
    }
    statements.push(`UPDATE podcasts SET tags_json = ${sqlString(JSON.stringify(labels))} WHERE id = ${sqlString(row.podcastId)};`);
  }
  statements.push(`UPDATE topic_definitions SET occurrence_count = (
    SELECT COUNT(*) FROM podcast_topics WHERE podcast_topics.topic_id = topic_definitions.id
  ), updated_at = CURRENT_TIMESTAMP;`);
  return statements.join('\n');
}

function computeAudit(liveRows, definitionById) {
  const occurrences = new Map();
  const facets = { topic: 0, person: 0, organization_product: 0 };
  let relations = 0;
  for (const row of backfill) {
    for (const topicId of row.topicIds) {
      relations += 1;
      occurrences.set(topicId, (occurrences.get(topicId) || 0) + 1);
      facets[definitionById.get(topicId).facet] += 1;
    }
  }
  const legacyTags = new Set();
  for (const row of liveRows) {
    try {
      for (const value of JSON.parse(row.tags_json || '[]')) legacyTags.add(String(value));
    } catch {}
  }
  return {
    generatedAt: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    productionPodcasts: liveRows.length,
    manifestPodcasts: backfill.length,
    emptyAssignments: backfill.filter((row) => row.topicIds.length === 0).map((row) => row.podcastId),
    taxonomyDefinitions: taxonomy.length,
    activeDefinitions: taxonomy.filter((definition) => definition.status === 'active').length,
    legacyUniqueLabels: legacyTags.size,
    newUsedLabels: occurrences.size,
    relations,
    facetRelations: facets,
    singletonLabels: [...occurrences.values()].filter((count) => count === 1).length,
    topLabels: [...occurrences.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([id, count]) => ({ id, name: definitionById.get(id).canonicalName, count })),
  };
}

const liveRows = queryRemote('SELECT id, title, tags_json FROM podcasts ORDER BY created_at DESC');
const { errors, definitionById } = validateManifest(liveRows);
if (errors.length > 0) {
  console.error(JSON.stringify({ ok: false, errors }, null, 2));
  process.exit(1);
}

const audit = computeAudit(liveRows, definitionById);
if (!apply) {
  console.log(JSON.stringify({ ok: true, ...audit }, null, 2));
  process.exit(0);
}

const outputDir = path.join(root, 'output/topics');
fs.mkdirSync(outputDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(outputDir, `pre-backfill-${stamp}.json`);
fs.writeFileSync(backupPath, JSON.stringify(liveRows.map((row) => ({ id: row.id, tags: row.tags_json })), null, 2));

runWrangler(['d1', 'migrations', 'apply', binding, '--remote', '--config', config, '--yes'], { inherit: true });
const sqlPath = path.join(outputDir, `apply-${stamp}.sql`);
fs.writeFileSync(sqlPath, buildApplySql(liveRows, definitionById));
try {
  runWrangler(['d1', 'execute', binding, '--remote', '--config', config, '--file', sqlPath, '--yes'], { inherit: true });
} finally {
  fs.rmSync(sqlPath, { force: true });
}

const verified = queryRemote(`SELECT
  (SELECT COUNT(*) FROM podcasts) AS podcast_count,
  (SELECT COUNT(DISTINCT podcast_id) FROM podcast_topics) AS covered_count,
  (SELECT COUNT(*) FROM podcast_topics) AS relation_count,
  (SELECT COUNT(*) FROM topic_definitions WHERE status = 'active') AS active_definition_count`)[0];
const auditPath = path.join(outputDir, `post-backfill-${stamp}.json`);
fs.writeFileSync(auditPath, JSON.stringify({ ...audit, backupPath, verified }, null, 2));
console.log(JSON.stringify({ ok: true, backupPath, auditPath, verified }, null, 2));
