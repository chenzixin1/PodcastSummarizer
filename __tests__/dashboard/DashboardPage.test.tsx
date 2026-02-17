import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useParams } from 'next/navigation';
import DashboardPage from '../../app/dashboard/[id]/page';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
}));

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

  mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/analysis/')) {
      return {
        ok: true,
        json: async () => analysisPayload,
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
      expect(screen.getByText('English first')).toBeInTheDocument();
      expect(screen.getByText('中文第一条')).toBeInTheDocument();
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
      expect(screen.getByText(/Terrestrial infrastructure evolves rapidly\./)).toBeInTheDocument();
      expect(screen.getByText(/Complementary architecture supports deployment\./)).toBeInTheDocument();
      expect(document.querySelectorAll('.hint-pronounce-word').length).toBeGreaterThanOrEqual(2);
      expect(document.querySelectorAll('.hint-dict-pos').length).toBeGreaterThanOrEqual(2);
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

    mockFetch.mockImplementationOnce(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/analysis/')) {
        return {
          ok: true,
          json: async () => alignedPayload,
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
      expect(screen.getByText('Aligned summary EN')).toBeInTheDocument();
      expect(screen.getByText('对齐后的摘要中文')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Full Text'));
    await waitFor(() => {
      expect(screen.getByText('Aligned full text EN')).toBeInTheDocument();
      expect(screen.getByText('（未匹配，待校对）')).toBeInTheDocument();
    });
  });
});
