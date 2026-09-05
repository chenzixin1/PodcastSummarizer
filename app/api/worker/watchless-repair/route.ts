import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { isWorkerAuthorizedBySecret } from '../../../../lib/workerAuth';
import { getPodcast, getAnalysisResults } from '../../../../lib/db';
import { getStoredWatchlessPublication, loadStoredWatchlessArticle } from '../../../../lib/watchless/repository';
import { projectWatchlessFullText } from '../../../../lib/watchless/analysisProjection';
import { canonicalWatchlessSource } from '../../../../lib/watchless/bundleIntegrity';
import { assertBilingualArticle, ensureBilingualArticle, translateWatchlessBlocks } from '../../../../lib/watchless/bilingual';
import { uploadObject } from '../../../../lib/objectStorage';
import { enqueueProcessingJob } from '../../../../lib/processingJobs';
import { refreshSnapshotsForPodcastMutation } from '../../../../lib/staticSnapshotHooks';
import { readWatchlessCheckpoint, watchlessDatabase } from '../../../../lib/watchless/analysisGuard';
import { validateAnalysisBundle } from '../../../../lib/watchless/fullAnalysis';

/** Operator-only, one article per request. No bulk defaults; old rows and article references are backed up first. */
export async function POST(request: NextRequest) {
  if (!isWorkerAuthorizedBySecret(request.headers.get('x-worker-secret'))) {
    return NextResponse.json({ success: false }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (typeof body?.id !== 'string' || !['inspect', 'project', 'bilingual', 'enqueue'].includes(body?.action)) {
    return NextResponse.json({ success: false, error: 'Provide one id and an explicit repair action' }, { status: 400 });
  }
  try {
    const publication = await getStoredWatchlessPublication(body.id);
    if (!publication) return NextResponse.json({ success: false }, { status: 404 });
    let article = await loadStoredWatchlessArticle(publication);
    if (body.action === 'inspect') return NextResponse.json({ success: true, data: {
      id: body.id, scenes: article.scenes.length, modes: article.availableLanguageModes,
      sourceBytes: new TextEncoder().encode(canonicalWatchlessSource(article)).length,
      sourceSha256: createHash('sha256').update(canonicalWatchlessSource(article)).digest('hex'),
    } });
    const db = watchlessDatabase();
    const stamp = randomUUID();
    const backupPrefix = `watchless-runs/repair/${body.id}/${stamp}`;
    const [podcast, analysis] = await Promise.all([getPodcast(body.id), getAnalysisResults(body.id)]);
    if (!podcast.success) throw new Error('Podcast missing');
    if (!analysis.success) throw new Error(analysis.error || 'Unable to back up current analysis');
    await uploadObject(`${backupPrefix}/before.json`, JSON.stringify({ publication, podcast: podcast.data, analysis: analysis.data, article }), { contentType: 'application/json' });
    const originalSource = canonicalWatchlessSource(article);
    const assertCurrentPublication = async () => {
      const current = await db.prepare("SELECT podcast_id FROM watchless_publications WHERE podcast_id = ? AND article_key = ? AND status = 'published'")
        .bind(body.id, publication.articleKey).all();
      if (!current.results?.length) throw new Error('Publication changed during repair');
    };
    if (body.action === 'bilingual') {
      article = await ensureBilingualArticle(article, async (blocks, target) => {
        await assertCurrentPublication();
        const model = process.env.WATCHLESS_MODEL || '@cf/zai-org/glm-5.3-flash';
        const hash = createHash('sha256').update(JSON.stringify({ version: 1, model, blocks, target })).digest('hex');
        const cacheKey = `watchless-runs/repair-cache/${article.id}/${hash}.json`;
        const cached = await readWatchlessCheckpoint(cacheKey);
        if (cached !== undefined) {
          if (!Array.isArray(cached) || cached.length !== blocks.length || cached.some(text => typeof text !== 'string' || !text.trim())) {
            throw new Error('Invalid repair translation checkpoint');
          }
          return cached as string[];
        }
        await assertCurrentPublication();
        const translated = await translateWatchlessBlocks(blocks, target);
        if (translated.length !== blocks.length || translated.some(text => !text.trim())) throw new Error('Incomplete repair translation');
        await uploadObject(cacheKey, JSON.stringify(translated), { contentType: 'application/json' });
        return translated;
      });
    }
    assertBilingualArticle(article);
    if (canonicalWatchlessSource(article) !== originalSource) throw new Error('Repair attempted to change the original transcript');
    if (body.action === 'enqueue') {
      const queued = await enqueueProcessingJob(body.id);
      if (!queued.success) throw new Error(queued.error || 'Queue failed');
      return NextResponse.json({ success: true, data: { id: body.id, queued: true, backupPrefix } });
    }
    const projection = projectWatchlessFullText(article);
    const nextPrefix = `watchless/${publication.videoId}/repair-${stamp}`;
    const nextArticleKey = `${nextPrefix}/article.json`;
    // Keep verified MCP analysis attached when only its presentation/translation changes.
    const supplied = await readWatchlessCheckpoint(publication.articleKey.replace(/[^/]+$/, 'analysis.json'));
    if (supplied !== undefined) {
      validateAnalysisBundle(supplied, article.scenes.map(scene => scene.id));
      await uploadObject(`${nextPrefix}/analysis.json`, JSON.stringify(supplied), { contentType: 'application/json' });
    }
    await uploadObject(nextArticleKey, JSON.stringify(article), { contentType: 'application/json' });
    const uploaded = await uploadObject(`${nextPrefix}/transcript.txt`, originalSource, { contentType: 'text/plain; charset=utf-8' });
    // A unique article key is the commit marker. All rows switch together; a lost CAS writes nothing.
    const committed = await db.batch([
      db.prepare(`UPDATE watchless_publications SET article_key = ?, has_english_transcript = 1, updated_at = CURRENT_TIMESTAMP
        WHERE podcast_id = ? AND article_key = ? AND status = 'published'
          AND EXISTS (SELECT 1 FROM podcasts p JOIN analysis_results a ON a.podcast_id = p.id WHERE p.id = ?)
        RETURNING podcast_id`).bind(nextArticleKey, body.id, publication.articleKey, body.id),
      db.prepare(`UPDATE analysis_results SET translation = ?, highlights = ?, full_text_bilingual_json = ?,
        bilingual_alignment_version = 1, processed_at = CURRENT_TIMESTAMP
        WHERE podcast_id = ? AND EXISTS (SELECT 1 FROM watchless_publications WHERE podcast_id = ? AND article_key = ?)`)
        .bind(projection.translation, projection.highlights, JSON.stringify(projection.fullTextBilingualJson), body.id, body.id, nextArticleKey),
      db.prepare(`UPDATE podcasts SET original_filename = ?, file_size = ?, blob_url = ?
        WHERE id = ? AND EXISTS (SELECT 1 FROM watchless_publications WHERE podcast_id = ? AND article_key = ?)`)
        .bind(`${publication.videoId}.txt`, `${new TextEncoder().encode(originalSource).length} bytes`, uploaded.url, body.id, body.id, nextArticleKey),
      db.prepare(`DELETE FROM qa_context_chunks WHERE podcast_id = ?
        AND EXISTS (SELECT 1 FROM watchless_publications WHERE podcast_id = ? AND article_key = ?)`)
        .bind(body.id, body.id, nextArticleKey),
      db.prepare(`UPDATE processing_jobs SET status = 'cancelled', worker_id = NULL, current_task = NULL,
        status_message = 'Superseded by Watchless source repair', finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE podcast_id = ? AND status IN ('queued', 'processing')
          AND EXISTS (SELECT 1 FROM watchless_publications WHERE podcast_id = ? AND article_key = ?)`)
        .bind(body.id, body.id, nextArticleKey),
    ]);
    if (!committed[0]?.results?.length) throw new Error('Publication changed during repair; no rows were overwritten');
    await refreshSnapshotsForPodcastMutation(body.id, 'Watchless repair');
    return NextResponse.json({ success: true, data: { id: body.id, scenes: article.scenes.length, enChars: projection.translation.length, zhChars: projection.highlights.length, backupPrefix } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Repair failed' }, { status: 422 });
  }
}
