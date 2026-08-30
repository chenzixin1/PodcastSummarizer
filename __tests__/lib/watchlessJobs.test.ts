import {
  WATCHLESS_MAX_ACTIVE_BUNDLE_JOBS_PER_USER,
  WATCHLESS_MAX_ACTIVE_JOBS_PER_USER,
  WATCHLESS_MAX_URL_JOBS_PER_USER_PER_DAY,
  WATCHLESS_ONLINE_MODEL,
  WATCHLESS_URL_CREDIT_COST,
  canonicalYoutubeUrl,
  extractYoutubeVideoId,
  podcastIdForVideo,
  validateWatchlessTimeline,
} from '../../lib/watchless/jobs';
import type { WatchlessArticle } from '../../lib/watchless/article';

describe('Watchless job safety primitives', () => {
  test.each([
    ['Vv3CEAS_w34', 'Vv3CEAS_w34'],
    ['https://www.youtube.com/watch?v=Vv3CEAS_w34', 'Vv3CEAS_w34'],
    ['https://youtu.be/Vv3CEAS_w34?t=12', 'Vv3CEAS_w34'],
    ['https://www.youtube.com/shorts/Vv3CEAS_w34', 'Vv3CEAS_w34'],
    ['https://www.youtube.com/live/Vv3CEAS_w34', 'Vv3CEAS_w34'],
  ])('accepts supported YouTube source %s', (source, expected) => {
    expect(extractYoutubeVideoId(source)).toBe(expected);
  });

  test.each([
    'https://example.com/watch?v=Vv3CEAS_w34',
    'https://youtube.example.com/watch?v=Vv3CEAS_w34',
    'file:///etc/passwd',
    'https://www.youtube.com/watch?v=too-short',
  ])('rejects unsupported source %s', (source) => {
    expect(extractYoutubeVideoId(source)).toBeNull();
  });

  test('pins the high-cost gate and online model', () => {
    expect(WATCHLESS_URL_CREDIT_COST).toBe(1000);
    expect(WATCHLESS_ONLINE_MODEL).toBe('openai/gpt-5.6-luna');
    expect(WATCHLESS_MAX_ACTIVE_JOBS_PER_USER).toBe(1);
    expect(WATCHLESS_MAX_URL_JOBS_PER_USER_PER_DAY).toBe(3);
    expect(WATCHLESS_MAX_ACTIVE_BUNDLE_JOBS_PER_USER).toBe(3);
  });

  test('uses stable canonical ids and URLs', () => {
    expect(canonicalYoutubeUrl('Vv3CEAS_w34')).toBe('https://www.youtube.com/watch?v=Vv3CEAS_w34');
    expect(podcastIdForVideo('Vv3CEAS_w34')).toBe('watchless-vv3ceas-w34');
    expect(podcastIdForVideo('abcdefghijk')).toBe('watchless-abcdefghijk');
  });

  test('requires bundle scenes to cover one contiguous timeline', () => {
    const article = {
      durationSec: 20,
      scenes: [
        { startSec: 0, endSec: 10 },
        { startSec: 10, endSec: 20 },
      ],
    } as WatchlessArticle;
    expect(() => validateWatchlessTimeline(article)).not.toThrow();
    expect(() => validateWatchlessTimeline({
      ...article,
      scenes: [{ ...article.scenes[0], endSec: 8 }, article.scenes[1]],
    })).toThrow('gap or overlap');
    expect(() => validateWatchlessTimeline({
      ...article,
      scenes: [{ ...article.scenes[0], startSec: 2 }, article.scenes[1]],
    })).toThrow('start at the beginning');
  });
});
