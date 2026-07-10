/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { GET } from '../../app/api/extension/auth/google/start/route';
import { issueExtensionAccessToken } from '../../lib/extensionAuth';
import { ensureGoogleAuthUser } from '../../lib/googleAuthUser';

jest.mock('next-auth/next', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('../../lib/auth', () => ({
  authOptions: {},
}));

jest.mock('../../lib/googleAuthUser', () => ({
  ensureGoogleAuthUser: jest.fn(),
}));

jest.mock('../../lib/extensionAuth', () => {
  class MockExtensionAuthError extends Error {
    code: string;
    status: number;

    constructor(code: string, status: number, message: string) {
      super(message);
      this.name = 'ExtensionAuthError';
      this.code = code;
      this.status = status;
    }
  }

  return {
    ExtensionAuthError: MockExtensionAuthError,
    issueExtensionAccessToken: jest.fn(),
  };
});

const mockGetServerSession = getServerSession as unknown as jest.Mock;
const mockEnsureGoogleAuthUser = ensureGoogleAuthUser as jest.Mock;
const mockIssueExtensionAccessToken = issueExtensionAccessToken as jest.Mock;

const extensionId = 'bgohgakmnepefbcccanofomnhodflnab';
const redirectUri = `https://${extensionId}.chromiumapp.org/podsum-google`;

function buildRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost:3000/api/extension/auth/google/start');
  url.searchParams.set('redirectUri', params.redirectUri || redirectUri);
  url.searchParams.set('nonce', params.nonce || 'nonce-123');
  return new NextRequest(url);
}

beforeEach(() => {
  jest.clearAllMocks();

  mockEnsureGoogleAuthUser.mockResolvedValue({
    id: 'user-123',
    email: 'demo@example.com',
    name: 'Demo User',
  });
  mockIssueExtensionAccessToken.mockReturnValue({
    accessToken: 'extension-token-123',
    expiresIn: 604800,
  });
});

describe('Extension Google auth start API', () => {
  it('rejects non-Chrome redirect URIs', async () => {
    const response = await GET(buildRequest({ redirectUri: 'https://example.com/callback' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.code).toBe('INVALID_REDIRECT_URI');
  });

  it('rejects Chrome redirect URIs for extensions outside the allowlist', async () => {
    const response = await GET(buildRequest({
      redirectUri: 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.chromiumapp.org/podsum-google',
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('INVALID_REDIRECT_URI');
  });

  it('redirects unauthenticated users to sign in with a resume callback', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await GET(buildRequest());
    const location = response.headers.get('location') || '';
    const parsed = new URL(location);

    expect(response.status).toBe(307);
    expect(parsed.pathname).toBe('/auth/signin');
    expect(parsed.searchParams.get('callbackUrl')).toContain('/api/extension/auth/google/start');
    expect(parsed.searchParams.get('callbackUrl')).toContain(encodeURIComponent(redirectUri));
  });

  it('exchanges an authenticated session for an extension token redirect', async () => {
    mockGetServerSession.mockResolvedValue({
      user: {
        email: 'demo@example.com',
        name: 'Demo User',
      },
    });

    const response = await GET(buildRequest());
    const location = response.headers.get('location') || '';
    const parsed = new URL(location);
    const fragment = new URLSearchParams(parsed.hash.slice(1));

    expect(response.status).toBe(307);
    expect(parsed.origin).toBe(`https://${extensionId}.chromiumapp.org`);
    expect(fragment.get('accessToken')).toBe('extension-token-123');
    expect(fragment.get('expiresIn')).toBe('604800');
    expect(fragment.get('userId')).toBe('user-123');
    expect(fragment.get('email')).toBe('demo@example.com');
    expect(fragment.get('nonce')).toBe('nonce-123');
    expect(mockEnsureGoogleAuthUser).toHaveBeenCalledWith({
      email: 'demo@example.com',
      name: 'Demo User',
    });
  });
});
