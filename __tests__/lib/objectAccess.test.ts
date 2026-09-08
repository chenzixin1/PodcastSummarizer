/** @jest-environment node */
import { resolveObjectOwner } from '../../lib/objectAccess';
import { sql } from '../../lib/sql';
import { getStoredWatchlessPublication, loadStoredWatchlessArticle } from '../../lib/watchless/repository';
jest.mock('../../lib/sql', () => ({ sql: jest.fn() }));
jest.mock('../../lib/watchless/repository', () => ({ getStoredWatchlessPublication: jest.fn(), loadStoredWatchlessArticle: jest.fn() }));
describe('persisted object ownership', () => {
  beforeEach(() => jest.resetAllMocks());
  test('internal checkpoints and invalid paths never reach the database', async () => {
    for (const key of ['watchless-runs/a.json', 'watchless-staging/a.json', '../x', 'a//b', 'a/../b']) {
      expect(await resolveObjectOwner(key)).toBeNull();
    }
    expect(sql).not.toHaveBeenCalled();
  });
  test('uses the canonical stored owner and visibility', async () => {
    (sql as jest.Mock).mockResolvedValue({ rows: [{ userId: 'owner', isPublic: 0 }] });
    expect(await resolveObjectOwner('source.txt')).toEqual({ userId: 'owner', isPublic: false });
  });
  test('a video prefix does not grant access to unpublished or old assets', async () => {
    (sql as jest.Mock).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'podcast', userId: 'owner', isPublic: 1 }] });
    (getStoredWatchlessPublication as jest.Mock).mockResolvedValue({ articleKey: 'watchless/abc12345678/current/article.json' });
    (loadStoredWatchlessArticle as jest.Mock).mockResolvedValue({ pdfUrl: '/api/files/watchless/abc12345678/current/article.pdf', scenes: [{ keyframe: '/api/files/watchless/abc12345678/current/frame.jpg' }] });
    expect(await resolveObjectOwner('watchless/abc12345678/old/article.pdf')).toBeNull();
  });
  test('allows an exactly referenced keyframe without inferring filename order', async () => {
    (sql as jest.Mock).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'podcast', userId: 'owner', isPublic: 1 }] });
    (getStoredWatchlessPublication as jest.Mock).mockResolvedValue({ articleKey: 'watchless/abc12345678/current/article.json' });
    (loadStoredWatchlessArticle as jest.Mock).mockResolvedValue({ pdfUrl: '/api/files/watchless/abc12345678/article.pdf', scenes: [{ keyframe: '/api/files/watchless/abc12345678/frame_10.jpg' }] });
    expect(await resolveObjectOwner('watchless/abc12345678/frame_10.jpg')).toEqual({ userId: 'owner', isPublic: true });
  });
});
