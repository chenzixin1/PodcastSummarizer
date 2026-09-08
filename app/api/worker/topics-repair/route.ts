import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { isWorkerAuthorizedBySecret } from '../../../../lib/workerAuth';
import { getD1DatabaseBinding } from '../../../../lib/sql';
import { topicRepairPreview, TOPIC_SOURCE_FROM, TOPIC_SOURCE_SQL } from '../../../../lib/topicRepair';
import { buildTopicStatements } from '../../../../lib/topicPersistence';
import { uploadObject } from '../../../../lib/objectStorage';
import { refreshSnapshotsForPodcastMutation } from '../../../../lib/staticSnapshotHooks';

/** Explicit operator-only, one article, tag-only repair. Never schedules analysis. */
export async function POST(request: NextRequest) {
  if (!isWorkerAuthorizedBySecret(request.headers.get('x-worker-secret'))) return NextResponse.json({ success: false }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (typeof body?.id !== 'string' || body.id.length > 160 || !['preview','apply'].includes(body.action)) {
    return NextResponse.json({ success: false, error: 'Explicit id and preview/apply action required' }, { status: 400 });
  }
  const db = getD1DatabaseBinding();
  if (!db) return NextResponse.json({ success: false }, { status: 503 });
  try {
    const row = (await db.prepare(`SELECT ${TOPIC_SOURCE_SQL} AS source,p.tags_json AS tags ${TOPIC_SOURCE_FROM} WHERE p.id=?`)
      .bind(body.id).all<{ source: string; tags: string | null }>()).results?.[0];
    if (!row) return NextResponse.json({ success: false }, { status: 404 });
    const preview = topicRepairPreview(row.source, row.tags);
    if (body.action === 'preview') return NextResponse.json({ success: true, data: preview });
    if (body.fingerprint !== preview.fingerprint) return NextResponse.json({ success: false, error: 'Source changed; preview again' }, { status: 409 });
    // Save the old relationships before changing either representation.
    const relations = (await db.prepare('SELECT * FROM podcast_topics WHERE podcast_id=?').bind(body.id).all()).results || [];
    const backupKey = `watchless-runs/topic-repairs/${encodeURIComponent(body.id)}/${randomUUID()}.json`;
    await uploadObject(backupKey, JSON.stringify({ id: body.id, fingerprint: preview.fingerprint, tags: row.tags, relations }), { contentType: 'application/json', requirePrivateR2: true });
    const statements = buildTopicStatements(body.id, preview.assignments, {
      sql: `EXISTS (SELECT 1 ${TOPIC_SOURCE_FROM} WHERE p.id=? AND ${TOPIC_SOURCE_SQL}=? AND p.tags_json IS ?)`,
      params: [body.id,row.source,row.tags],
    });
    const results = await db.batch(statements.map(s => db.prepare(s.sql).bind(...s.params)));
    if (results.at(-1)?.meta?.changes !== 1) return NextResponse.json({ success: false, error: 'Source changed; no tags updated' }, { status: 409 });
    const snapshot = await refreshSnapshotsForPodcastMutation(body.id, 'Topic repair');
    return NextResponse.json({ success: true, data: { ...preview, backupKey, snapshotRefreshed: snapshot.success } });
  } catch (error) {
    console.error('Topic repair failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ success: false, error: 'Tag repair failed; no analysis was scheduled' }, { status: 500 });
  }
}
