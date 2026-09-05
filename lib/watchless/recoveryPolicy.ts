export const ANALYSIS_ATTEMPT_LIMIT = 3;
export const ANALYSIS_EXTRA_LIMIT = 10;
export const ANALYSIS_REQUEST_MS = 120_000;
export const ANALYSIS_LEASE_MS = 180_000;

export function recoveryEnabled(id: string) {
  return process.env.WATCHLESS_ANALYSIS_RECOVERY_ENABLED === 'true' ||
    (process.env.WATCHLESS_ANALYSIS_RECOVERY_IDS || '').split(',').map(x => x.trim()).includes(id);
}

export function retryAt(attempt: number, now: number, retryAfter?: string | null, random = Math.random()) {
  const base = attempt <= 1 ? 30_000 : 120_000;
  let delay = base + Math.floor(base * .2 * Math.max(0, Math.min(1, random)));
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const at = Number.isFinite(seconds) ? now + Math.max(0, seconds) * 1000 : Date.parse(retryAfter);
    if (Number.isFinite(at)) delay = Math.max(delay, at - now);
  }
  return now + delay;
}

export function retryableHttp(status: number) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

export function canSpendAttempt(attempts: number, extras: number, formatFailures: number) {
  return attempts < ANALYSIS_ATTEMPT_LIMIT && (attempts === 0 || extras < ANALYSIS_EXTRA_LIMIT) && formatFailures < 2;
}
