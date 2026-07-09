import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import DashboardPage from '../../app/dashboard/[id]/page';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
}));

jest.mock('next-auth/react', () => ({
  useSession: jest.fn(),
}));

jest.mock('react-markdown', () => {
  return ({ children }: { children: React.ReactNode }) => <>{children}</>;
});

jest.mock('remark-gfm', () => {
  return () => null;
});

jest.mock('../../components/FloatingQaAssistant', () => {
  return function MockFloatingQaAssistant() {
    return <div>QA Assistant</div>;
  };
});

jest.mock('../../components/MindMapCanvas', () => {
  return function MockMindMapCanvas() {
    return <div>MindMap</div>;
  };
});

const mockFetch = jest.fn();
global.fetch = mockFetch;

const analysisPayload = {
  success: true,
  data: {
    podcast: {
      originalFileName: 'test.srt',
      fileSize: '1234',
      blobUrl: null,
      sourceReference: null,
      isPublic: false,
      title: 'Demo Podcast',
      userId: 'owner',
    },
    analysis: {
      summaryZh: '# 中文总结\n## 核心观点\n- 中文第一条\n- 中文第二条',
      summaryEn: '# English Summary\n## Key Takeaways\n- English first\n- English second',
      highlights: '**[00:00:02]** 中文内容第一句。\n\n**[00:00:09]** 中文内容第二句。',
      translation: '**[00:00:02]** Terrestrial infrastructure evolves rapidly.\n\n**[00:00:09]** Complementary architecture supports deployment.',
      fullTextBilingualJson: null,
      summaryBilingualJson: null,
      bilingualAlignmentVersion: 0,
      mindMapJsonZh: null,
      mindMapJsonEn: null,
      processedAt: new Date().toISOString(),
    },
    isProcessed: true,
    processingJob: null,
    canEdit: false,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  (useParams as jest.Mock).mockReturnValue({ id: 'test-id-123' });
  (useSession as jest.Mock).mockReturnValue({ data: null, status: 'unauthenticated' });
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });

  mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/analysis/')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => analysisPayload,
        text: async () => JSON.stringify(analysisPayload),
      } as Response;
    }

    if (url === '/vocab/advanced-words.json') {
      return {
        ok: true,
        json: async () => ({
          terrestrial: { zh: '地球上的' },
          infrastructure: { zh: '基础设施' },
          complementary: { zh: '互补的' },
          architecture: { zh: '体系结构' },
        }),
      } as Response;
    }

    if (url === '/api/vocab-hints') {
      return {
        ok: true,
        json: async () => ({
          success: true,
          hints: {
            terrestrial: '地面端的',
            infrastructure: '底层设施',
            complementary: '互补协同的',
            architecture: '架构体系',
          },
        }),
      } as Response;
    }

    return {
      ok: false,
      status: 404,
      json: async () => ({ success: false }),
      text: async () => '',
    } as Response;
  });
});

describe('DashboardPage language modes', () => {
  test('uses a completed public static snapshot without calling the analysis API', async () => {
    const snapshotPayload = JSON.parse(JSON.stringify(analysisPayload));
    snapshotPayload.data.podcast.title = 'Static Snapshot Podcast';
    snapshotPayload.data.podcast.isPublic = true;

    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/snapshots/analysis/')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => snapshotPayload,
          text: async () => JSON.stringify(snapshotPayload),
        } as Response;
      }

      if (url.includes('/api/analysis/')) {
        throw new Error('DB analysis API should not be called on snapshot hit.');
      }

      if (url === '/vocab/advanced-words.json') {
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({ success: false }),
        text: async () => '',
      } as Response;
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getAllByText('Static Snapshot Podcast').length).toBeGreaterThan(0);
    });
    expect(mockFetch.mock.calls.some(([input]) => String(input).includes('/api/analysis/'))).toBe(false);
  });

  test('fetches stored /api/files transcripts from the current origin', async () => {
    const payload = JSON.parse(JSON.stringify(analysisPayload));
    payload.data.podcast.blobUrl = 'https://podsum.cc/api/files/podcast-123-transcript.srt';
    payload.data.podcast.sourceReference = 'https://www.youtube.com/watch?v=I9aGC6Ui3eE';

    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/snapshots/analysis/')) {
        return {
          ok: false,
          status: 404,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ success: false }),
        } as Response;
      }

      if (url.includes('/api/analysis/')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify(payload),
        } as Response;
      }

      if (url === '/api/files/podcast-123-transcript.srt') {
        return {
          ok: true,
          status: 200,
          text: async () => '1\n00:00:01,000 --> 00:00:02,000\nTranscript from same-origin file API.',
        } as Response;
      }

      if (url === '/vocab/advanced-words.json') {
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }

      return {
        ok: false,
        status: 404,
        text: async () => '',
      } as Response;
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/files/podcast-123-transcript.srt');
    });
    expect(mockFetch.mock.calls.some(([input]) => String(input).startsWith('https://podsum.cc/api/files/'))).toBe(false);
  });

  test('shows four language mode buttons and persists selection', async () => {
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('中文')).toBeInTheDocument();
      expect(screen.getByText('English')).toBeInTheDocument();
      expect(screen.getByText('中英对照')).toBeInTheDocument();
      expect(screen.getByText('词汇提示')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('中英对照'));
    expect(window.localStorage.getItem('podsum-dashboard-content-language')).toBe('bilingual');
  });

  test('renders bilingual summary in alternating english/chinese lines', async () => {
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Summary')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('中英对照'));

    await waitFor(() => {
      expect(document.body).toHaveTextContent('English first');
      expect(document.body).toHaveTextContent('中文第一条');
    });
  });

  test('renders hint mode with interactive dictionary links on english full text', async () => {
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Full Text')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Full Text'));
    await userEvent.click(screen.getByText('词汇提示'));

    await waitFor(() => {
      expect(document.body).toHaveTextContent('Terrestrial');
      expect(document.body).toHaveTextContent('infrastructure');
      expect(document.body).toHaveTextContent('evolves rapidly.');
      expect(document.body).toHaveTextContent('Complementary');
      expect(document.body).toHaveTextContent('architecture');
      expect(document.body).toHaveTextContent('supports deployment.');
      expect(document.body).toHaveTextContent('#pronounce:terrestrial');
      expect(document.body).toHaveTextContent('#pronounce:architecture');
    });

    expect(mockFetch.mock.calls.some(([input]) => String(input).includes('/api/vocab-hints'))).toBe(false);
  });

  test('prefers aligned bilingual payload when available', async () => {
    const alignedPayload = JSON.parse(JSON.stringify(analysisPayload));
    alignedPayload.data.analysis.summaryBilingualJson = {
      version: 1,
      sections: [
        {
          sectionKey: 'key_takeaways',
          sectionTitleEn: 'Key Takeaways',
          sectionTitleZh: '核心观点',
          pairs: [
            {
              order: 1,
              en: 'Aligned summary EN',
              zh: '对齐后的摘要中文',
              enTimestamp: null,
              zhTimestamp: null,
              matchMethod: 'llm',
              confidence: 0.81,
            },
          ],
        },
      ],
    };
    alignedPayload.data.analysis.fullTextBilingualJson = {
      version: 1,
      pairs: [
        {
          order: 1,
          en: 'Aligned full text EN',
          zh: '（未匹配，待校对）',
          enTimestamp: '00:00:02',
          zhTimestamp: null,
          matchMethod: 'missing',
          confidence: 0,
        },
      ],
    };
    alignedPayload.data.analysis.bilingualAlignmentVersion = 1;

    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/snapshots/analysis/')) {
        return {
          ok: false,
          status: 404,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ success: false }),
          text: async () => JSON.stringify({ success: false }),
        } as Response;
      }

      if (url.includes('/api/analysis/')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => alignedPayload,
          text: async () => JSON.stringify(alignedPayload),
        } as Response;
      }

      if (url === '/vocab/advanced-words.json') {
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({ success: false }),
        text: async () => '',
      } as Response;
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Summary')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('中英对照'));
    await waitFor(() => {
      expect(document.body).toHaveTextContent('Aligned summary EN');
      expect(document.body).toHaveTextContent('对齐后的摘要中文');
    });

    await userEvent.click(screen.getByText('Full Text'));
    await waitFor(() => {
      expect(document.body).toHaveTextContent('Aligned full text EN');
      expect(document.body).toHaveTextContent('（未匹配，待校对）');
    });
  });
});
