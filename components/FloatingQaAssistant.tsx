'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
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
  panelHeight?: number;
}

const MAX_INPUT_LENGTH = 1000;

export default function FloatingQaAssistant({
  podcastId,
  enabled,
  panelHeight,
}: FloatingQaAssistantProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messageListRef = useRef<HTMLDivElement | null>(null);
  const loadedHistoryPodcastIdRef = useRef<string | null>(null);

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
    if (!enabled) {
      setMessages([]);
      setInput('');
      setError(null);
      loadedHistoryPodcastIdRef.current = null;
      return;
    }
    setMessages([]);
    setInput('');
    setError(null);
    loadedHistoryPodcastIdRef.current = null;
  }, [podcastId, enabled]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending, scrollToBottom]);

  const loadHistory = useCallback(async () => {
    if (!enabled) {
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
  }, [enabled, podcastId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const sendQuestion = useCallback(
    async (rawQuestion: string) => {
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
            suggested: false,
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
      await sendQuestion(input);
    },
    [input, sendQuestion]
  );

  if (!enabled) {
    return null;
  }

  const shouldMatchHeight = typeof panelHeight === 'number' && panelHeight > 0;

  return (
    <aside
      className="dashboard-panel w-full min-h-[320px] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      style={shouldMatchHeight ? { height: panelHeight } : undefined}
    >
      <div className="border-b border-slate-700/70 px-4 py-3">
        <p className="text-base font-semibold tracking-wide text-sky-300">Podcast Assistant</p>
        <p className="text-xs text-slate-400 mt-1">Ask deeper questions from transcript</p>
      </div>

      <div ref={messageListRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
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

      <form onSubmit={handleSubmit} className="shrink-0 border-t border-slate-700/70 p-3 bg-slate-950/90">
        <textarea
          value={input}
          onChange={event => setInput(event.target.value.slice(0, MAX_INPUT_LENGTH))}
          placeholder="输入你的问题，例如：有哪些被忽略但关键的数据？"
          rows={2}
          className="w-full resize-none rounded-xl border border-slate-600/65 bg-slate-900/90 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void sendQuestion(input);
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
    </aside>
  );
}
