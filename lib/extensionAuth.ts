import bcrypt from 'bcryptjs';
import { createHmac, timingSafeEqual } from 'crypto';
import { getUserByEmail } from './db';

const DEFAULT_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

interface ExtensionTokenPayload {
  uid: string;
  email: string;
  iat: number;
  exp: number;
}

interface DbUserRow {
  id: string;
  email: string;
  name?: string;
  password_hash?: string;
}

export interface ExtensionAuthUser {
  id: string;
  email: string;
  name: string;
}

export class ExtensionAuthError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'ExtensionAuthError';
    this.code = code;
    this.status = status;
  }
}

function toInt(input: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(input || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function base64urlEncode(value: string | Buffer): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64urlDecode(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLen);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function getTokenSecret(): string {
  const secret = (process.env.EXTENSION_TOKEN_SECRET || process.env.NEXTAUTH_SECRET || '').trim();
  if (!secret) {
    throw new ExtensionAuthError('TOKEN_SECRET_MISSING', 503, 'Extension token secret is not configured.');
  }
  return secret;
}

function tokenTtlSeconds(): number {
  return toInt(process.env.EXTENSION_TOKEN_TTL_SECONDS, DEFAULT_TOKEN_TTL_SECONDS);
}

function signInput(input: string, secret: string): string {
  return base64urlEncode(createHmac('sha256', secret).update(input).digest());
}

function safeSignatureEquals(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return timingSafeEqual(aBuffer, bBuffer);
}

export function parseBearerToken(authHeader: string | null): string | null {
  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.trim().split(/\s+/);
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
    return null;
  }
  return token;
}

export function issueExtensionAccessToken(user: ExtensionAuthUser): { accessToken: string; expiresIn: number } {
  const secret = getTokenSecret();
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = tokenTtlSeconds();

  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const payload: ExtensionTokenPayload = {
    uid: user.id,
    email: user.email,
    iat: now,
    exp: now + expiresIn,
  };

  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = signInput(signingInput, secret);

  return {
    accessToken: `${signingInput}.${signature}`,
    expiresIn,
  };
}

export function verifyExtensionAccessToken(token: string): ExtensionAuthUser {
  const secret = getTokenSecret();
  const parts = token.split('.');

  if (parts.length !== 3) {
    throw new ExtensionAuthError('INVALID_TOKEN', 401, 'Invalid extension token format.');
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = signInput(signingInput, secret);

  if (!safeSignatureEquals(signature, expectedSignature)) {
    throw new ExtensionAuthError('INVALID_TOKEN_SIGNATURE', 401, 'Invalid extension token signature.');
  }

  let payload: ExtensionTokenPayload;
  try {
    payload = JSON.parse(base64urlDecode(encodedPayload)) as ExtensionTokenPayload;
  } catch {
    throw new ExtensionAuthError('INVALID_TOKEN_PAYLOAD', 401, 'Invalid extension token payload.');
  }

  if (!payload?.uid || !payload?.email || !payload?.exp) {
    throw new ExtensionAuthError('INVALID_TOKEN_PAYLOAD', 401, 'Invalid extension token payload fields.');
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    throw new ExtensionAuthError('TOKEN_EXPIRED', 401, 'Extension token has expired.');
  }

  return {
    id: payload.uid,
    email: payload.email,
    name: payload.email,
  };
}

export async function authenticateExtensionUser(emailInput: string, password: string): Promise<ExtensionAuthUser> {
  const email = emailInput.trim();
  if (!email || !password) {
    throw new ExtensionAuthError('INVALID_CREDENTIALS', 401, 'Invalid email or password.');
  }

  const userResult = await getUserByEmail(email);
  if (!userResult.success) {
    throw new ExtensionAuthError('INVALID_CREDENTIALS', 401, 'Invalid email or password.');
  }

  const user = userResult.data as DbUserRow;
  if (!user?.id || !user?.email || !user?.password_hash) {
    throw new ExtensionAuthError('INVALID_CREDENTIALS', 401, 'Invalid email or password.');
  }

  const isPasswordValid = await bcrypt.compare(password, user.password_hash);
  if (!isPasswordValid) {
    throw new ExtensionAuthError('INVALID_CREDENTIALS', 401, 'Invalid email or password.');
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name || user.email,
  };
}
