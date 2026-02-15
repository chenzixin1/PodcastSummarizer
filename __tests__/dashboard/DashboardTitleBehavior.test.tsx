import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useParams } from 'next/navigation';
import DashboardPage from '../../app/dashboard/[id]/page';

jest.mock('react-markdown', () => {
  return ({ children }: { children: React.ReactNode }) => <>{children}</>;
});

jest.mock('remark-gfm', () => {
  return () => null;
});

const mockFetch = jest.fn();
global.fetch = mockFetch;

function buildAnalysisResponse(payload: unknown) {
  return {
    status: 200,
    json: jest.fn().mockResolvedValue(payload),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (useParams as jest.Mock).mockReturnValue({ id: 'podcast-123' });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    writable: true,
    value: jest.fn(),
  });
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
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Dashboard title source', () => {
  test('uses podcast.title for processed records', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        buildAnalysisResponse({
          success: true,
          data: {
            podcast: {
              id: 'podcast-123',
              title: 'Original YouTube Title',
              originalFileName: 'I9aGC6Ui3eE.srt',
              fileSize: '1.00 KB',
              sourceReference: 'https://www.youtube.com/watch?v=I9aGC6Ui3eE',
            },
            analysis: {
              summary: 'summary',
              translation: 'translation',
              highlights: 'highlights',
              processedAt: '2026-02-15T00:00:00.000Z',
            },
            isProcessed: true,
            canEdit: false,
            processingJob: null,
          },
        }),
      ),
    );

    render(<DashboardPage />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/analysis/podcast-123',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    expect((await screen.findAllByText('Original YouTube Title')).length).toBeGreaterThan(0);
    expect(screen.getByText('I9aGC6Ui3eE.srt')).toBeInTheDocument();
    expect(screen.queryByText(/Transcript Analysis:/i)).not.toBeInTheDocument();
  });

  test('keeps podcast.title in unprocessed branch during polling refresh', async () => {
    jest.useFakeTimers();

    mockFetch.mockImplementation(() =>
      Promise.resolve(
        buildAnalysisResponse({
          success: true,
          data: {
            podcast: {
              id: 'podcast-123',
              title: 'Queued YouTube Title',
              originalFileName: 'I9aGC6Ui3eE.srt',
              fileSize: '1.00 KB',
              sourceReference: 'https://www.youtube.com/watch?v=I9aGC6Ui3eE',
            },
            analysis: null,
            isProcessed: false,
            canEdit: false,
            processingJob: {
              status: 'queued',
              progressCurrent: 0,
              progressTotal: 0,
              statusMessage: 'queued',
              updatedAt: '2026-02-15T00:00:00.000Z',
            },
          },
        }),
      ),
    );

    render(<DashboardPage />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    expect((await screen.findAllByText('Queued YouTube Title')).length).toBeGreaterThan(0);

    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });

    await waitFor(() => {
      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getAllByText('Queued YouTube Title').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Transcript Analysis:/i)).not.toBeInTheDocument();
  });
});
