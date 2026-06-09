'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import AppFrame from '@/components/AppFrame';

type MonitorPath = '' | 'path1' | 'path2';
type MonitorStatus =
  | ''
  | 'received'
  | 'accepted'
  | 'transcribing'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed';

interface MonitorTask {
  id: string;
  path: 'path1' | 'path2';
  status: string;
  stage: string;
  userEmail: string | null;
  clientTaskId: string | null;
  traceId: string | null;
  sourceReference: string | null;
  videoId: string | null;
  title: string | null;
  isPublic: boolean;
  transcriptionJobId: string | null;
  podcastId: string | null;
  providerTaskId: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastHttpStatus: number | null;
  createdAt: string;
  updatedAt: string;
}

interface MonitorEvent {
  id: number;
  taskId: string;
  level: 'info' | 'warn' | 'error';
  stage: string;
  endpoint: string | null;
  httpStatus: number | null;
  message: string | null;
  requestHeaders: unknown;
  requestBody: unknown;
  responseHeaders: unknown;
  responseBody: unknown;
  errorStack: string | null;
  meta: unknown;
  createdAt: string;
}

interface ListResponse {
  success: boolean;
  error?: string;
  data?: {
    tasks: MonitorTask[];
    pagination: {
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    };
    monitor: {
      enabled: boolean;
      captureRaw: boolean;
    };
  };
}

interface DetailResponse {
  success: boolean;
  error?: string;
  data?: {
    task: MonitorTask;
    events: MonitorEvent[];
    monitor: {
      enabled: boolean;
      captureRaw: boolean;
    };
  };
}

function toDatetimeLocal(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return '-';
  }
  return date.toLocaleString();
}

export default function ExtensionMonitorPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [path, setPath] = useState<MonitorPath>('');
  const [taskStatus, setTaskStatus] = useState<MonitorStatus>('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<MonitorTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<MonitorTask | null>(null);
  const [events, setEvents] = useState<MonitorEvent[]>([]);
  const [captureRaw, setCaptureRaw] = useState(false);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const fetchList = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (path) {
        params.set('path', path);
      }
      if (taskStatus) {
        params.set('status', taskStatus);
      }
      if (query.trim()) {
        params.set('q', query.trim());
      }
      if (from.trim()) {
        params.set('from', from.trim());
      }
      if (to.trim()) {
        params.set('to', to.trim());
      }

      const response = await fetch(`/api/ops/extension-monitor/tasks?${params.toString()}`);
      const result = (await response.json()) as ListResponse;
      if (!response.ok || !result.success || !result.data) {
        throw new Error(result.error || `Request failed (${response.status})`);
      }

      setTasks(result.data.tasks || []);
      setTotal(result.data.pagination.total || 0);
      setTotalPages(result.data.pagination.totalPages || 1);
      setCaptureRaw(Boolean(result.data.monitor.captureRaw));
      if (!selectedTaskId && result.data.tasks.length > 0) {
        setSelectedTaskId(result.data.tasks[0].id);
      }
      if (selectedTaskId && !result.data.tasks.find((task) => task.id === selectedTaskId)) {
        setSelectedTaskId(result.data.tasks[0]?.id || null);
      }
    } catch (listError) {
      setError(listError instanceof Error ? listError.message : String(listError));
      setTasks([]);
      setTotal(0);
      setTotalPages(1);
      setSelectedTaskId(null);
      setSelectedTask(null);
      setEvents([]);
    } finally {
      setLoadingList(false);
    }
  }, [page, pageSize, path, query, selectedTaskId, taskStatus, from, to]);

  const fetchDetail = useCallback(async (taskId: string) => {
    if (!taskId) {
      return;
    }
    setLoadingDetail(true);
    try {
      const response = await fetch(`/api/ops/extension-monitor/tasks/${encodeURIComponent(taskId)}`);
      const result = (await response.json()) as DetailResponse;
      if (!response.ok || !result.success || !result.data) {
        throw new Error(result.error || `Request failed (${response.status})`);
      }
      setSelectedTask(result.data.task);
      setEvents(result.data.events || []);
      setCaptureRaw(Boolean(result.data.monitor.captureRaw));
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : String(detailError));
      setSelectedTask(null);
      setEvents([]);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/auth/signin?callbackUrl=/ops/extension-monitor');
      return;
    }

    if (status === 'authenticated') {
      fetchList();
    }
  }, [status, router, fetchList]);

  useEffect(() => {
    if (!selectedTaskId) {
      return;
    }
    fetchDetail(selectedTaskId);
  }, [selectedTaskId, fetchDetail]);

  useEffect(() => {
    if (!autoRefresh || status !== 'authenticated') {
      return;
    }
    const timer = setInterval(() => {
      fetchList();
      if (selectedTaskId) {
        fetchDetail(selectedTaskId);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchDetail, fetchList, selectedTaskId, status]);

  const hasPrevPage = page > 1;
  const hasNextPage = page < totalPages;

  const selectedTaskTitle = useMemo(() => {
    if (!selectedTask) {
      return '未选择任务';
    }
    return selectedTask.title || selectedTask.videoId || selectedTask.id;
  }, [selectedTask]);

  if (status === 'loading') {
    return (
      <div className="dashboard-shell flex min-h-screen items-center justify-center text-[var(--text-main)]" data-theme="light">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-[var(--btn-primary)]"></div>
          <p className="text-[var(--text-muted)]">Loading monitor...</p>
        </div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <div className="dashboard-shell flex min-h-screen items-center justify-center text-[var(--text-main)]" data-theme="light">
        <p className="text-[var(--text-muted)]">Redirecting to sign in...</p>
      </div>
    );
  }

  return (
    <AppFrame currentLabel="Extension Monitor" showViewTabs={false}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--heading)]">Extension Monitor</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Signed in as <span className="font-semibold text-[var(--heading)]">{session?.user?.email}</span>
          </p>
        </div>
        <span className={[
          'rounded-lg border px-3 py-1.5 text-xs font-semibold',
          captureRaw
            ? 'border-[#d6bd86] bg-[#fff6df] text-[#765a20]'
            : 'border-[var(--border-soft)] bg-[var(--accent-soft)] text-[var(--heading)]',
        ].join(' ')}
        >
          Raw logs {captureRaw ? 'on' : 'off'}
        </span>
      </div>

      <div className="space-y-4">
        <section className="dashboard-panel rounded-lg p-4">
          <div className="grid md:grid-cols-6 gap-3">
            <select
              value={path}
              onChange={(event) => {
                setPath(event.target.value as MonitorPath);
                setPage(1);
              }}
              className="rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm text-[var(--text-main)]"
            >
              <option value="">全部路径</option>
              <option value="path1">Path1</option>
              <option value="path2">Path2</option>
            </select>
            <select
              value={taskStatus}
              onChange={(event) => {
                setTaskStatus(event.target.value as MonitorStatus);
                setPage(1);
              }}
              className="rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm text-[var(--text-main)]"
            >
              <option value="">全部状态</option>
              <option value="received">received</option>
              <option value="accepted">accepted</option>
              <option value="transcribing">transcribing</option>
              <option value="queued">queued</option>
              <option value="processing">processing</option>
              <option value="completed">completed</option>
              <option value="failed">failed</option>
            </select>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="搜索邮箱/任务ID/trace/video..."
              className="rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] md:col-span-2"
            />
            <input
              type="datetime-local"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm text-[var(--text-main)]"
            />
            <input
              type="datetime-local"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm text-[var(--text-main)]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-3">
            <button
              onClick={() => fetchList()}
              disabled={loadingList}
              className="rounded-lg bg-[var(--btn-primary)] px-4 py-2 text-sm font-semibold text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] disabled:opacity-50"
            >
              {loadingList ? '刷新中...' : '刷新'}
            </button>
            <label className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
              />
              自动刷新（5s）
            </label>
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              className="rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] px-3 py-2 text-sm text-[var(--text-main)]"
            >
              <option value={10}>10 / 页</option>
              <option value={20}>20 / 页</option>
              <option value={50}>50 / 页</option>
            </select>
            <span className="text-sm text-[var(--text-muted)]">总计 {total} 条</span>
          </div>
        </section>

        {error && (
          <section className="rounded-lg border border-[#d8b7b7] bg-[#fff5f5] p-3 text-sm text-[var(--danger)]">{error}</section>
        )}

        <section className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <div className="dashboard-panel overflow-hidden rounded-lg">
            <div className="border-b border-[var(--border-soft)] px-4 py-3 text-sm font-semibold text-[var(--heading)]">任务列表</div>
            <div className="max-h-[70vh] overflow-auto">
              {tasks.length === 0 ? (
                <div className="p-4 text-sm text-[var(--text-muted)]">暂无任务</div>
              ) : (
                <ul className="divide-y divide-[var(--border-soft)]">
                  {tasks.map((task) => (
                    <li
                      key={task.id}
                      className={`cursor-pointer p-3 transition-colors hover:bg-[var(--paper-muted)] ${
                        selectedTaskId === task.id ? 'bg-[var(--accent-soft)]' : ''
                      }`}
                      onClick={() => setSelectedTaskId(task.id)}
                    >
                      <div className="flex justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--text-main)]">{task.title || task.videoId || task.id}</p>
                          <p className="truncate text-xs text-[var(--text-muted)]">
                            {task.userEmail || 'unknown'} · {task.path.toUpperCase()} · {task.stage}
                          </p>
                        </div>
                        <span
                          className={`h-fit rounded-lg px-2 py-1 text-xs font-semibold ${
                            task.status === 'failed'
                              ? 'bg-[#fff5f5] text-[var(--danger)]'
                              : task.status === 'completed'
                                ? 'bg-[var(--accent-soft)] text-[var(--heading)]'
                                : 'bg-[var(--paper-muted)] text-[var(--text-secondary)]'
                          }`}
                        >
                          {task.status}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-[var(--text-muted)]">
                        更新于 {toDatetimeLocal(task.updatedAt)}
                        {task.lastErrorMessage ? ` · 错误: ${task.lastErrorMessage}` : ''}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-[var(--border-soft)] px-4 py-3">
              <button
                disabled={!hasPrevPage}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="rounded-lg border border-[var(--border-soft)] px-3 py-1 text-sm font-medium text-[var(--text-secondary)] disabled:opacity-50"
              >
                上一页
              </button>
              <span className="text-xs text-[var(--text-muted)]">
                第 {page} / {Math.max(1, totalPages)} 页
              </span>
              <button
                disabled={!hasNextPage}
                onClick={() => setPage((current) => current + 1)}
                className="rounded-lg border border-[var(--border-soft)] px-3 py-1 text-sm font-medium text-[var(--text-secondary)] disabled:opacity-50"
              >
                下一页
              </button>
            </div>
          </div>

          <div className="dashboard-panel overflow-hidden rounded-lg">
            <div className="border-b border-[var(--border-soft)] px-4 py-3 text-sm font-semibold text-[var(--heading)]">
              任务详情 · {selectedTaskTitle}
            </div>
            {loadingDetail ? (
              <div className="p-4 text-sm text-[var(--text-muted)]">加载详情中...</div>
            ) : !selectedTask ? (
              <div className="p-4 text-sm text-[var(--text-muted)]">请选择左侧任务</div>
            ) : (
              <div className="max-h-[70vh] overflow-auto p-4 space-y-4">
                <div className="text-sm space-y-1">
                  <p>
                    <span className="text-[var(--text-muted)]">Task ID:</span> {selectedTask.id}
                  </p>
                  <p>
                    <span className="text-[var(--text-muted)]">Client Task:</span> {selectedTask.clientTaskId || '-'}
                  </p>
                  <p>
                    <span className="text-[var(--text-muted)]">Trace:</span> {selectedTask.traceId || '-'}
                  </p>
                  <p>
                    <span className="text-[var(--text-muted)]">Transcription Job:</span> {selectedTask.transcriptionJobId || '-'}
                  </p>
                  <p>
                    <span className="text-[var(--text-muted)]">Podcast ID:</span> {selectedTask.podcastId || '-'}
                  </p>
                  <p>
                    <span className="text-[var(--text-muted)]">Provider Task:</span> {selectedTask.providerTaskId || '-'}
                  </p>
                </div>

                <div className="rounded-lg border border-[var(--border-soft)]">
                  <div className="border-b border-[var(--border-soft)] px-3 py-2 text-xs font-semibold text-[var(--heading)]">事件时间线</div>
                  <div className="divide-y divide-[var(--border-soft)]">
                    {events.length === 0 ? (
                      <div className="px-3 py-3 text-xs text-[var(--text-muted)]">暂无事件</div>
                    ) : (
                      events.map((event) => (
                        <details key={event.id} className="px-3 py-2">
                          <summary className="flex cursor-pointer items-center gap-2 text-xs text-[var(--text-main)]">
                            <span
                              className={`inline-block w-2 h-2 rounded-full ${
                                event.level === 'error'
                                  ? 'bg-red-400'
                                  : event.level === 'warn'
                                    ? 'bg-amber-400'
                                    : 'bg-emerald-400'
                              }`}
                            />
                            <span>{event.stage}</span>
                            <span className="text-[var(--text-muted)]">{toDatetimeLocal(event.createdAt)}</span>
                          </summary>
                          <div className="mt-2 space-y-2">
                            <p className="text-xs text-[var(--text-muted)]">{event.message || '-'}</p>
                            <pre className="overflow-auto rounded-lg border border-[var(--pre-border)] bg-[var(--pre-bg)] p-2 text-[11px] text-[var(--pre-text)]">
{JSON.stringify(
  {
    endpoint: event.endpoint,
    httpStatus: event.httpStatus,
    requestHeaders: event.requestHeaders,
    requestBody: event.requestBody,
    responseHeaders: event.responseHeaders,
    responseBody: event.responseBody,
    meta: event.meta,
    errorStack: event.errorStack,
  },
  null,
  2,
)}
                            </pre>
                          </div>
                        </details>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </AppFrame>
  );
}
