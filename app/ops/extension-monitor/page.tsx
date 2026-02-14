'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';

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

    if (session?.user?.id) {
      fetchList();
    }
  }, [session?.user?.id, status, router, fetchList]);

  useEffect(() => {
    if (!selectedTaskId) {
      return;
    }
    fetchDetail(selectedTaskId);
  }, [selectedTaskId, fetchDetail]);

  useEffect(() => {
    if (!autoRefresh || !session?.user?.id) {
      return;
    }
    const timer = setInterval(() => {
      fetchList();
      if (selectedTaskId) {
        fetchDetail(selectedTaskId);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchDetail, fetchList, selectedTaskId, session?.user?.id]);

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
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-500 mx-auto mb-4"></div>
          <p className="text-slate-400">Loading monitor...</p>
        </div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <p className="text-slate-400">Redirecting to sign in...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="p-4 bg-slate-800/60 backdrop-blur-md shadow-lg sticky top-0 z-10">
        <div className="container mx-auto">
          <nav className="flex items-center space-x-2 text-xl mb-3">
            <Link href="/" className="inline-flex items-center gap-2 text-sky-400 hover:underline font-semibold">
              <Image src="/podcast-summarizer-icon.svg" alt="PodSum logo" width={22} height={22} />
              <span>PodSum.cc</span>
            </Link>
            <span className="text-slate-400">/</span>
            <span className="text-white font-medium">Extension Monitor</span>
          </nav>
          <p className="text-sm text-slate-300">
            已登录：<span className="text-sky-300">{session?.user?.email}</span> · Raw 日志：
            <span className={captureRaw ? 'text-amber-300' : 'text-emerald-300'}>
              {captureRaw ? ' 开启' : ' 关闭'}
            </span>
          </p>
        </div>
      </header>

      <main className="container mx-auto p-4 space-y-4">
        <section className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
          <div className="grid md:grid-cols-6 gap-3">
            <select
              value={path}
              onChange={(event) => {
                setPath(event.target.value as MonitorPath);
                setPage(1);
              }}
              className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
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
              className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
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
              className="md:col-span-2 bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
            />
            <input
              type="datetime-local"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setPage(1);
              }}
              className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
            />
            <input
              type="datetime-local"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setPage(1);
              }}
              className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-3">
            <button
              onClick={() => fetchList()}
              disabled={loadingList}
              className="bg-sky-600 hover:bg-sky-700 disabled:opacity-50 px-4 py-2 rounded text-sm font-medium"
            >
              {loadingList ? '刷新中...' : '刷新'}
            </button>
            <label className="inline-flex items-center gap-2 text-sm text-slate-300">
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
              className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
            >
              <option value={10}>10 / 页</option>
              <option value={20}>20 / 页</option>
              <option value={50}>50 / 页</option>
            </select>
            <span className="text-sm text-slate-400">总计 {total} 条</span>
          </div>
        </section>

        {error && (
          <section className="bg-red-900/40 border border-red-700 rounded-lg p-3 text-red-100 text-sm">{error}</section>
        )}

        <section className="grid lg:grid-cols-[1.1fr_1fr] gap-4">
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-700 text-sm text-slate-300">任务列表</div>
            <div className="max-h-[70vh] overflow-auto">
              {tasks.length === 0 ? (
                <div className="p-4 text-sm text-slate-400">暂无任务</div>
              ) : (
                <ul className="divide-y divide-slate-700">
                  {tasks.map((task) => (
                    <li
                      key={task.id}
                      className={`p-3 cursor-pointer hover:bg-slate-700/30 ${
                        selectedTaskId === task.id ? 'bg-sky-900/20' : ''
                      }`}
                      onClick={() => setSelectedTaskId(task.id)}
                    >
                      <div className="flex justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{task.title || task.videoId || task.id}</p>
                          <p className="text-xs text-slate-400 truncate">
                            {task.userEmail || 'unknown'} · {task.path.toUpperCase()} · {task.stage}
                          </p>
                        </div>
                        <span
                          className={`text-xs px-2 py-1 rounded h-fit ${
                            task.status === 'failed'
                              ? 'bg-red-900/60 text-red-200'
                              : task.status === 'completed'
                                ? 'bg-emerald-900/60 text-emerald-200'
                                : 'bg-slate-700 text-slate-200'
                          }`}
                        >
                          {task.status}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        更新于 {toDatetimeLocal(task.updatedAt)}
                        {task.lastErrorMessage ? ` · 错误: ${task.lastErrorMessage}` : ''}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="px-4 py-3 border-t border-slate-700 flex items-center justify-between">
              <button
                disabled={!hasPrevPage}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="px-3 py-1 text-sm rounded border border-slate-600 disabled:opacity-50"
              >
                上一页
              </button>
              <span className="text-xs text-slate-400">
                第 {page} / {Math.max(1, totalPages)} 页
              </span>
              <button
                disabled={!hasNextPage}
                onClick={() => setPage((current) => current + 1)}
                className="px-3 py-1 text-sm rounded border border-slate-600 disabled:opacity-50"
              >
                下一页
              </button>
            </div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-700 text-sm text-slate-300">
              任务详情 · {selectedTaskTitle}
            </div>
            {loadingDetail ? (
              <div className="p-4 text-sm text-slate-400">加载详情中...</div>
            ) : !selectedTask ? (
              <div className="p-4 text-sm text-slate-400">请选择左侧任务</div>
            ) : (
              <div className="max-h-[70vh] overflow-auto p-4 space-y-4">
                <div className="text-sm space-y-1">
                  <p>
                    <span className="text-slate-400">Task ID:</span> {selectedTask.id}
                  </p>
                  <p>
                    <span className="text-slate-400">Client Task:</span> {selectedTask.clientTaskId || '-'}
                  </p>
                  <p>
                    <span className="text-slate-400">Trace:</span> {selectedTask.traceId || '-'}
                  </p>
                  <p>
                    <span className="text-slate-400">Transcription Job:</span> {selectedTask.transcriptionJobId || '-'}
                  </p>
                  <p>
                    <span className="text-slate-400">Podcast ID:</span> {selectedTask.podcastId || '-'}
                  </p>
                  <p>
                    <span className="text-slate-400">Provider Task:</span> {selectedTask.providerTaskId || '-'}
                  </p>
                </div>

                <div className="border border-slate-700 rounded">
                  <div className="px-3 py-2 border-b border-slate-700 text-xs text-slate-300">事件时间线</div>
                  <div className="divide-y divide-slate-700">
                    {events.length === 0 ? (
                      <div className="px-3 py-3 text-xs text-slate-400">暂无事件</div>
                    ) : (
                      events.map((event) => (
                        <details key={event.id} className="px-3 py-2">
                          <summary className="cursor-pointer text-xs text-slate-200 flex items-center gap-2">
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
                            <span className="text-slate-400">{toDatetimeLocal(event.createdAt)}</span>
                          </summary>
                          <div className="mt-2 space-y-2">
                            <p className="text-xs text-slate-400">{event.message || '-'}</p>
                            <pre className="text-[11px] bg-slate-900 p-2 rounded overflow-auto">
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
      </main>
    </div>
  );
}
