import { NextResponse } from 'next/server';

interface AdminGuardOk {
  ok: true;
  email: string;
}

interface AdminGuardFail {
  ok: false;
  response: NextResponse;
}

export type AdminGuardResult = AdminGuardOk | AdminGuardFail;

function parseAdminEmailAllowlist(): string[] {
  const raw = String(process.env.ADMIN_EMAILS || '').trim();
  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmailAllowed(email: string | null | undefined): boolean {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    return false;
  }

  const allowlist = parseAdminEmailAllowlist();
  if (allowlist.length === 0) {
    return process.env.NODE_ENV !== 'production';
  }

  return allowlist.includes(normalizedEmail);
}

export async function requireAdminAccess(): Promise<AdminGuardResult> {
  if (process.env.NODE_ENV === 'test') {
    return {
      ok: true,
      email: 'test@local.dev',
    };
  }

  const [{ getServerSession }, { authOptions }] = await Promise.all([
    import('next-auth/next'),
    import('./auth'),
  ]);
  const session = await getServerSession(authOptions);
  const email = String(session?.user?.email || '').trim().toLowerCase();

  if (!email) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          code: 'AUTH_REQUIRED',
          error: 'Authentication required.',
        },
        { status: 401 },
      ),
    };
  }

  if (!isAdminEmailAllowed(email)) {
    if (parseAdminEmailAllowlist().length === 0 && process.env.NODE_ENV === 'production') {
      return {
        ok: false,
        response: NextResponse.json(
          {
            success: false,
            code: 'ADMIN_ALLOWLIST_NOT_CONFIGURED',
            error: 'Server admin allowlist is not configured.',
          },
          { status: 503 },
        ),
      };
    }
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          code: 'ADMIN_FORBIDDEN',
          error: 'Admin permission required.',
        },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    email,
  };
}
