/**
 * @jest-environment node
 */

import { createNetworkCaptureState } from '../../scripts/performance/network-capture.mjs';
import { assertColdRunIntegrity } from '../../scripts/performance/measure-home.mjs';

const previewOrigin = 'https://preview.example';

function response(url: string, status: number, encodedDataLength: number) {
  return {
    url,
    status,
    protocol: 'h2',
    encodedDataLength,
    fromDiskCache: false,
    fromServiceWorker: false,
    headers: { 'cache-control': 'public, max-age=60' },
  };
}

function runForIntegrity(cacheHeaders: Array<Record<string, unknown>>) {
  return {
    label: 'cold-1',
    resources: {
      failedRequests: [],
      cacheHeaders,
    },
  };
}

test('keeps a 302 redirect hop separate from its final response and counts bytes once', () => {
  const capture = createNetworkCaptureState();
  capture.onRequestWillBeSent({
    requestId: 'request-1',
    type: 'Document',
    request: { url: `${previewOrigin}/start` },
  });
  capture.onResponseReceivedExtraInfo({
    requestId: 'request-1',
    statusCode: 302,
  });
  capture.onRequestWillBeSent({
    requestId: 'request-1',
    type: 'Document',
    request: { url: `${previewOrigin}/final` },
    redirectHasExtraInfo: true,
    redirectResponse: response(`${previewOrigin}/start`, 302, 120),
  });
  capture.onResponseReceived({
    requestId: 'request-1',
    type: 'Document',
    hasExtraInfo: false,
    response: response(`${previewOrigin}/final`, 200, 10),
  });
  capture.onLoadingFinished({ requestId: 'request-1', encodedDataLength: 880 });

  const snapshot = capture.snapshot();
  expect(snapshot.resources).toMatchObject([
    {
      url: `${previewOrigin}/start`,
      reportedStatus: 302,
      status: 302,
      redirectHop: true,
      transferBytes: 120,
    },
    {
      url: `${previewOrigin}/final`,
      reportedStatus: 200,
      status: 200,
      redirectHop: false,
      transferBytes: 880,
    },
  ]);
  expect(snapshot.transferBytes).toBe(1_000);
  expect(snapshot.byType.document).toEqual({ requests: 2, transferBytes: 1_000 });
  expect(() => assertColdRunIntegrity(
    runForIntegrity(snapshot.cacheHeaders),
    previewOrigin,
  )).toThrow(`same-origin resource ${previewOrigin}/start returned 302`);
});

test('uses an extra-info 304 as authoritative over a reported 200 regardless of ordering', () => {
  const capture = createNetworkCaptureState();
  capture.onRequestWillBeSent({
    requestId: 'request-2',
    type: 'Script',
    request: { url: `${previewOrigin}/app.js` },
  });
  capture.onResponseReceived({
    requestId: 'request-2',
    type: 'Script',
    hasExtraInfo: true,
    response: response(`${previewOrigin}/app.js`, 200, 12),
  });
  capture.onLoadingFinished({ requestId: 'request-2', encodedDataLength: 640 });
  capture.onResponseReceivedExtraInfo({
    requestId: 'request-2',
    statusCode: 304,
  });

  const snapshot = capture.snapshot();
  expect(snapshot.resources).toHaveLength(1);
  expect(snapshot.resources[0]).toMatchObject({
    reportedStatus: 200,
    status: 304,
    transferBytes: 640,
  });
  expect(snapshot.transferBytes).toBe(640);
  expect(snapshot.byType.script).toEqual({ requests: 1, transferBytes: 640 });
  expect(() => assertColdRunIntegrity(
    runForIntegrity(snapshot.cacheHeaders),
    previewOrigin,
  )).toThrow(`same-origin resource ${previewOrigin}/app.js returned 304`);
});
