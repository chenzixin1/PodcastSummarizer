import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import InfographicPanel from '../../components/dashboard/InfographicPanel';

const response = (data: unknown) => ({ ok: true, json: async () => ({ success: true, data }) }) as Response;
const unavailable = { status: 'unavailable', artifactUrl: null, mediaType: null, model: null, promptVersion: null, updatedAt: null, canRetry: false };

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
});
