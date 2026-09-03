import type { WatchlessJobStatus } from './jobs';

export type WatchlessStageId = 'preparing' | 'transcribing' | 'segmenting' | 'rendering' | 'validating' | 'publishing';

export const WATCHLESS_STAGE_DEFINITIONS: Array<{
  id: WatchlessStageId;
  label: string;
  detail: string;
}> = [
  { id: 'preparing', label: '准备视频', detail: '读取信息、下载视频并提取音轨' },
  { id: 'transcribing', label: '原话转录', detail: '识别语音并保留说话人轮次' },
  { id: 'segmenting', label: '内容分段', detail: '识别说话人并划分完整场景' },
  { id: 'rendering', label: '生成图文', detail: '提取关键帧并生成图文稿与 PDF' },
  { id: 'validating', label: '完整性检查', detail: '核对时间线、原话和全部附件' },
  { id: 'publishing', label: '写入 PodSum', detail: '保存为普通播客记录并发布' },
];

const STAGE_ALIASES: Record<string, WatchlessStageId> = {
  created: 'preparing',
  queued: 'preparing',
  preparing: 'preparing',
  transcribing: 'transcribing',
  segmenting: 'segmenting',
  rendering: 'rendering',
  validating: 'validating',
  publishing: 'publishing',
};

export function broadWatchlessStage(value: string | null | undefined): WatchlessStageId | null {
  const normalized = String(value || '').trim().toLowerCase();
  const prefix = normalized.split('_', 1)[0];
  return STAGE_ALIASES[prefix] || null;
}

export function watchlessProgress(status: string, current: number, total: number): number {
  if (status === 'completed') return 100;
  const safeTotal = Math.max(1, Number.isFinite(total) ? total : 100);
  const raw = Math.round(((Number.isFinite(current) ? current : 0) / safeTotal) * 100);
  return Math.max(0, Math.min(99, raw));
}

export function lastKnownActiveStage(
  status: WatchlessJobStatus | string,
  stage: string | null,
  events: Array<{ stage: string; status: string }> = [],
): WatchlessStageId | null {
  const event = [...events].reverse().find((item) => broadWatchlessStage(item.stage || item.status));
  return broadWatchlessStage(event?.stage || event?.status) || broadWatchlessStage(stage) || broadWatchlessStage(status);
}

export function elapsedMilliseconds(startedAt: string | null, completedAt: string | null, updatedAt: string): number | null {
  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt || updatedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

export function formatElapsed(milliseconds: number | null): string {
  if (milliseconds === null) return '—';
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours} 小时 ${minutes} 分钟`;
  if (minutes) return `${minutes} 分 ${seconds} 秒`;
  return `${seconds} 秒`;
}

export function explainWatchlessFailure(input: {
  errorCode: string | null;
  errorMessage: string | null;
  assetCount: number;
  hasDetailedEvents: boolean;
}): { title: string; detail: string } {
  const message = input.errorMessage || '';
  const isWriteTimeout = input.errorCode === 'WATCHLESS_UPSTREAM_WRITE_TIMEOUT'
    || /write operation timed out/i.test(message);
  if (isWriteTimeout) {
    return {
      title: '向上游服务写入数据时超时',
      detail: input.assetCount === 0
        ? `任务在第一个图文产物上传前停止。${input.hasDetailedEvents ? '可在阶段记录中查看最后完成的位置。' : '这是一条旧任务，当时尚未记录子阶段，因此无法进一步区分语音识别或内容分段请求。'}`
        : `已有 ${input.assetCount} 个临时产物写入，但后续上游请求超时。积分已自动退回。`,
    };
  }
  if (input.errorCode === 'WATCHLESS_UPSTREAM_READ_TIMEOUT') {
    return { title: '等待上游服务返回结果超时', detail: '任务没有在允许时间内收到完整响应。积分已自动退回。' };
  }
  if (input.errorCode === 'WATCHLESS_MEDIA_TIMEOUT') {
    return { title: '视频下载或媒体处理超时', detail: '视频下载、音轨提取或关键帧处理超过了运行时限。积分已自动退回。' };
  }
  if (input.errorCode === 'WATCHLESS_CONTAINER_STATUS_UNAVAILABLE') {
    return { title: '运行环境状态连续不可用', detail: '系统无法持续读取独立运行环境的状态，已安全停止任务并退回积分。已保存的过程产物仍可在下方下载。' };
  }
  if (input.errorCode?.startsWith('WATCHLESS_OPENROUTER_HTTP_')) {
    return { title: '内容分段模型调用失败', detail: '原话转录等已完成产物仍然保留。可查看技术信息确认模型服务返回原因，修复后直接重新运行同一任务。' };
  }
  return {
    title: '转换流程未能完成',
    detail: input.hasDetailedEvents
      ? '请根据下方最后一个阶段和错误信息定位问题；积分已自动退回。'
      : '这条旧任务没有保存更细的阶段记录；积分已自动退回。',
  };
}
