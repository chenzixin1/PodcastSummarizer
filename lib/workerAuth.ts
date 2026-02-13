function normalizeSecret(value?: string | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getCronSecret(): string | null {
  return normalizeSecret(process.env.CRON_SECRET);
}

export function getWorkerSharedSecrets(): string[] {
  const candidates = [
    normalizeSecret(process.env.PROCESS_WORKER_SECRET),
    normalizeSecret(process.env.NEXTAUTH_SECRET),
    normalizeSecret(process.env.AUTH_SECRET),
  ].filter((value): value is string => Boolean(value));
  return Array.from(new Set(candidates));
}

export function getPreferredWorkerSecretForInternalCalls(): string | null {
  const sharedSecrets = getWorkerSharedSecrets();
  return sharedSecrets.length > 0 ? sharedSecrets[0] : null;
}

export function isWorkerAuthorizedBySecret(headerSecret: string | null): boolean {
  if (!headerSecret) {
    return false;
  }
  const sharedSecrets = getWorkerSharedSecrets();
  if (sharedSecrets.length === 0) {
    return false;
  }
  return sharedSecrets.includes(headerSecret);
}
