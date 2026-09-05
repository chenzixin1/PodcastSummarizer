'use client';

import { AlertTriangle, Check, ChevronRight, Circle, Clock3, Coins, Copy, Download, ExternalLink, FileText, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import AppFrame from '../../../../components/AppFrame';
import {
  WATCHLESS_STAGE_DEFINITIONS,
  elapsedMilliseconds,
  explainWatchlessFailure,
  formatElapsed,
  lastKnownActiveStage,
  watchlessProgress,
} from '../../../../lib/watchless/jobPresentation';

type WatchlessJobEvent = {
  id: number; status: string; stage: string; progressCurrent: number; progressTotal: number;
  message: string | null; createdAt: string;
};

type WatchlessJobAsset = {
  id: string; role: string; assetPath: string; contentType: string; sizeBytes: number;
  sha256: string; status: string; createdAt: string; updatedAt: string; downloadUrl: string;
};

type WatchlessJob = {
  id: string; sourceKind: 'url' | 'mcp_bundle'; sourceUrl: string | null; videoId: string | null;
  title: string | null; preferredLanguage: string | null; status: string; stage: string | null;
  progressCurrent: number; progressTotal: number; model: string | null;
  creditStatus: 'reserved' | 'charged' | 'refunded' | 'none'; creditsReserved: number;
  outputPodcastId: string | null; errorCode: string | null; errorMessage: string | null;
  createdAt: string; startedAt: string | null; updatedAt: string; completedAt: string | null;
  events: WatchlessJobEvent[]; assets: WatchlessJobAsset[];
};

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'rolled_back']);

const STATUS_COPY: Record<string, { label: string; detail: string }> = {
  created: { label: '正在创建任务', detail: '正在建立安全的转换任务。' },
  awaiting_upload: { label: '等待上传完整图文', detail: '任务已经建立，等待增强版 Watchless skill 上传图文、原话实录与 PDF。' },
  queued: { label: '等待开始', detail: '任务已进入队列，即将启动独立运行环境。' },
  preparing: { label: '正在准备视频', detail: '正在读取来源、下载视频并提取音轨。' },
  transcribing: { label: '正在转录原话', detail: '正在识别语音和说话人轮次。' },
  segmenting: { label: '正在划分场景', detail: 'Luna 只负责识别说话人和场景边界，正文保留 ASR 原话。' },
  rendering: { label: '正在生成完整图文', detail: '正在提取关键帧并制作文章和 PDF。' },
  validating: { label: '正在检查产物', detail: '正在核对时间线、原话和全部附件。' },
  publishing: { label: '正在写入 PodSum', detail: '正在保存为普通播客记录并发布完整图文。' },
  completed: { label: '转换完成', detail: '完整图文已写入 PodSum。' },
  failed: { label: '转换失败', detail: '本次预留积分已经自动退回，不会产生费用。' },
  cancelled: { label: '任务已取消', detail: '预留积分已经退回。' },
  rolled_back: { label: '发布已撤回', detail: '生成的内容已经从 PodSum 撤回。' },
};

const MCP_STAGE_DEFINITIONS = [
  { id: 'awaiting_upload', label: '上传产物', detail: '由 Codex / Watchless skill 上传图文、关键帧、原话实录与 PDF' },
  { id: 'validating', label: '完整性检查', detail: '核对时间线、校验和与全部必需附件' },
  { id: 'publishing', label: '写入 PodSum', detail: '保存为普通播客记录并发布完整图文' },
] as const;

const STAGE_LABELS: Record<string, string> = {
  queued: '等待运行环境', preparing_metadata: '读取视频信息', preparing_download: '下载授权视频',
  preparing_audio: '提取语音轨道', transcribing_upload: '上传音频并识别原话',
  segmenting_structure: '识别说话人并划分场景', segmenting_translation: '逐条生成中文忠实翻译',
  rendering_keyframes: '生成场景关键帧',
  validating_assets: '检查文章与附件', validating_languages: '检查并补齐中英文内容', validating: '检查完整性', publishing: '写入 PodSum',
  completed: '转换完成', cancelled: '任务取消', rolled_back: '发布撤回', failed: '任务失败',
};

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(parsed);
}

function stageLabel(stage: string | null | undefined): string {
  return STAGE_LABELS[String(stage || '')] || String(stage || '').replaceAll('_', ' ') || '等待状态';
}

function modelLabel(model: string | null): string {
  return model === 'openai/gpt-5.6-luna' ? 'GPT-5.6 Luna · OpenRouter' : model || '—';
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 1) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function artifactLabel(path: string, role: string): string {
  if (path.endsWith('source-metadata.json')) return '视频来源元数据';
  if (path.endsWith('audio.mp3')) return '压缩语音轨道';
  if (path.endsWith('asr-raw.json')) return 'ASR 原始识别结果';
  if (path.endsWith('scene-structure.json')) return '场景与说话人结构';
  if (path.endsWith('transcript.txt')) return '原话转录文本';
  if (role === 'keyframe') return '场景关键帧';
  if (role === 'article') return '完整图文数据';
  if (role === 'pdf') return '完整图文 PDF';
  return path.split('/').filter(Boolean).pop() || '过程产物';
}

export default function WatchlessJobPage() {
  const params = useParams<{ id: string }>();
  const [job, setJob] = useState<WatchlessJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadJob = useCallback(async (): Promise<WatchlessJob> => {
    const response = await fetch(`/api/watchless/jobs/${encodeURIComponent(params.id)}`, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '无法读取这条 Watchless 任务。');
    const nextJob = { events: [], assets: [], ...result.data } as WatchlessJob;
    setJob(nextJob);
    setError(null);
    return nextJob;
  }, [params.id]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const nextJob = await loadJob();
        if (TERMINAL_STATUSES.has(nextJob.status)) return;
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : '无法读取这条 Watchless 任务。');
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (!cancelled) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [loadJob]);

  const progress = useMemo(() => job ? watchlessProgress(job.status, job.progressCurrent, job.progressTotal) : 0, [job]);
  const stageDefinitions = job?.sourceKind === 'mcp_bundle' ? MCP_STAGE_DEFINITIONS : WATCHLESS_STAGE_DEFINITIONS;
  const activeStage = useMemo(() => {
    if (!job) return null;
    if (job.sourceKind === 'mcp_bundle' && job.status === 'awaiting_upload') return 'awaiting_upload';
    return lastKnownActiveStage(job.status, job.stage, job.events);
  }, [job]);
  const activeStageIndex = stageDefinitions.findIndex((item) => item.id === activeStage);
  const copy = STATUS_COPY[job?.status || 'created'] || { label: job?.stage ? stageLabel(job.stage) : '转换处理中', detail: 'Watchless 工作流正在运行。' };
  const canCancel = Boolean(job && ['created', 'queued', 'preparing', 'transcribing', 'segmenting', 'rendering'].includes(job.status));
  const elapsed = job ? formatElapsed(elapsedMilliseconds(job.startedAt, job.completedAt, job.updatedAt)) : '—';
  const failure = job?.status === 'failed' ? explainWatchlessFailure({
    errorCode: job.errorCode, errorMessage: job.errorMessage, assetCount: job.assets.length, hasDetailedEvents: job.events.length > 0,
  }) : null;

  const cancelJob = async () => {
    if (!job || !canCancel) return;
    setCancelling(true); setError(null);
    try {
      const response = await fetch(`/api/watchless/jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '无法取消任务。');
      setJob((current) => current ? { ...current, ...result.data } : result.data as WatchlessJob);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : '无法取消任务。');
    } finally { setCancelling(false); }
  };

  const retryJob = async () => {
    if (!job || job.status !== 'failed' || job.sourceKind !== 'url') return;
    setRetrying(true); setError(null);
    try {
      const response = await fetch(`/api/watchless/jobs/${encodeURIComponent(job.id)}/retry`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '无法重新运行任务。');
      setJob((current) => current ? { ...current, ...result.data } : result.data as WatchlessJob);
      await loadJob();
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : '无法重新运行任务。');
    } finally { setRetrying(false); }
  };

  const copyJobId = async () => {
    if (!job) return;
    try {
      await navigator.clipboard.writeText(job.id);
      setCopied(true); window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('浏览器未允许复制，请手动选择任务编号。');
    }
  };

  return (
    <AppFrame currentLabel="Watchless" showViewTabs={false} mainClassName="mx-auto w-full max-w-[1400px] flex-grow p-4 sm:p-6 lg:p-8">
      <section className="dashboard-panel mx-auto w-full max-w-5xl overflow-hidden rounded-2xl">
        <div className="border-b border-[var(--border-soft)] p-5 sm:p-7 lg:p-9">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                {job?.status === 'failed' ? <AlertTriangle size={15} aria-hidden="true" /> : <LoaderCircle size={15} className={TERMINAL_STATUSES.has(job?.status || '') ? '' : 'animate-spin motion-reduce:animate-none'} aria-hidden="true" />}
                Watchless processing
              </div>
              <h1 className="mt-3 text-2xl font-bold text-[var(--heading)] sm:text-3xl">{loading && !job ? '正在读取任务…' : copy.label}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">{copy.detail}</p>
              {job?.title ? <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[var(--heading)]">{job.title}</p> : null}
            </div>
            {job ? <span className={`w-fit shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${job.status === 'failed' ? 'border-[#d8b7b7] bg-[#fff5f5] text-[var(--danger)]' : job.status === 'completed' ? 'border-[#b7d5cb] bg-[#eef8f4] text-[var(--btn-primary)]' : 'border-[var(--border-soft)] bg-[var(--paper-subtle)] text-[var(--text-secondary)]'}`}>{job.status === 'failed' ? '未扣费' : stageLabel(job.stage || job.status)}</span> : null}
          </div>
          <div className="mt-7" aria-label={`转换进度：${progress}%`}>
            <div className="mb-2 flex items-center justify-between gap-4 text-xs text-[var(--text-muted)]"><span>{job ? stageLabel(job.stage || job.status) : '正在载入'}</span><span className="tabular-nums">{progress}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--paper-subtle)]"><div className={`h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none ${job?.status === 'failed' ? 'bg-[var(--danger)]' : 'bg-[var(--btn-primary)]'}`} style={{ width: `${progress}%` }} /></div>
          </div>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.85fr)]">
          <div className="p-5 sm:p-7 lg:p-9">
            <div className="flex items-end justify-between gap-4">
              <div><h2 className="text-lg font-bold text-[var(--heading)]">转换阶段</h2><p className="mt-1 text-sm text-[var(--text-muted)]">后续任务会逐步记录每个子阶段及时间。</p></div>
              <span className="shrink-0 text-xs text-[var(--text-muted)]">共 {stageDefinitions.length} 步</span>
            </div>
            <ol className="mt-6 space-y-1">
              {stageDefinitions.map((stage, index) => {
                const completed = job?.status === 'completed' || (activeStageIndex >= 0 && index < activeStageIndex);
                const failed = job?.status === 'failed' && activeStageIndex === index;
                const active = !job ? loading && index === 0 : (!TERMINAL_STATUSES.has(job.status) && activeStageIndex === index);
                return (
                  <li key={stage.id} className="relative flex gap-4 pb-5 last:pb-0">
                    {index < stageDefinitions.length - 1 ? <span className="absolute left-[11px] top-7 h-[calc(100%-18px)] w-px bg-[var(--border-soft)]" aria-hidden="true" /> : null}
                    <span className={`relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${completed ? 'border-[var(--btn-primary)] bg-[var(--btn-primary)] text-[var(--btn-primary-text)]' : failed ? 'border-[var(--danger)] bg-[#fff5f5] text-[var(--danger)]' : active ? 'border-[var(--btn-primary)] bg-[var(--paper)] text-[var(--btn-primary)]' : 'border-[var(--border-medium)] bg-[var(--paper)] text-[var(--text-muted)]'}`}>
                      {completed ? <Check size={14} strokeWidth={2.5} aria-hidden="true" /> : failed ? <AlertTriangle size={13} aria-hidden="true" /> : active ? <LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Circle size={8} fill="currentColor" aria-hidden="true" />}
                    </span>
                    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className={`text-sm font-semibold ${failed ? 'text-[var(--danger)]' : 'text-[var(--heading)]'}`}>{stage.label}</h3>{failed ? <span className="text-xs font-medium text-[var(--danger)]">在此停止</span> : null}{active ? <span className="text-xs font-medium text-[var(--btn-primary)]">进行中</span> : null}</div><p className="mt-1 text-sm leading-5 text-[var(--text-muted)]">{stage.detail}</p></div>
                  </li>
                );
              })}
            </ol>

            {job?.status === 'failed' && activeStageIndex < 0 ? <div className="mt-6 rounded-xl border border-[var(--border-soft)] bg-[var(--paper-subtle)] px-4 py-3 text-sm leading-6 text-[var(--text-secondary)]">这条任务创建于详细阶段记录上线前，旧数据只能确认任务已启动并最终失败，不能可靠标出停在哪一步。</div> : null}

            {failure ? (
              <div className="mt-7 rounded-xl border border-[#d8b7b7] bg-[#fff8f6] p-4 sm:p-5" role="alert">
                <div className="flex gap-3"><AlertTriangle className="mt-0.5 shrink-0 text-[var(--danger)]" size={20} aria-hidden="true" /><div><h2 className="font-bold text-[var(--heading)]">{failure.title}</h2><p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{failure.detail}</p></div></div>
                <details className="mt-4 border-t border-[#ead1cd] pt-3 text-sm"><summary className="cursor-pointer font-semibold text-[var(--text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--btn-primary)]">查看技术信息</summary><dl className="mt-3 grid gap-2 text-xs leading-5 text-[var(--text-muted)]"><div><dt className="inline font-semibold">错误代码：</dt><dd className="inline break-all">{job?.errorCode || 'UNKNOWN'}</dd></div><div><dt className="inline font-semibold">原始信息：</dt><dd className="inline break-words">{job?.errorMessage || 'No error message was recorded.'}</dd></div></dl></details>
              </div>
            ) : null}

            {job?.assets?.length ? (
              <section className="mt-7 border-t border-[var(--border-soft)] pt-5" aria-labelledby="saved-artifacts-title">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h2 id="saved-artifacts-title" className="text-sm font-bold text-[var(--heading)]">已保存的过程产物</h2>
                    <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">阶段完成后立即写入对象存储；即使转换失败也会保留，便于诊断和复用。</p>
                  </div>
                  <span className="text-xs text-[var(--text-muted)]">{job.assets.length} 个</span>
                </div>
                <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                  {job.assets.map((asset) => (
                    <li key={asset.id}>
                      <a href={asset.downloadUrl} className="group flex min-h-16 items-center justify-between gap-3 rounded-xl border border-[var(--border-soft)] bg-[var(--paper-subtle)] px-3.5 py-3 hover:border-[var(--border-medium)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--btn-primary)]">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-[var(--heading)]">{artifactLabel(asset.assetPath, asset.role)}</span>
                          <span className="mt-1 block truncate text-xs text-[var(--text-muted)]">{asset.assetPath} · {formatBytes(asset.sizeBytes)}</span>
                        </span>
                        <Download size={16} className="shrink-0 text-[var(--text-muted)] group-hover:text-[var(--heading)]" aria-hidden="true" />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {job?.events?.length ? (
              <details className="mt-7 border-t border-[var(--border-soft)] pt-5"><summary className="cursor-pointer text-sm font-semibold text-[var(--heading)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--btn-primary)]">阶段记录（{job.events.length}）</summary><ol className="mt-4 space-y-3">{job.events.map((event) => <li key={event.id} className="flex gap-3 text-sm"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--btn-primary)]" aria-hidden="true" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><span className="font-semibold text-[var(--heading)]">{stageLabel(event.stage)}</span><time className="text-xs tabular-nums text-[var(--text-muted)]">{formatDate(event.createdAt)}</time></div>{event.message ? <p className="mt-1 text-[var(--text-muted)]">{event.message}</p> : null}</div></li>)}</ol></details>
            ) : null}
          </div>

          <aside className="border-t border-[var(--border-soft)] bg-[var(--paper-subtle)] p-5 sm:p-7 lg:border-l lg:border-t-0 lg:p-8" aria-label="任务详情">
            <h2 className="text-sm font-bold text-[var(--heading)]">运行详情</h2>
            <dl className="mt-4 divide-y divide-[var(--border-soft)] border-y border-[var(--border-soft)] text-sm">
              <div className="py-3"><dt className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><Clock3 size={14} aria-hidden="true" />总耗时</dt><dd className="mt-1 font-semibold text-[var(--heading)]">{elapsed}</dd></div>
              <div className="py-3"><dt className="text-xs text-[var(--text-muted)]">提交时间</dt><dd className="mt-1 tabular-nums text-[var(--text-secondary)]">{formatDate(job?.createdAt)}</dd></div>
              <div className="py-3"><dt className="text-xs text-[var(--text-muted)]">开始时间</dt><dd className="mt-1 tabular-nums text-[var(--text-secondary)]">{formatDate(job?.startedAt)}</dd></div>
              <div className="py-3"><dt className="text-xs text-[var(--text-muted)]">{job?.status === 'failed' ? '失败时间' : '最后更新'}</dt><dd className="mt-1 tabular-nums text-[var(--text-secondary)]">{formatDate(job?.completedAt || job?.updatedAt)}</dd></div>
              <div className="py-3"><dt className="text-xs text-[var(--text-muted)]">处理模型</dt><dd className="mt-1 break-words text-[var(--text-secondary)]">{modelLabel(job?.model || null)}</dd></div>
              <div className="py-3"><dt className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><FileText size={14} aria-hidden="true" />已生成产物</dt><dd className="mt-1 text-[var(--text-secondary)]">{job ? `${job.assets.length} 个` : '—'}</dd></div>
              <div className="py-3"><dt className="text-xs text-[var(--text-muted)]">任务编号</dt><dd className="mt-1 flex items-center gap-2"><code className="min-w-0 truncate text-xs text-[var(--text-secondary)]">{job?.id || '—'}</code>{job ? <button type="button" onClick={copyJobId} className="shrink-0 rounded p-1 text-[var(--text-muted)] hover:bg-[var(--paper)] hover:text-[var(--heading)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--btn-primary)]" aria-label="复制任务编号"><Copy size={14} aria-hidden="true" /></button> : null}</dd>{copied ? <p className="mt-1 text-xs text-[var(--btn-primary)]" role="status">已复制</p> : null}</div>
            </dl>

            <div className="mt-6 rounded-xl border border-[var(--border-soft)] bg-[var(--paper)] p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-[var(--heading)]"><Coins size={17} aria-hidden="true" />积分</div>
              <div className="mt-3 flex items-end justify-between gap-4"><span className="text-2xl font-bold tabular-nums text-[var(--heading)]">{job?.creditsReserved ?? '—'}</span><span className={`text-xs font-semibold ${job?.creditStatus === 'refunded' ? 'text-[var(--btn-primary)]' : 'text-[var(--text-muted)]'}`}>{job?.creditStatus === 'refunded' ? '已全额退回' : job?.creditStatus === 'charged' ? '已扣除' : job?.creditStatus === 'reserved' ? '处理中暂时冻结' : '无需积分'}</span></div>
              {job?.creditStatus === 'refunded' ? <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">失败任务不会收费，积分已经回到你的账户。</p> : null}
            </div>

            <div className="mt-6 space-y-2">
              {job?.sourceUrl ? <a href={job.sourceUrl} target="_blank" rel="noreferrer" className="flex w-full items-center justify-between rounded-lg border border-[var(--border-medium)] bg-[var(--paper)] px-4 py-2.5 text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--heading)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--btn-primary)]">打开 YouTube 来源 <ExternalLink size={15} aria-hidden="true" /></a> : null}
              {job?.status === 'completed' && job.outputPodcastId ? <Link href={`/dashboard/${job.outputPodcastId}`} className="flex w-full items-center justify-between rounded-lg bg-[var(--btn-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)]">查看播客记录 <ChevronRight size={16} aria-hidden="true" /></Link> : null}
              {job?.status === 'failed' && job.sourceKind === 'url' ? <button type="button" onClick={retryJob} disabled={retrying} className="flex w-full items-center justify-between rounded-lg bg-[var(--btn-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] disabled:opacity-50"><span>{retrying ? '正在重新启动…' : '重新运行这条任务'}</span><ChevronRight size={16} aria-hidden="true" /></button> : null}
              {canCancel ? <button type="button" onClick={cancelJob} disabled={cancelling} className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--paper)] px-4 py-2.5 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--paper-subtle)] disabled:opacity-50">{cancelling ? '正在取消…' : '取消任务并退回积分'}</button> : null}
              {job && TERMINAL_STATUSES.has(job.status) && job.status !== 'completed' ? <Link href="/upload" className="flex w-full items-center justify-between rounded-lg border border-[var(--border-medium)] bg-[var(--paper)] px-4 py-2.5 text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--heading)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--btn-primary)]">返回上传页 <ChevronRight size={16} aria-hidden="true" /></Link> : null}
            </div>
            {job?.status === 'failed' ? <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">重新运行不会占用新的每日提交名额；系统会重新检查 1000 积分门槛，现有过程产物会保留到新版产物写入。</p> : null}
          </aside>
        </div>
        {error ? <p className="border-t border-[var(--border-soft)] px-5 py-4 text-sm text-[var(--danger)] sm:px-7" role="alert">{error}</p> : null}
      </section>
    </AppFrame>
  );
}
