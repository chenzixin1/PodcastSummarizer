import fs from 'node:fs/promises';
import path from 'node:path';

const outputDir = process.env.CUTOVER_OUTPUT_DIR || path.join(process.cwd(), 'output', 'cutover');
const sourceConfigPath = process.env.WRANGLER_SOURCE_CONFIG || path.join(process.cwd(), 'wrangler.jsonc');
const productionConfigPath = path.join(outputDir, 'wrangler.production.jsonc');
const commandsPath = path.join(outputDir, 'cutover-commands.txt');
const rollbackCommandsPath = path.join(outputDir, 'rollback-commands.txt');
const productionUrl = (process.env.PRODUCTION_APP_URL || 'https://podsum.cc').replace(/\/+$/, '');
const keepPreviewRoute = process.env.CUTOVER_KEEP_PREVIEW === 'true';
const productionCrons = ['0 3 * * *', '0 4 * * *'];
const productionD1DatabaseName = process.env.PRODUCTION_D1_DATABASE_NAME || 'podsum-d1-production';
const productionD1DatabaseId = process.env.PRODUCTION_D1_DATABASE_ID || '5d0b65e0-d556-4aa4-953f-4d680d11c34a';

function relativeToOutput(targetPath) {
  return path.relative(outputDir, targetPath) || '.';
}

function routeFor(hostname) {
  return {
    pattern: hostname,
    custom_domain: true,
  };
}

async function main() {
  const sourceConfig = JSON.parse(await fs.readFile(sourceConfigPath, 'utf8'));
  const routes = [
    routeFor('podsum.cc'),
    routeFor('www.podsum.cc'),
  ];

  if (keepPreviewRoute) {
    routes.push(routeFor('cf-preview.podsum.cc'));
  }

  const productionConfig = {
    ...sourceConfig,
    $schema: relativeToOutput(path.join(process.cwd(), 'node_modules', 'wrangler', 'config-schema.json')),
    main: relativeToOutput(path.join(process.cwd(), sourceConfig.main)),
    routes,
    workers_dev: false,
    assets: {
      ...sourceConfig.assets,
      directory: relativeToOutput(path.join(process.cwd(), sourceConfig.assets.directory)),
    },
    d1_databases: [
      {
        binding: 'PODSUM_DB',
        database_name: productionD1DatabaseName,
        database_id: productionD1DatabaseId,
        migrations_dir: relativeToOutput(path.join(process.cwd(), 'migrations', 'd1')),
      },
    ],
    triggers: {
      crons: productionCrons,
    },
    vars: {
      ...sourceConfig.vars,
      DATABASE_PROVIDER: 'd1',
      DEPLOYMENT_STAGE: 'production',
      ENABLE_CRON: 'true',
      NEXTAUTH_URL: productionUrl,
      NEXT_PUBLIC_APP_URL: productionUrl,
    },
  };

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(productionConfigPath, `${JSON.stringify(productionConfig, null, 2)}\n`);

  const commands = [
    '# Review generated config first:',
    `cat ${productionConfigPath}`,
    '',
    '# Build and deploy production-domain Worker config:',
    `/bin/zsh -lc 'set -a; source .env.vercel.production; source .env.google.oauth; set +a; NEXTAUTH_URL=${productionUrl} NEXT_PUBLIC_APP_URL=${productionUrl} npm run build'`,
    `/bin/zsh -lc 'set -a; source .env.vercel.production; source .env.google.oauth; set +a; NEXTAUTH_URL=${productionUrl} NEXT_PUBLIC_APP_URL=${productionUrl} npx opennextjs-cloudflare build'`,
    `npx wrangler deploy -c ${productionConfigPath}`,
    '',
    '# After confirming podsum.cc is served by Cloudflare, rewrite historical file URLs in the database:',
    `FINAL_APP_URL=${productionUrl} R2_MANIFEST_APPLY=true npm run r2:apply-manifest`,
    '',
    '# Final verification:',
    'npm run verify:cf-production',
    '',
    '# After Cloudflare production is confirmed, disable the old Vercel cron/project path to avoid duplicate scheduled workers.',
  ].join('\n');

  await fs.writeFile(commandsPath, `${commands}\n`);

  const rollbackCommands = [
    '# Roll back historical file URLs first if R2 manifest was applied:',
    `FINAL_APP_URL=${productionUrl} R2_MANIFEST_ROLLBACK=true npm run r2:rollback-manifest`,
    '',
    '# Redeploy the preview-only Worker config to remove production custom-domain routes:',
    `/bin/zsh -lc 'set -a; source .env.vercel.production; source .env.google.oauth; set +a; NEXTAUTH_URL=https://cf-preview.podsum.cc NEXT_PUBLIC_APP_URL=https://cf-preview.podsum.cc npm run build'`,
    `/bin/zsh -lc 'set -a; source .env.vercel.production; source .env.google.oauth; set +a; NEXTAUTH_URL=https://cf-preview.podsum.cc NEXT_PUBLIC_APP_URL=https://cf-preview.podsum.cc npx opennextjs-cloudflare build'`,
    'npx wrangler deploy -c wrangler.jsonc',
    '',
    '# Confirm production has returned to Vercel and preview still works:',
    'curl -I https://podsum.cc',
    'npm run verify:cf-preview',
  ].join('\n');

  await fs.writeFile(rollbackCommandsPath, `${rollbackCommands}\n`);

  console.log(JSON.stringify({
    productionConfigPath,
    commandsPath,
    rollbackCommandsPath,
    productionUrl,
    routes: productionConfig.routes,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
