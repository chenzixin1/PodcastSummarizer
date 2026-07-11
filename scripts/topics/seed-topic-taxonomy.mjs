import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const taxonomy = JSON.parse(fs.readFileSync(path.join(root, 'data/topics/taxonomy.v1.json'), 'utf8'));
const configArg = process.argv.find((value) => value.startsWith('--config='));
const config = configArg ? configArg.slice('--config='.length) : 'wrangler.preview.jsonc';
const bindingArg = process.argv.find((value) => value.startsWith('--binding='));
const binding = bindingArg ? bindingArg.slice('--binding='.length) : 'PODSUM_DB';

function quote(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

const statements = [];
for (const definition of taxonomy) {
  statements.push(`INSERT INTO topic_definitions (
    id, canonical_name, facet, aliases_json, parent_id, keywords_json, status, occurrence_count, updated_at
  ) VALUES (
    ${quote(definition.id)}, ${quote(definition.canonicalName)}, ${quote(definition.facet)},
    ${quote(JSON.stringify(definition.aliases || []))}, ${quote(definition.parentId || null)},
    ${quote(JSON.stringify(definition.keywords || []))}, ${quote(definition.status)}, 0, CURRENT_TIMESTAMP
  ) ON CONFLICT (id) DO UPDATE SET
    canonical_name = excluded.canonical_name,
    facet = excluded.facet,
    aliases_json = excluded.aliases_json,
    parent_id = excluded.parent_id,
    keywords_json = excluded.keywords_json,
    status = excluded.status,
    updated_at = CURRENT_TIMESTAMP;`);
}

const tempFile = path.join(os.tmpdir(), `podsum-topic-taxonomy-${Date.now()}.sql`);
fs.writeFileSync(tempFile, statements.join('\n'));
try {
  execFileSync('npx', [
    'wrangler', 'd1', 'execute', binding, '--remote', '--config', config, '--file', tempFile, '--yes',
  ], { cwd: root, stdio: 'inherit' });
  const result = execFileSync('npx', [
    'wrangler', 'd1', 'execute', binding, '--remote', '--config', config,
    '--command', "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active FROM topic_definitions",
    '--json',
  ], { cwd: root, encoding: 'utf8' });
  console.log(result.trim());
} finally {
  fs.rmSync(tempFile, { force: true });
}
