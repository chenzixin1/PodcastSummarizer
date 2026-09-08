import { createHmac, timingSafeEqual } from 'node:crypto';

function signature(key: string, expires: string): string {
  const secret = process.env.PROCESS_WORKER_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('Object signing is not configured');
  return createHmac('sha256', secret).update(`asr-read-v1\n${key}\n${expires}`).digest('hex');
}

/** One-hour read capability for ASR pulling a temporary audio object, never persisted. */
export function signedAudioObjectUrl(object: { key: string; url: string; provider: string }): string {
  if (object.provider !== 'r2') return object.url;
  const expires = String(Math.floor(Date.now() / 1000) + 3600);
  const url = new URL(object.url);
  url.searchParams.set('expires', expires);
  url.searchParams.set('signature', signature(object.key, expires));
  return url.toString();
}

export function verifyAudioObjectSignature(key: string, params: URLSearchParams): boolean {
  const expires = params.get('expires') || '';
  const provided = params.get('signature') || '';
  const now = Math.floor(Date.now() / 1000);
  if (!/^\d{10}$/.test(expires) || Number(expires) < now || Number(expires) > now + 3600 || !/^[a-f0-9]{64}$/.test(provided)) return false;
  try { return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(signature(key, expires), 'hex')); }
  catch { return false; }
}
