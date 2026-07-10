export function normalizeHttpOrigin(value, label = 'URL') {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input) {
    throw new Error(`${label} is required`);
  }

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use http: or https:`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not include credentials`);
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`${label} must be an origin without a path, query, or fragment`);
  }
  return parsed.origin;
}

export function resolveConfiguredHttpOrigin(value, fallback, label = 'URL') {
  return normalizeHttpOrigin(value === undefined ? fallback : value, label);
}

export function resolveDistinctHttpOrigins({
  productionUrl,
  previewUrl,
  productionLabel = 'PROD_BASE_URL',
  previewLabel = 'PREVIEW_BASE_URL',
}) {
  const productionOrigin = normalizeHttpOrigin(productionUrl, productionLabel);
  const previewOrigin = normalizeHttpOrigin(previewUrl, previewLabel);
  if (previewOrigin === productionOrigin) {
    throw new Error(
      `Preview origin ${previewOrigin} must differ from Production origin ${productionOrigin}`,
    );
  }
  return { productionOrigin, previewOrigin };
}

export function assertFinalUrlOrigin(finalUrl, expectedOrigin, label = 'navigation') {
  let parsedFinalUrl;
  try {
    parsedFinalUrl = new URL(finalUrl);
  } catch {
    throw new Error(`${label} returned an invalid final URL: ${finalUrl || 'missing'}`);
  }
  if (parsedFinalUrl.protocol !== 'http:' && parsedFinalUrl.protocol !== 'https:') {
    throw new Error(`${label} returned an invalid final URL: ${finalUrl || 'missing'}`);
  }
  const finalOrigin = parsedFinalUrl.origin;
  const normalizedExpectedOrigin = normalizeHttpOrigin(expectedOrigin, `${label} expected origin`);
  if (finalOrigin !== normalizedExpectedOrigin) {
    throw new Error(
      `${label} changed origin from ${normalizedExpectedOrigin} to ${finalOrigin}`,
    );
  }
}

export function assertPageFinalOrigin(page, expectedOrigin, label = 'navigation') {
  if (!page || typeof page.url !== 'function') {
    throw new Error(`${label} page must expose its current URL`);
  }
  const finalUrl = page.url();
  assertFinalUrlOrigin(finalUrl, expectedOrigin, label);
  return finalUrl;
}

export function createStickyMainFrameOriginGuard(
  page,
  expectedOrigin,
  label = 'navigation',
) {
  if (
    !page
    || typeof page.url !== 'function'
    || typeof page.mainFrame !== 'function'
    || typeof page.on !== 'function'
    || typeof page.off !== 'function'
  ) {
    throw new Error(`${label} page must expose URL and navigation events`);
  }

  const mainFrame = page.mainFrame();
  let firstViolation;
  let initialBlankStateAllowed = true;
  let cleanedUp = false;

  const observeUrl = (currentUrl, allowInitialBlankState = false) => {
    if (firstViolation) return;
    if (
      allowInitialBlankState
      && initialBlankStateAllowed
      && currentUrl === 'about:blank'
    ) return;
    initialBlankStateAllowed = false;
    try {
      assertFinalUrlOrigin(currentUrl, expectedOrigin, label);
    } catch (error) {
      firstViolation = error instanceof Error ? error : new Error(String(error));
    }
  };

  const observeFrame = (frame) => {
    if (frame !== mainFrame) return;
    if (!frame || typeof frame.url !== 'function') {
      if (!firstViolation) {
        firstViolation = new Error(`${label} main frame must expose its current URL`);
      }
      return;
    }
    observeUrl(frame.url());
  };

  page.on('framenavigated', observeFrame);
  observeUrl(page.url(), true);

  return {
    assertSafe() {
      const currentUrl = page.url();
      if (!firstViolation) observeUrl(currentUrl, initialBlankStateAllowed);
      if (firstViolation) throw firstViolation;
      return currentUrl;
    },
    cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      page.off('framenavigated', observeFrame);
    },
  };
}

export async function runOriginGuardedOperation(guard, operation, label) {
  if (!guard || typeof guard.assertSafe !== 'function') {
    throw new Error(`${label} requires an origin guard`);
  }
  if (typeof operation !== 'function') {
    throw new Error(`${label} operation must be a function`);
  }

  const result = await operation();
  try {
    guard.assertSafe();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${message}`, { cause: error });
  }
  return result;
}
