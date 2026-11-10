import { cookies } from 'next/headers';
import {
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { sql } from '@/lib/db';

const SESSION_COOKIE = 'session';
const ADMIN_COOKIE = 'admin';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 Tage
const ADMIN_MAX_AGE = 60 * 60 * 8; // 8 Stunden

export interface AuthUser {
  id: string;
  email: string;
}

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 16) {
    throw new Error('AUTH_SECRET fehlt oder ist zu kurz (mindestens 16 Zeichen).');
  }
  return value;
}

// ---------------------------------------------------------------------------
// Tabellen (werden beim ersten Aufruf automatisch angelegt)
// ---------------------------------------------------------------------------

let tablesReady: Promise<void> | null = null;

export function ensureAuthTables(): Promise<void> {
  if (!tablesReady) {
    tablesReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_login TIMESTAMPTZ,
          blocked BOOLEAN NOT NULL DEFAULT false
        )`;
      await sql`
        CREATE TABLE IF NOT EXISTS chat_owners (
          chat_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL
        )`;
    })().catch((error) => {
      tablesReady = null;
      throw error;
    });
  }
  return tablesReady;
}

// ---------------------------------------------------------------------------
// Passwörter (scrypt aus Node, keine zusätzlichen Pakete)
// ---------------------------------------------------------------------------

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (error, key) =>
      error ? reject(error) : resolve(key)
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---------------------------------------------------------------------------
// Signierte Cookies
// ---------------------------------------------------------------------------

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function makeToken(subject: string, maxAge: number): string {
  const payload = `${subject}.${Math.floor(Date.now() / 1000) + maxAge}`;
  return `${payload}.${sign(payload)}`;
}

function readToken(token: string | undefined): string | null {
  if (!token) return null;
  const sigIndex = token.lastIndexOf('.');
  if (sigIndex < 0) return null;

  const payload = token.slice(0, sigIndex);
  const given = Buffer.from(token.slice(sigIndex + 1));
  const expected = Buffer.from(sign(payload));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }

  const expIndex = payload.lastIndexOf('.');
  const exp = Number(payload.slice(expIndex + 1));
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return null;
  return payload.slice(0, expIndex);
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}

// ---------------------------------------------------------------------------
// Nutzer-Session
// ---------------------------------------------------------------------------

export async function startSession(userId: string) {
  (await cookies()).set(
    SESSION_COOKIE,
    makeToken(userId, SESSION_MAX_AGE),
    cookieOptions(SESSION_MAX_AGE)
  );
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Gibt den eingeloggten Nutzer zurück, oder null (nicht eingeloggt / gesperrt). */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const userId = readToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId) return null;

  await ensureAuthTables();
  const rows = (await sql`
    SELECT id, email, blocked FROM users WHERE id = ${userId}
  `) as { id: string; email: string; blocked: boolean }[];

  const row = rows[0];
  if (!row || row.blocked) return null;
  return { id: row.id, email: row.email };
}

// ---------------------------------------------------------------------------
// Admin-Session
// ---------------------------------------------------------------------------

export function checkAdminPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const a = createHash('sha256').update(input).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function startAdminSession() {
  (await cookies()).set(
    ADMIN_COOKIE,
    makeToken('admin', ADMIN_MAX_AGE),
    cookieOptions(ADMIN_MAX_AGE)
  );
}

export async function endAdminSession() {
  (await cookies()).delete(ADMIN_COOKIE);
}

export async function isAdmin(): Promise<boolean> {
  return readToken((await cookies()).get(ADMIN_COOKIE)?.value) === 'admin';
}

// ---------------------------------------------------------------------------
// Chat-Zuordnung
// ---------------------------------------------------------------------------

/** Ordnet den Chat dem Nutzer zu. false = der Chat gehört schon jemand anderem. */
export async function claimChat(chatId: string, userId: string): Promise<boolean> {
  await ensureAuthTables();
  await sql`
    INSERT INTO chat_owners (chat_id, user_id)
    VALUES (${chatId}, ${userId})
    ON CONFLICT (chat_id) DO NOTHING
  `;
  return ownsChat(chatId, userId);
}

export async function ownsChat(chatId: string, userId: string): Promise<boolean> {
  await ensureAuthTables();
  const rows = (await sql`
    SELECT user_id FROM chat_owners WHERE chat_id = ${chatId}
  `) as { user_id: string }[];
  return rows[0]?.user_id === userId;
}

// ---------------------------------------------------------------------------
// Einfache Bremse gegen Passwort-Raten (pro Serverinstanz, nur ein Basisschutz)
// ---------------------------------------------------------------------------

const attempts = new Map<string, { count: number; resetAt: number }>();

export function tooManyAttempts(req: Request, scope: string): boolean {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unbekannt';
  const key = `${scope}:${ip}`;
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + 15 * 60_000 });
    return false;
  }
  entry.count += 1;
  return entry.count > 10;
}
