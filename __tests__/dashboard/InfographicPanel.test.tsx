import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import InfographicPanel from '../../components/dashboard/InfographicPanel';

const response = (data: unknown) => ({ ok: true, json: async () => ({ success: true, data }) }) as Response;
const unavailable = { status: 'unavailable', artifactUrl: null, mediaType: null, model: null, promptVersion: null, updatedAt: null, canRetry: false };
const failed = { ...unavailable, status: 'failed', canRetry: true };

describe('InfographicPanel', () => {
  beforeEach(() => { global.fetch = jest.fn(async () => response(unavailable)) as jest.Mock; });
  test('offers manual generation only to an editor', async () => {
    render(<InfographicPanel podcastId="podcast-1" canEdit title="Test" />);
    expect(await screen.findByText('Infographic was not generated for this analysis.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Generate infographic' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/infographics/podcast-1/generate', { method: 'POST' }));
  });
  test('does not expose commands to a public reader', async () => {
    render(<InfographicPanel podcastId="podcast-1" canEdit={false} title="Test" />);
    await screen.findByText('Infographic was not generated for this analysis.');
    expect(screen.queryByRole('button', { name: 'Generate infographic' })).not.toBeInTheDocument();
  });

  test('ignores an old podcast response after the panel is retargeted', async () => {
    let resolveFirst: ((value: Response) => void) | undefined;
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      if (String(input).includes('podcast-1')) return new Promise<Response>(resolve => { resolveFirst = resolve; });
      return Promise.resolve(response(unavailable));
    });
    const { rerender } = render(<InfographicPanel podcastId="podcast-1" canEdit title="First" />);
    rerender(<InfographicPanel podcastId="podcast-2" canEdit title="Second" />);
    expect(await screen.findByText('Infographic was not generated for this analysis.')).toBeInTheDocument();
    resolveFirst?.(response({ ...unavailable, status: 'completed', artifactUrl: '/old.svg' }));
    await waitFor(() => expect(screen.queryByAltText('Infographic for Second')).not.toBeInTheDocument());
  });

  test('keeps retry available when a retry command fails', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/retry')) return { ok: false, json: async () => ({ success: false, error: 'Temporary service error' }) } as Response;
      return response(failed);
    });
    render(<InfographicPanel podcastId="podcast-1" canEdit title="Test" />);
    const retry = await screen.findByRole('button', { name: 'Retry infographic' });
    fireEvent.click(retry);
    expect(await screen.findByRole('alert')).toHaveTextContent('Temporary service error');
    expect(screen.getByRole('button', { name: 'Retry infographic' })).toBeInTheDocument();
  });
});
