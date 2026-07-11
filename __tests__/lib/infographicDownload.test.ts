import { downloadInfographicAsPng } from '../../lib/infographicDownload';

describe('downloadInfographicAsPng', () => {
  const createObjectURL = jest.fn(() => 'blob:test');
  const revokeObjectURL = jest.fn();
  beforeEach(() => {
    jest.restoreAllMocks();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  test('falls back to the SVG when the source cannot be fetched', async () => {
    global.fetch = jest.fn(async () => ({ ok: false })) as jest.Mock;
    await expect(downloadInfographicAsPng({ artifactUrl: '/image.svg', filename: 'test' })).resolves.toBe('svg-fallback');
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });
});
