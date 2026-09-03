import {
  broadWatchlessStage,
  elapsedMilliseconds,
  explainWatchlessFailure,
  formatElapsed,
  lastKnownActiveStage,
  watchlessProgress,
} from '../../lib/watchless/jobPresentation';

describe('Watchless job presentation', () => {
  test('shows honest progress without a synthetic two-percent floor', () => {
    expect(watchlessProgress('failed', 0, 100)).toBe(0);
    expect(watchlessProgress('rendering', 65, 100)).toBe(65);
    expect(watchlessProgress('completed', 0, 100)).toBe(100);
  });

  test('maps detailed runtime stages to the public timeline', () => {
    expect(broadWatchlessStage('preparing_audio')).toBe('preparing');
    expect(broadWatchlessStage('queued')).toBe('preparing');
    expect(broadWatchlessStage('transcribing_upload')).toBe('transcribing');
    expect(broadWatchlessStage('failed')).toBeNull();
  });

  test('uses the latest recorded active stage for failures', () => {
    expect(lastKnownActiveStage('failed', 'failed', [{
      status: 'transcribing',
      stage: 'transcribing_upload',
    }])).toBe('transcribing');
  });

  test('formats a stable elapsed duration', () => {
    expect(elapsedMilliseconds('2026-09-03T02:37:13Z', '2026-09-03T02:54:55Z', '')).toBe(1_062_000);
    expect(formatElapsed(1_062_000)).toBe('17 分 42 秒');
  });

  test('explains the legacy write timeout without inventing a stage', () => {
    expect(explainWatchlessFailure({
      errorCode: 'WATCHLESS_WORKFLOW_FAILED',
      errorMessage: 'The write operation timed out',
      assetCount: 0,
      hasDetailedEvents: false,
    })).toEqual({
      title: '向上游服务写入数据时超时',
      detail: '任务在第一个图文产物上传前停止。这是一条旧任务，当时尚未记录子阶段，因此无法进一步区分语音识别或内容分段请求。',
    });
  });

  test('explains a persistent runtime status outage and retained artifacts', () => {
    expect(explainWatchlessFailure({
      errorCode: 'WATCHLESS_CONTAINER_STATUS_UNAVAILABLE',
      errorMessage: 'Container status remained unavailable for ten minutes.',
      assetCount: 3,
      hasDetailedEvents: true,
    })).toEqual({
      title: '运行环境状态连续不可用',
      detail: '系统无法持续读取独立运行环境的状态，已安全停止任务并退回积分。已保存的过程产物仍可在下方下载。',
    });
  });
});
