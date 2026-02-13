'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type MessageRole = 'user' | 'assistant';

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  pending?: boolean;
}

interface QaHistoryEntry {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
}

interface FloatingQaAssistantProps {
  podcastId: string;
  enabled: boolean;
  summary?: string;
  translation?: string;
  highlights?: string;
}

interface PanelPosition {
  x: number;
  y: number;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
}

const PANEL_DEFAULT_WIDTH = 420;
const PANEL_DEFAULT_HEIGHT = 560;
const PANEL_PADDING = 16;
const MAX_INPUT_LENGTH = 1000;

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function sanitizeLine(text: string): string {
  return text
    .replace(/^[#>\-*+\d.\s]+/, '')
    .replace(/[*_`[\]()]/g, '')
    .trim();
}

function extractTopics(text: string): string[] {
  const lines = text.split('\n');
  const topics: string[] = [];

  for (const rawLine of lines) {
    const line = sanitizeLine(rawLine);
    if (!line) {
      continue;
    }
    if (line.length < 8 || line.length > 28) {
      continue;
    }
    topics.push(line);
    if (topics.length >= 3) {
      break;
    }
  }
  return topics;
}

function buildSuggestedQuestions(summary = '', translation = '', highlights = ''): string[] {
  const baseQuestions = [
    '这期内容最关键的 3 个结论是什么？',
    '有哪些容易被忽略但很重要的数据点？',
    '有哪些可执行行动项可以马上落地？',
    '有哪些风险点或不确定性值得重点关注？',
  ];

  const topicSources = [summary, highlights, translation].map(extractTopics).flat();
  const dynamicQuestions = topicSources.slice(0, 2).map(topic => `围绕「${topic}」还有哪些补充信息？`);

  return [...baseQuestions, ...dynamicQuestions].slice(0, 6);
}

export default function FloatingQaAssistant({
  podcastId,
  enabled,
  summary = '',
  translation = '',
  highlights = '',
}: FloatingQaAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<PanelPosition>({ x: 0, y: 0 });
  const [positionReady, setPositionReady] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const hasAutoOpenedRef = useRef(false);
  const loadedHistoryPodcastIdRef = useRef<string | null>(null);

  const suggestedQuestions = useMemo(
    () => buildSuggestedQuestions(summary, translation, highlights),
    [summary, translation, highlights]
  );

  const getPanelSize = useCallback(() => {
    const panel = panelRef.current;
    const width = panel?.offsetWidth || Math.min(PANEL_DEFAULT_WIDTH, window.innerWidth - PANEL_PADDING * 2);
    const height = panel?.offsetHeight || Math.min(PANEL_DEFAULT_HEIGHT, window.innerHeight - PANEL_PADDING * 2);
    return { width, height };
  }, []);

  const clampToViewport = useCallback(
    (nextX: number, nextY: number): PanelPosition => {
      const { width, height } = getPanelSize();
      const maxX = Math.max(PANEL_PADDING, window.innerWidth - width - PANEL_PADDING);
      const maxY = Math.max(PANEL_PADDING, window.innerHeight - height - PANEL_PADDING);
      return {
        x: clamp(nextX, PANEL_PADDING, maxX),
        y: clamp(nextY, PANEL_PADDING, maxY),
      };
    },
    [getPanelSize]
  );

  const getDefaultPosition = useCallback((): PanelPosition => {
    const width = Math.min(PANEL_DEFAULT_WIDTH, window.innerWidth - PANEL_PADDING * 2);
    const height = Math.min(PANEL_DEFAULT_HEIGHT, window.innerHeight - PANEL_PADDING * 2);
    return {
      x: Math.max(PANEL_PADDING, window.innerWidth - width - PANEL_PADDING),
      y: Math.max(PANEL_PADDING, window.innerHeight - height - PANEL_PADDING),
    };
  }, []);

  const syncPositionToViewport = useCallback(() => {
    setPosition(prev => clampToViewport(prev.x, prev.y));
  }, [clampToViewport]);

  useEffect(() => {
    if (!enabled) {
      setIsOpen(false);
      setMessages([]);
      setInput('');
      setError(null);
      setPositionReady(false);
      hasAutoOpenedRef.current = false;
      loadedHistoryPodcastIdRef.current = null;
      return;
    }

    if (!positionReady) {
      setPosition(getDefaultPosition());
      setPositionReady(true);
    }

    if (!hasAutoOpenedRef.current) {
      setIsOpen(true);
      hasAutoOpenedRef.current = true;
    }
  }, [enabled, getDefaultPosition, positionReady]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    setMessages([]);
    setInput('');
    setError(null);
    loadedHistoryPodcastIdRef.current = null;
    hasAutoOpenedRef.current = false;
    setPositionReady(false);
  }, [podcastId, enabled]);

  useEffect(() => {
    if (!isOpen || !enabled) {
      return;
    }
    const onResize = () => {
      syncPositionToViewport();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [enabled, isOpen, syncPositionToViewport]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }
      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      setPosition(
        clampToViewport(dragState.startLeft + deltaX, dragState.startTop + deltaY)
      );
    };

    const endDrag = () => {
      if (!dragStateRef.current) {
        return;
      }
      dragStateRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [clampToViewport]);

  const scrollToBottom = useCallback(() => {
    const element = messageListRef.current;
    if (!element) {
      return;
    }
    element.scrollTo({
      top: element.scrollHeight,
      behavior: 'smooth',
    });
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    scrollToBottom();
  }, [messages, isOpen, sending, scrollToBottom]);

  const loadHistory = useCallback(async () => {
    if (!enabled || !isOpen) {
      return;
    }
    if (loadedHistoryPodcastIdRef.current === podcastId) {
      return;
    }

    setLoadingHistory(true);
    setError(null);
    try {
      const response = await fetch(`/api/qa/${podcastId}?limit=60`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || `Failed to load QA history (${response.status})`);
      }

      const history = Array.isArray(result.data?.messages)
        ? (result.data.messages as QaHistoryEntry[])
        : [];

      const restoredMessages: ChatMessage[] = history.flatMap(item => [
        {
          id: `${item.id}-q`,
          role: 'user',
          content: item.question,
          createdAt: item.createdAt,
        },
        {
          id: `${item.id}-a`,
          role: 'assistant',
          content: item.answer,
          createdAt: item.createdAt,
        },
      ]);

      setMessages(restoredMessages);
      loadedHistoryPodcastIdRef.current = podcastId;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoadingHistory(false);
    }
  }, [enabled, isOpen, podcastId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const sendQuestion = useCallback(
    async (rawQuestion: string, suggested = false) => {
      const question = rawQuestion.trim();
      if (!enabled || !question || sending) {
        return;
      }

      const now = new Date().toISOString();
      const userMessageId = `user-${Date.now().toString(36)}`;
      const pendingMessageId = `assistant-pending-${Date.now().toString(36)}`;

      setInput('');
      setError(null);
      setSending(true);

      setMessages(prev => [
        ...prev,
        { id: userMessageId, role: 'user', content: question, createdAt: now },
        {
          id: pendingMessageId,
          role: 'assistant',
          content: '思考中...',
          createdAt: now,
          pending: true,
        },
      ]);

      try {
        const response = await fetch(`/api/qa/${podcastId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            question,
            suggested,
          }),
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || `Failed to get answer (${response.status})`);
        }

        const answer = typeof result.data?.answer === 'string' ? result.data.answer : '未返回回答内容';
        const answerId = typeof result.data?.id === 'string' ? `${result.data.id}-a` : `assistant-${Date.now().toString(36)}`;
        const createdAt = typeof result.data?.createdAt === 'string' ? result.data.createdAt : now;

        setMessages(prev =>
          prev.map(item =>
            item.id === pendingMessageId
              ? {
                  id: answerId,
                  role: 'assistant',
                  content: answer,
                  createdAt,
                }
              : item
          )
        );
      } catch (sendError) {
        const message = sendError instanceof Error ? sendError.message : String(sendError);
        setError(message);
        setMessages(prev =>
          prev.map(item =>
            item.id === pendingMessageId
              ? {
                  ...item,
                  content: `请求失败：${message}`,
                  pending: false,
                }
              : item
          )
        );
      } finally {
        setSending(false);
      }
    },
    [enabled, podcastId, sending]
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      await sendQuestion(input, false);
    },
    [input, sendQuestion]
  );

  const handleDragStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest('button')) {
        return;
      }

      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: position.x,
        startTop: position.y,
      };

      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'grabbing';
    },
    [position.x, position.y]
  );

  if (!enabled) {
    return null;
  }

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="fixed bottom-5 right-5 z-40 rounded-2xl border border-sky-300/35 bg-sky-500/90 px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_-18px_rgba(56,189,248,0.95)] transition-colors hover:bg-sky-400"
        >
          Ask Assistant
        </button>
      )}

      {isOpen && (
        <div
          ref={panelRef}
          className="fixed z-40 w-[min(92vw,420px)] h-[min(78vh,560px)] rounded-2xl border border-slate-600/50 bg-slate-950/92 text-slate-100 shadow-2xl backdrop-blur-xl"
          style={{ left: position.x, top: position.y }}
        >
          <div
            className="flex items-center justify-between gap-2 border-b border-slate-700/70 px-3.5 py-2.5 cursor-grab active:cursor-grabbing"
            onPointerDown={handleDragStart}
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold tracking-wide text-sky-300">Podcast Assistant</p>
              <p className="text-[11px] text-slate-400 truncate">Drag me · Ask deeper questions from transcript</p>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="shrink-0 rounded-lg border border-slate-600/60 bg-slate-800/80 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
            >
              Close
            </button>
          </div>

          <div className="border-b border-slate-800/70 px-3.5 py-2.5">
            <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400 mb-2">推荐问题</p>
            <div className="flex flex-wrap gap-1.5">
              {suggestedQuestions.map(question => (
                <button
                  key={question}
                  type="button"
                  onClick={() => {
                    void sendQuestion(question, true);
                  }}
                  disabled={sending}
                  className="rounded-full border border-slate-600/60 bg-slate-800/70 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>

          <div ref={messageListRef} className="h-[calc(100%-196px)] overflow-y-auto px-3.5 py-3 space-y-2.5">
            {loadingHistory && (
              <div className="text-xs text-slate-400">Loading history...</div>
            )}

            {!loadingHistory && messages.length === 0 && (
              <div className="rounded-xl border border-slate-700/70 bg-slate-900/70 px-3 py-2.5 text-xs leading-6 text-slate-300">
                处理完成后你可以在这里追问细节。问答会自动保存到数据库，刷新页面后仍可查看。
              </div>
            )}

            {messages.map(message => (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-6 ${
                    message.role === 'user'
                      ? 'bg-sky-500/85 text-white'
                      : 'bg-slate-900 border border-slate-700/70 text-slate-100'
                  }`}
                >
                  {message.role === 'assistant' ? (
                    <div className="qa-markdown">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap break-words">{message.content}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="absolute bottom-0 left-0 right-0 border-t border-slate-700/70 p-3 bg-slate-950/95 rounded-b-2xl">
            <textarea
              value={input}
              onChange={event => setInput(event.target.value.slice(0, MAX_INPUT_LENGTH))}
              placeholder="输入你的问题，例如：有哪些被忽略但关键的数据？"
              rows={2}
              className="w-full resize-none rounded-xl border border-slate-600/65 bg-slate-900/90 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void sendQuestion(input, false);
                }
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-500">{input.length}/{MAX_INPUT_LENGTH}</span>
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? '回答中...' : 'Send'}
              </button>
            </div>
            {error && <p className="mt-1.5 text-[11px] text-rose-300">{error}</p>}
          </form>
        </div>
      )}
    </>
  );
}
