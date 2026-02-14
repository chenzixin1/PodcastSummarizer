import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateExtensionUser,
  ExtensionAuthError,
  issueExtensionAccessToken,
} from '../../../../../lib/extensionAuth';

export const runtime = 'nodejs';

interface LoginRequestBody {
  email?: string;
  password?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as LoginRequestBody;
    const email = (body?.email || '').trim();
    const password = body?.password || '';

    if (!email || !password) {
      return NextResponse.json(
        {
          success: false,
          code: 'INVALID_REQUEST',
          error: 'Missing email or password.',
        },
        { status: 400 },
      );
    }

    const user = await authenticateExtensionUser(email, password);
    const token = issueExtensionAccessToken(user);

    return NextResponse.json({
      success: true,
      data: {
        accessToken: token.accessToken,
        expiresIn: token.expiresIn,
        user,
      },
    });
  } catch (error) {
    if (error instanceof ExtensionAuthError) {
      return NextResponse.json(
        {
          success: false,
          code: error.code,
          error: error.message,
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        success: false,
        code: 'LOGIN_FAILED',
        error: 'Failed to login extension user.',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
