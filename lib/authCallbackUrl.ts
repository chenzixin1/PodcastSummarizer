function isPodsumHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === 'podsum.cc' || host.endsWith('.podsum.cc');
}

function isLoopbackHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function isTrustedCallbackHostPair(callbackHost: string, currentHost: string) {
  const callback = callbackHost.toLowerCase();
  const current = currentHost.toLowerCase();

  if (callback === current) {
    return true;
  }
  if (isPodsumHost(callback) && isPodsumHost(current)) {
    return true;
  }
  return isLoopbackHost(callback) && isLoopbackHost(current);
}

export function normalizeAuthCallbackUrl(
  value: string | null,
  fallback: string,
  currentOrigin = typeof window !== 'undefined' ? window.location.origin : null,
) {
  if (!value) {
    return fallback;
  }
  if (value.startsWith('/') && !value.startsWith('//')) {
    return value;
  }
  if (!currentOrigin) {
    return fallback;
  }

  try {
    const parsed = new URL(value);
    const current = new URL(currentOrigin);
    if (isTrustedCallbackHostPair(parsed.hostname, current.hostname)) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    return fallback;
  }

  return fallback;
}
