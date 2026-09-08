'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AppFrame from '../../../components/AppFrame';
import type { WatchlessJob } from '../../../lib/watchless/jobs';
import { broadWatchlessStage, WATCHLESS_STAGE_DEFINITIONS, watchlessProgress } from '../../../lib/watchless/jobPresentation';

const FILTERS = { all: '全部', queued: '排队 / 待上传', running: '处理中', completed: '成功', failed: '失败', closed: '已取消 / 撤回' };
const STATUS: Record<string, string> = {
  created: '已创建', awaiting_upload: '等待 MCP 上传', queued: '排队中', preparing: '准备视频',
  transcribing: '转录中', segmenting: '分段中', rendering: '生成图文', validating: '检查产物',
  publishing: '发布中', completed: '转换成功', failed: '转换失败', cancelled: '已取消', rolled_back: '已撤回',
};
const STAGES: Record<string, string> = {
  preparing_metadata: '读取视频信息', preparing_download: '下载视频', preparing_audio: '提取音频',
  transcribing_upload: '上传音频并转录', segmenting_structure: '划分场景', segmenting_translation: '逐条翻译',
  rendering_keyframes: '提取关键帧', validating_assets: '核对附件', validating_languages: '检查中英文',
};
const CONTROL = 'min-h-11 rounded-lg border border-[var(--border-soft)] px-4 py-2 text-sm font-medium hover:bg-[var(--paper-muted)] focus-visible:outline focus-visible:outline-2 disabled:opacity-40';

function dateLabel(value: string) {
  const date = new Date(/^\d{4}-\d{2}-\d{2} /.test(value) ? value.replace(' ', 'T') + 'Z' : value);
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { hour12: false });
}

export default function WatchlessJobsPage() {
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [jobs, setJobs] = useState<WatchlessJob[]>([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const response = await fetch(`/api/watchless/jobs?page=${page}&status=${filter}`, { cache: 'no-store', signal: controller.signal });
        if (!active) return;
        if (response.status === 401 || response.status === 403) {
          setNeedsLogin(true); setJobs([]); return;
        }
        if (!response.ok) throw new Error('暂时无法读取任务，请重试。');
        const result = await response.json();
        if (!active) return;
        if (!result.success || !Array.isArray(result.data) || !result.pagination) throw new Error('任务数据暂时不可用，请重试。');
        setNeedsLogin(false);
        setJobs(result.data);
        setPagination(result.pagination);
      } catch (cause) {
        if (active && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : '读取任务失败');
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; controller.abort(); };
  }, [filter, page, refresh]);

  useEffect(() => {
    if (needsLogin) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setRefresh(value => value + 1);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [needsLogin]);

  return <AppFrame currentLabel="我的任务" showViewTabs={false} mainClassName="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold text-[var(--heading)]">我的转换任务</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">URL 提交与 MCP 上传的全部历史。转换成功不代表后续摘要分析已完成。</p></div>
      <Link href="/upload" className={CONTROL}>提交新任务</Link>
    </div>
    {needsLogin ? <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--paper-base)] p-6">
      <h2 className="text-lg font-semibold">登录后查看自己的任务</h2>
      <Link className={`${CONTROL} mt-4 inline-flex items-center`} href="/api/auth/signin?callbackUrl=%2Fwatchless%2Fjobs">登录</Link>
    </section> : <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <label htmlFor="task-status" className="text-sm">任务状态</label>
        <select id="task-status" value={filter} onChange={event => { setJobs([]); setFilter(event.target.value); setPage(1); }} className={`${CONTROL} bg-[var(--paper-base)]`}>
          {Object.entries(FILTERS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button className={CONTROL} disabled={loading} onClick={() => setRefresh(value => value + 1)}>刷新</button>
        <span role="status" className="text-sm text-[var(--text-muted)]">{loading ? '正在更新…' : `共 ${pagination.total} 个任务 · 每 15 秒更新`}</span>
      </div>
      {error && <p role="alert" className="mb-4 rounded-lg border border-red-300 p-4 text-[var(--text-main)]">{error} 上次显示的内容可能已过期。</p>}
      {!loading && !error && !jobs.length && <p className="rounded-xl border border-[var(--border-soft)] p-8 text-center">{filter === 'all' ? '还没有转换任务。提交视频链接或使用 MCP 上传后，会显示在这里。' : '没有符合这个状态的任务。'}</p>}
      <ol className="space-y-4" aria-label="转换任务列表" aria-busy={loading}>
        {jobs.map(job => {
          const progress = watchlessProgress(job.status, job.progressCurrent, job.progressTotal);
          const stage = STAGES[job.stage || ''] || WATCHLESS_STAGE_DEFINITIONS.find(item => item.id === broadWatchlessStage(job.stage))?.label || STATUS[job.stage || ''] || STATUS[job.status];
          const credits = { reserved: `已预留 ${job.creditsReserved} 积分`, charged: `已扣除 ${job.creditsReserved} 积分`, refunded: `已退回 ${job.creditsReserved} 积分`, none: '未扣积分' }[job.creditStatus] || '积分状态未知';
          return <li key={job.id} className="min-w-0 rounded-xl border border-[var(--border-soft)] bg-[var(--paper-base)] p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="min-w-0 flex-1 break-words text-lg font-semibold text-[var(--heading)]"><Link href={`/watchless/jobs/${encodeURIComponent(job.id)}`} className="hover:underline focus-visible:outline">{job.title || (job.videoId ? `YouTube · ${job.videoId}` : 'MCP 图文上传')}</Link></h2>
              <span className="rounded-full bg-[var(--paper-muted)] px-3 py-1 text-sm">{STATUS[job.status] || '状态未知'}</span>
            </div>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">{job.sourceKind === 'url' ? 'URL 提交' : 'MCP 上传'} · {dateLabel(job.createdAt)}</p>
            <div className="my-4"><div className="mb-2 flex justify-between gap-3 text-sm"><span>{job.status === 'failed' ? '停止阶段' : '当前阶段'}：{stage}</span><span>{progress}%</span></div>
              <div role="progressbar" aria-label="转换进度" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-[var(--paper-muted)]"><div className="h-full rounded-full bg-[var(--btn-primary)]" style={{ width: `${progress}%` }} /></div></div>
            {job.errorMessage && <p className="mb-4 break-words rounded-lg border border-[var(--border-soft)] bg-[var(--paper-muted)] p-3 text-sm">失败原因：{job.errorMessage}</p>}
            <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-[var(--text-secondary)]">{credits}</span>
              <div className="flex flex-wrap gap-2"><Link className={CONTROL} href={`/watchless/jobs/${encodeURIComponent(job.id)}`}>任务详情</Link>
                {job.outputPodcastId && job.status !== 'rolled_back' && <Link className={CONTROL} href={`/dashboard/${encodeURIComponent(job.outputPodcastId)}`}>查看文章</Link>}</div>
            </div>
          </li>;
        })}
      </ol>
      <nav aria-label="任务分页" className="mt-6 flex flex-wrap items-center justify-center gap-4">
        <button className={CONTROL} disabled={loading || pagination.page <= 1} onClick={() => { setJobs([]); setPage(pagination.page - 1); }}>上一页</button>
        <span className="text-sm">第 {pagination.page} / {pagination.totalPages} 页</span>
        <button className={CONTROL} disabled={loading || pagination.page >= pagination.totalPages} onClick={() => { setJobs([]); setPage(pagination.page + 1); }}>下一页</button>
      </nav>
    </>}
  </AppFrame>;
}
