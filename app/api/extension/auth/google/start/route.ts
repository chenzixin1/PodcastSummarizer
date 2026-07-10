import { getServerSession } from 'next-auth/next';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../../../../../lib/auth';
import {
  ExtensionAuthError,
  issueExtensionAccessToken,
} from '../../../../../../lib/extensionAuth';
import { ensureGoogleAuthUser } from '../../../../../../lib/googleAuthUser';

export const runtime = 'nodejs';

type SessionUserWithId = {
  id?: string;
  email?: string | null;
  name?: string | null;
};

const LOCAL_DEVELOPMENT_EXTENSION_ID = 'bgohgakmnepefbcccanofomnhodflnab';

function getAllowedChromeExtensionIds(): Set<string> {
  const configured = String(process.env.CHROME_EXTENSION_IDS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[a-p]{32}$/.test(value));

  if (process.env.NODE_ENV !== 'production') {
    configured.push(LOCAL_DEVELOPMENT_EXTENSION_ID);
  }

  return new Set(configured);
}

function parseChromeRedirectUri(value: string): URL | null {
  try {
    const url = new URL(value);
    const hostnameMatch = url.hostname.toLowerCase().match(/^([a-p]{32})\.chromiumapp\.org$/);
    const extensionId = hostnameMatch?.[1] || '';
    const isChromeExtensionRedirect =
      url.protocol === 'https:' &&
      url.pathname === '/podsum-google' &&
      getAllowedChromeExtensionIds().has(extensionId);
    return isChromeExtensionRedirect ? url : null;
  } catch {
    return null;
  }
}

function buildResumePath(redirectUri: string, nonce: string): string {
  const params = new URLSearchParams();
  params.set('redirectUri', redirectUri);
  if (nonce) {
    params.set('nonce', nonce);
  }
  return `/api/extension/auth/google/start?${params.toString()}`;
}

function redirectToExtension(redirectUri: URL, params: Record<string, string | number | null | undefined>) {
  const finalUrl = new URL(redirectUri.toString());
  const hash = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) {
      continue;
    }
    hash.set(key, String(value));
  }
  finalUrl.hash = hash.toString();
  return redirectResponse(finalUrl);
}

function redirectResponse(url: URL) {
  return new Response(null, {
    status: 307,
    headers: {
      location: url.toString(),
    },
  });
}

export async function GET(request: NextRequest) {
  const redirectUriRaw = request.nextUrl.searchParams.get('redirectUri') || '';
  const nonce = request.nextUrl.searchParams.get('nonce') || '';
  const redirectUri = parseChromeRedirectUri(redirectUriRaw);

  if (!redirectUri) {
    return NextResponse.json(
      {
        success: false,
        code: 'INVALID_REDIRECT_URI',
        error: 'Invalid Chrome extension redirect URI.',
      },
      { status: 400 },
    );
  }

  try {
    const session = await getServerSession(authOptions);
    const sessionUser = session?.user as SessionUserWithId | undefined;

    if (!sessionUser?.email) {
      const signInUrl = new URL('/auth/signin', request.url);
      signInUrl.searchParams.set('callbackUrl', buildResumePath(redirectUriRaw, nonce));
      return redirectResponse(signInUrl);
    }

    const user = await ensureGoogleAuthUser({
      email: sessionUser.email,
      name: sessionUser.name,
    });
    const token = issueExtensionAccessToken(user);

    return redirectToExtension(redirectUri, {
      accessToken: token.accessToken,
      expiresIn: token.expiresIn,
      userId: user.id,
      email: user.email,
      name: user.name,
      nonce,
    });
  } catch (error) {
    if (error instanceof ExtensionAuthError) {
      return redirectToExtension(redirectUri, {
        code: error.code,
        error: error.message,
        nonce,
      });
    }

    return redirectToExtension(redirectUri, {
      code: 'GOOGLE_EXTENSION_LOGIN_FAILED',
      error: 'Failed to finish extension Google login.',
      nonce,
    });
  }
}
