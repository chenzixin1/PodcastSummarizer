import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useSession } from 'next-auth/react';
import HomeWorkspace from '../../components/home/HomeWorkspace';
import type { PodcastApiRow } from '../../components/home/homeModel';

const { renderToStaticMarkup } = jest.requireActual<typeof import('react-dom/server')>('react-dom/server.node');

jest.mock('next-auth/react', () => ({
  signOut: jest.fn(),
  useSession: jest.fn(),
}));

const mockRouterPrefetch = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    prefetch: mockRouterPrefetch,
  }),
}));

jest.mock('next/link', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const MockLink = ReactModule.forwardRef<
    HTMLAnchorElement,
    React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean }
  >(function MockLink({ href, prefetch, ...props }, ref) {
    return ReactModule.createElement('a', {
      ...props,
      ref,
      href,
      'data-prefetch': prefetch === false ? 'false' : 'default',
    });
  });

  return { __esModule: true, default: MockLink };
});

const mockFetch = jest.fn();
global.fetch = mockFetch;

function podcastRow(id: string, isPublic = true): PodcastApiRow {
  return {
    id,
    title: isPublic ? `Public episode ${id}` : 'SYNTHETIC PRIVATE TITLE',
    originalFileName: `${id}.srt`,
    briefSummary: `Summary for ${id}`,
    fileSize: '3.7 KB',
    blobUrl: `https://cdn.example.com/${id}.srt`,
    sourceReference: `https://www.youtube.com/watch?v=${id}`,
    sourcePublishedAt: '2026-07-09T10:00:00.000Z',
    createdAt: '2026-07-09T11:00:00.000Z',
    processedAt: '2026-07-09T12:00:00.000Z',
    isProcessed: true,
    isPublic,
    wordCount: 1_240,
    durationSec: 480,
    tags: ['AI', 'Engineering'],
  };
}

const initialExploreRows = Array.from({ length: 12 }, (_, index) => podcastRow(`public-${index + 1}`));

function apiResponse(payload: { success: boolean; data: PodcastApiRow[]; error?: string }) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: jest.fn().mockResolvedValue(payload),
    text: jest.fn().mockResolvedValue(JSON.stringify(payload)),
  };
}

class NoopIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds = [0];
  disconnect = jest.fn();
  observe = jest.fn();
  takeRecords = jest.fn(() => []);
  unobserve = jest.fn();
}

describe('HomeWorkspace data boundaries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useSession as jest.Mock).mockReturnValue({ data: null, status: 'loading' });
    global.IntersectionObserver = NoopIntersectionObserver;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
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
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: jest.fn(() => 1),
    });
    Object.defineProperty(window, 'cancelIdleCallback', {
      configurable: true,
      value: jest.fn(),
    });
  });

  test('renders 12 initial public rows while session status is loading', () => {
    render(
      <HomeWorkspace
        initialView="explore"
        initialTag=""
        hasExplicitView={false}
        initialExploreRows={initialExploreRows}
      />,
    );

    initialExploreRows.forEach((row) => {
      expect(screen.getByRole('link', { name: row.title as string })).toBeInTheDocument();
    });
  });

  test('does not refetch public page 1 after hydration', async () => {
    render(
      <HomeWorkspace
        initialView="explore"
        initialTag=""
        hasExplicitView={false}
        initialExploreRows={initialExploreRows}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('does not refetch public page 1 after an empty server fallback', async () => {
    render(
      <HomeWorkspace
        initialView="explore"
        initialTag=""
        hasExplicitView={false}
        initialExploreRows={[]}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole('heading', { name: 'No summaries found' })).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('an authenticated default view requests only private rows and keeps Explore rows available', async () => {
    const privateRow = podcastRow('private-1', false);
    (useSession as jest.Mock).mockReturnValue({
      data: {
        user: { id: 'user-1', name: 'Authenticated user', email: 'user@example.com' },
        expires: '2026-08-01T00:00:00.000Z',
      },
      status: 'authenticated',
    });
    mockFetch.mockResolvedValue(apiResponse({ success: true, data: [privateRow] }));

    render(
      <HomeWorkspace
        initialView="explore"
        initialTag=""
        hasExplicitView={false}
        initialExploreRows={initialExploreRows}
      />,
    );

    expect(await screen.findByRole('link', { name: 'SYNTHETIC PRIVATE TITLE' })).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/podcasts?page=1&pageSize=12&includePrivate=true',
      { cache: 'no-store' },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Explore' }));
    expect(screen.getByRole('link', { name: 'Public episode public-1' })).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('an unauthenticated session never requests private rows', async () => {
    (useSession as jest.Mock).mockReturnValue({ data: null, status: 'unauthenticated' });

    render(
      <HomeWorkspace
        initialView="my"
        initialTag=""
        hasExplicitView
        initialExploreRows={initialExploreRows}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Sign in to see My Summaries' })).toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('an authenticated explicit Explore view does not request private rows', async () => {
    (useSession as jest.Mock).mockReturnValue({
      data: {
        user: { id: 'user-1', name: 'Authenticated user', email: 'user@example.com' },
        expires: '2026-08-01T00:00:00.000Z',
      },
      status: 'authenticated',
    });

    render(
      <HomeWorkspace
        initialView="explore"
        initialTag=""
        hasExplicitView
        initialExploreRows={initialExploreRows}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole('link', { name: 'Public episode public-1' })).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('applies new server search params after same-page navigation', async () => {
    const { rerender } = render(
      <HomeWorkspace
        initialView="explore"
        initialTag=""
        hasExplicitView
        initialExploreRows={initialExploreRows}
      />,
    );

    rerender(
      <HomeWorkspace
        initialView="topics"
        initialTag="Engineering"
        hasExplicitView
        initialExploreRows={initialExploreRows}
      />,
    );

    expect(await screen.findByRole('button', { name: 'All topics' })).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('includes public dashboard links in server-rendered markup', () => {
    const html = renderToStaticMarkup(
      <HomeWorkspace
        initialView="explore"
        initialTag=""
        hasExplicitView={false}
        initialExploreRows={initialExploreRows}
      />,
    );

    expect(html).toContain('/dashboard/public-1');
    expect(html).toContain('Public episode public-1');
    expect(html).not.toContain('SYNTHETIC PRIVATE TITLE');
  });

  test('uses deterministic UTC dates for the cover and visible metadata in server-rendered markup', () => {
    const boundaryRow = {
      ...podcastRow('utc-boundary'),
      sourcePublishedAt: '2026-07-09T23:30:00.000Z',
    };
    const html = renderToStaticMarkup(
      <HomeWorkspace
        initialView="explore"
        initialTag=""
        hasExplicitView={false}
        initialExploreRows={[boundaryRow]}
      />,
    );

    expect(html).toContain('JUL 9 / 8MIN');
    expect(html).toContain('Jul 9, 2026');
  });

  test('disables viewport prefetch for Upload, Dashboard, About, and account-menu links', () => {
    (useSession as jest.Mock).mockReturnValue({
      data: {
        user: { id: 'user-1', name: 'Authenticated user', email: 'user@example.com' },
        expires: '2026-08-01T00:00:00.000Z',
      },
      status: 'authenticated',
    });

    render(
      <HomeWorkspace
        initialView="explore"
        initialTag=""
        hasExplicitView
        initialExploreRows={initialExploreRows.slice(0, 1)}
      />,
    );

    const card = screen.getByRole('article');
    const dashboardLinks = within(card)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href') === '/dashboard/public-1');
    expect(dashboardLinks).toHaveLength(2);

    const deferredMenuLinks = ['Profile', 'Credits', 'Pricing', 'MCP', 'Extension', 'About']
      .map((name) => screen.getByRole('link', { name, hidden: true }));

    const uploadLink = screen.getByRole('link', { name: 'Upload' });

    [uploadLink, ...dashboardLinks, ...deferredMenuLinks].forEach((link) => {
      expect(link).toHaveAttribute('data-prefetch', 'false');
    });
    expect(screen.getByRole('link', { name: 'Explore', hidden: true })).toHaveAttribute('data-prefetch', 'default');
    expect(mockRouterPrefetch).not.toHaveBeenCalled();
  });

  test('disables viewport prefetch for authentication links', () => {
    (useSession as jest.Mock).mockReturnValue({ data: null, status: 'unauthenticated' });

    render(
      <HomeWorkspace
        initialView="my"
        initialTag=""
        hasExplicitView
        initialExploreRows={initialExploreRows.slice(0, 1)}
      />,
    );

    const signInLinks = screen.getAllByRole('link', { name: 'Sign in' });
    expect(signInLinks).toHaveLength(2);
    signInLinks.forEach((link) => {
      expect(link).toHaveAttribute('data-prefetch', 'false');
    });
  });

  test('prefetches a Dashboard only after card hover or keyboard focus', () => {
    render(
      <HomeWorkspace
        initialView="explore"
        initialTag=""
        hasExplicitView
        initialExploreRows={initialExploreRows.slice(0, 1)}
      />,
    );

    const titleLink = screen.getByRole('link', { name: 'Public episode public-1' });
    const viewLink = within(screen.getByRole('article')).getByRole('link', { name: 'View' });

    expect(mockRouterPrefetch).not.toHaveBeenCalled();

    fireEvent.mouseEnter(titleLink);
    expect(mockRouterPrefetch).toHaveBeenCalledTimes(1);
    expect(mockRouterPrefetch).toHaveBeenLastCalledWith('/dashboard/public-1');

    fireEvent.focus(viewLink);
    expect(mockRouterPrefetch).toHaveBeenCalledTimes(2);
    expect(mockRouterPrefetch).toHaveBeenLastCalledWith('/dashboard/public-1');
  });

  test('renders editorial covers in the initial card render without idle scheduling', () => {
    render(
      <HomeWorkspace
        initialView="explore"
        initialTag=""
        hasExplicitView
        initialExploreRows={initialExploreRows.slice(0, 1)}
      />,
    );

    expect(window.requestIdleCallback).not.toHaveBeenCalled();
    expect(within(screen.getByRole('article')).getByLabelText(/^AI: PUBLIC EPISODE PUBLIC$/)).toBeInTheDocument();
  });

  test('keeps input updates and filtering correct with 60 summary rows', async () => {
    const rows = Array.from({ length: 60 }, (_, index) => podcastRow(`search-${index + 1}`));
    rows[42] = {
      ...rows[42],
      title: 'Quantum Needle Episode',
      briefSummary: 'The only matching result.',
    };

    render(
      <HomeWorkspace
        initialView="explore"
        initialTag=""
        hasExplicitView
        initialExploreRows={rows}
      />,
    );

    const searchInput = screen.getByPlaceholderText('Search summaries...');
    fireEvent.change(searchInput, { target: { value: '  QUANTUM NEEDLE  ' } });

    expect(searchInput).toHaveValue('  QUANTUM NEEDLE  ');
    await waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(1);
    });
    expect(screen.getByRole('link', { name: 'Quantum Needle Episode' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Public episode search-1' })).not.toBeInTheDocument();
  });
});
