import { NextResponse } from 'next/server';
import { requireAdminAccess } from '../../../../lib/adminGuard';

export const runtime = 'nodejs';

export async function GET() {
  const adminCheck = await requireAdminAccess();
  if (!adminCheck.ok) {
    return adminCheck.response;
  }

  return NextResponse.json({
    openrouterKeySet: Boolean(process.env.OPENROUTER_API_KEY),
    openrouterModel: process.env.OPENROUTER_MODEL || null,
    blobTokenSet: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    postgresUrlSet: Boolean(process.env.POSTGRES_URL),
    nextauthSecretSet: Boolean(process.env.NEXTAUTH_SECRET),
    nextauthUrlSet: Boolean(process.env.NEXTAUTH_URL),
    googleClientIdSet: Boolean(process.env.GOOGLE_CLIENT_ID),
    googleClientSecretSet: Boolean(process.env.GOOGLE_CLIENT_SECRET),
    nodeEnv: process.env.NODE_ENV || null,
    vercelEnv: process.env.VERCEL_ENV || null,
  });
}
