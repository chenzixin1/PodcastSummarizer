import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'CommonJS', moduleResolution: 'node', resolveJsonModule: true } });
export const { extractLocalTopics } = require('../../lib/topicExtractor.ts');
export const { projectCompatibilityTags } = require('../../lib/topicTaxonomy.ts');
export const { getTopicTaxonomy } = require('../../lib/topicTaxonomyData.ts');
export const { buildTopicStatements } = require('../../lib/topicPersistence.ts');
export const { topicRepairPreview, TOPIC_SOURCE_SQL, TOPIC_SOURCE_FROM } = require('../../lib/topicRepair.ts');
