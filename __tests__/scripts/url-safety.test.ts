/**
 * @jest-environment node
 */

import { EventEmitter } from 'node:events';
import {
  assertFinalUrlOrigin,
  assertPageFinalOrigin,
  createStickyMainFrameOriginGuard,
  normalizeHttpOrigin,
  runOriginGuardedOperation,
  resolveConfiguredHttpOrigin,
  resolveDistinctHttpOrigins,
} from '../../scripts/performance/url-safety.mjs';

class FakeFrame {
  constructor(private readonly currentUrl: () => string) {}

  url() {
    return this.currentUrl();
  }
}

class FakePage extends EventEmitter {
  private currentUrl = 'about:blank';
  private readonly main = new FakeFrame(() => this.currentUrl);

  url() {
    return this.currentUrl;
  }

  mainFrame() {
    return this.main;
  }

  navigateMain(url: string) {
    this.currentUrl = url;
    this.emit('framenavigated', this.main);
  }

  navigateChild(url: string) {
    this.emit('framenavigated', new FakeFrame(() => url));
  }
}

test.each([
  [undefined, 'is required'],
  ['', 'is required'],
  ['not a URL', 'must be a valid URL'],
  ['ftp://preview.example', 'must use http: or https:'],
] as const)('rejects unsafe preview URL input %s', (value, message) => {
  expect(() => normalizeHttpOrigin(value, 'PREVIEW_BASE_URL')).toThrow(
    `PREVIEW_BASE_URL ${message}`,
  );
});

test('rejects Preview when it resolves to the Production origin', () => {
  expect(() => resolveDistinctHttpOrigins({
    productionUrl: 'https://podsum.cc/',
    previewUrl: 'https://podsum.cc',
  })).toThrow('Preview origin https://podsum.cc must differ from Production origin https://podsum.cc');
});

test('allows and normalizes distinct valid http origins', () => {
  expect(resolveDistinctHttpOrigins({
    productionUrl: 'https://podsum.cc/',
    previewUrl: 'https://preview.example:8443/',
  })).toEqual({
    productionOrigin: 'https://podsum.cc',
    previewOrigin: 'https://preview.example:8443',
  });
});

test('uses the Production fallback only when PERF_BASE_URL is unset', () => {
  expect(resolveConfiguredHttpOrigin(
    undefined,
    'https://podsum.cc',
    'PERF_BASE_URL',
  )).toBe('https://podsum.cc');
  expect(() => resolveConfiguredHttpOrigin(
    '',
    'https://podsum.cc',
    'PERF_BASE_URL',
  )).toThrow('PERF_BASE_URL is required');
});

test('rejects a final navigation that changes origin', () => {
  expect(() => assertFinalUrlOrigin(
    'https://login.example/sign-in',
    'https://preview.example',
    'homepage navigation',
  )).toThrow(
    'homepage navigation changed origin from https://preview.example to https://login.example',
  );
});

test('accepts a final navigation on the configured origin', () => {
  expect(() => assertFinalUrlOrigin(
    'https://preview.example/dashboard?ready=1',
    'https://preview.example',
    'homepage navigation',
  )).not.toThrow();
});

test('detects a delayed client redirect when origin is rechecked before capture', () => {
  let currentUrl = 'https://preview.example/';
  const page = { url: () => currentUrl };

  expect(() => assertPageFinalOrigin(
    page,
    'https://preview.example',
    'preview capture',
  )).not.toThrow();

  currentUrl = 'https://podsum.cc/';
  expect(() => assertPageFinalOrigin(
    page,
    'https://preview.example',
    'preview capture',
  )).toThrow(
    'preview capture changed origin from https://preview.example to https://podsum.cc',
  );
});

test.each([
  ['server redirect', (page: FakePage) => page.navigateMain('https://podsum.cc/')],
  ['redirect during page.evaluate', (page: FakePage) => {
    page.navigateMain('https://podsum.cc/');
    page.navigateMain('https://preview.example/');
  }],
  ['redirect during screenshot', (page: FakePage) => {
    page.navigateMain('https://podsum.cc/image');
    page.navigateMain('https://preview.example/');
  }],
] as const)('sticky guard rejects a %s', (_caseName, operation) => {
  const page = new FakePage();
  const guard = createStickyMainFrameOriginGuard(
    page,
    'https://preview.example',
    'preview capture',
  );
  page.navigateMain('https://preview.example/');
  expect(guard.assertSafe()).toBe('https://preview.example/');

  operation(page);

  expect(() => guard.assertSafe()).toThrow(
    'preview capture changed origin from https://preview.example to https://podsum.cc',
  );
  guard.cleanup();
  expect(page.listenerCount('framenavigated')).toBe(0);
});

test('sticky guard ignores only the initial about:blank main-frame state', () => {
  const page = new FakePage();
  const guard = createStickyMainFrameOriginGuard(
    page,
    'https://preview.example',
    'preview capture',
  );

  expect(guard.assertSafe()).toBe('about:blank');
  page.navigateChild('https://podsum.cc/');
  page.navigateMain('https://preview.example/');
  page.navigateMain('about:blank');
  page.navigateMain('https://preview.example/');

  expect(() => guard.assertSafe()).toThrow(
    'preview capture returned an invalid final URL: about:blank',
  );
  guard.cleanup();
});

test('sticky guard rejects a new about:blank navigation before the first http navigation', () => {
  const page = new FakePage();
  const guard = createStickyMainFrameOriginGuard(
    page,
    'https://preview.example',
    'preview capture',
  );

  expect(guard.assertSafe()).toBe('about:blank');
  page.navigateMain('about:blank');
  page.navigateMain('https://preview.example/');

  expect(() => guard.assertSafe()).toThrow(
    'preview capture returned an invalid final URL: about:blank',
  );
  guard.cleanup();
});

test('sticky guard cleanup removes observation without retaining later navigation', () => {
  const page = new FakePage();
  const guard = createStickyMainFrameOriginGuard(
    page,
    'https://preview.example',
    'preview capture',
  );
  page.navigateMain('https://preview.example/');
  guard.cleanup();
  expect(page.listenerCount('framenavigated')).toBe(0);

  page.navigateMain('https://podsum.cc/');
  page.navigateMain('https://preview.example/');

  expect(guard.assertSafe()).toBe('https://preview.example/');
});

test('guarded operation rejects an asynchronous cross-origin fault even after a safe return', async () => {
  const page = new FakePage();
  const guard = createStickyMainFrameOriginGuard(
    page,
    'https://preview.example',
    'preview capture',
  );
  page.navigateMain('https://preview.example/');

  await expect(runOriginGuardedOperation(
    guard,
    async () => {
      await Promise.resolve();
      page.navigateMain('https://podsum.cc/');
      page.navigateMain('https://preview.example/');
      return 'unsafe result';
    },
    'snapshot evaluation',
  )).rejects.toThrow(
    'snapshot evaluation: preview capture changed origin from https://preview.example to https://podsum.cc',
  );
  guard.cleanup();
});

test('guarded operation returns the result of a safe asynchronous operation', async () => {
  const page = new FakePage();
  const guard = createStickyMainFrameOriginGuard(
    page,
    'https://preview.example',
    'preview capture',
  );
  page.navigateMain('https://preview.example/');

  await expect(runOriginGuardedOperation(
    guard,
    async () => {
      await Promise.resolve();
      return { captured: true };
    },
    'screenshot capture',
  )).resolves.toEqual({ captured: true });
  guard.cleanup();
});
