/** @jest-environment node */
import { signedAudioObjectUrl, verifyAudioObjectSignature } from '../../lib/objectSigning';
describe('limited ASR read capability', () => {
  const old = process.env.PROCESS_WORKER_SECRET;
  beforeAll(() => { process.env.PROCESS_WORKER_SECRET = 'test-only-signing-key'; });
  afterAll(() => { if (old) process.env.PROCESS_WORKER_SECRET = old; else delete process.env.PROCESS_WORKER_SECRET; });
  test('binds to an exact key and expiry', () => {
    const url = new URL(signedAudioObjectUrl({ key: 'extension-audio/a.mp3', url: 'https://podsum.cc/api/files/extension-audio/a.mp3', provider: 'r2' }));
    expect(verifyAudioObjectSignature('extension-audio/a.mp3', url.searchParams)).toBe(true);
    expect(verifyAudioObjectSignature('private.txt', url.searchParams)).toBe(false);
    url.searchParams.set('expires', '1000000000');
    expect(verifyAudioObjectSignature('extension-audio/a.mp3', url.searchParams)).toBe(false);
  });
});
