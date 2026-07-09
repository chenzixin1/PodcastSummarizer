import { normalizeAuthCallbackUrl } from '@/lib/authCallbackUrl';

describe('normalizeAuthCallbackUrl', () => {
  it('keeps relative callback paths', () => {
    expect(normalizeAuthCallbackUrl('/upload?from=nav', '/?view=my', 'https://www.podsum.cc')).toBe('/upload?from=nav');
  });

  it('keeps same-origin absolute callback paths', () => {
    expect(
      normalizeAuthCallbackUrl('https://www.podsum.cc/upload?from=nav#top', '/?view=my', 'https://www.podsum.cc'),
    ).toBe('/upload?from=nav#top');
  });

  it('keeps canonical podsum callbacks on sibling product domains', () => {
    expect(
      normalizeAuthCallbackUrl('https://podsum.cc/upload?parity=1', '/?view=my', 'https://www.podsum.cc'),
    ).toBe('/upload?parity=1');
    expect(
      normalizeAuthCallbackUrl('https://podsum.cc/upload?parity=1', '/?view=my', 'https://refactor.podsum.cc'),
    ).toBe('/upload?parity=1');
  });

  it('rejects protocol-relative and offsite callbacks', () => {
    expect(normalizeAuthCallbackUrl('//evil.test/upload', '/?view=my', 'https://www.podsum.cc')).toBe('/?view=my');
    expect(normalizeAuthCallbackUrl('https://evil.test/upload', '/?view=my', 'https://www.podsum.cc')).toBe('/?view=my');
  });
});
