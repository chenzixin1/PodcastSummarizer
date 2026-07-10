import { nanoid } from 'nanoid';
import { ensureUserCreditsSchema, getInitialSrtCreditsForEmail } from './db';
import { sql } from './sql';

export interface GoogleAuthUser {
  id: string;
  email: string;
  name: string;
}

interface GoogleAuthUserRow {
  id: string;
  email: string;
  name: string | null;
}

function normalizeEmail(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeName(value: string | null | undefined, email: string): string {
  const name = String(value || '').trim();
  return name || email;
}

function toGoogleAuthUser(row: GoogleAuthUserRow): GoogleAuthUser {
  return {
    id: String(row.id),
    email: String(row.email),
    name: normalizeName(row.name, String(row.email)),
  };
}

export async function ensureGoogleAuthUser(input: {
  email: string;
  name?: string | null;
}): Promise<GoogleAuthUser> {
  const email = normalizeEmail(input.email);
  if (!email) {
    throw new Error('Google account email is required.');
  }

  const existing = await sql<GoogleAuthUserRow>`
    SELECT id, email, name
    FROM users
    WHERE email = ${email}
  `;
  if (existing.rows[0]) {
    return toGoogleAuthUser(existing.rows[0]);
  }

  const id = nanoid();
  const name = normalizeName(input.name, email);
  const initialCredits = getInitialSrtCreditsForEmail(email);
  await ensureUserCreditsSchema();

  try {
    const created = await sql<GoogleAuthUserRow>`
      INSERT INTO users (id, email, name, password_hash, credits, created_at)
      VALUES (${id}, ${email}, ${name}, '', ${initialCredits}, NOW())
      RETURNING id, email, name
    `;
    if (created.rows[0]) {
      return toGoogleAuthUser(created.rows[0]);
    }
  } catch (error) {
    const raced = await sql<GoogleAuthUserRow>`
      SELECT id, email, name
      FROM users
      WHERE email = ${email}
    `;
    if (raced.rows[0]) {
      return toGoogleAuthUser(raced.rows[0]);
    }
    throw error;
  }

  throw new Error('Failed to create Google user.');
}
