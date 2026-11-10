import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { sql } from '@/lib/db';
import {
  endSession,
  ensureAuthTables,
  getCurrentUser,
  hashPassword,
  startSession,
  tooManyAttempts,
  verifyPassword,
} from '@/lib/auth';

type Ctx = { params: Promise<{ action: string }> };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/** GET /api/auth/me */
export async function GET(_req: Request, { params }: Ctx) {
  const { action } = await params;
  if (action !== 'me') return fail('Nicht gefunden', 404);

  const user = await getCurrentUser();
  if (!user) return fail('Nicht eingeloggt', 401);
  return NextResponse.json({ id: user.id, email: user.email });
}

/** POST /api/auth/register | login | logout */
export async function POST(req: Request, { params }: Ctx) {
  const { action } = await params;

  try {
    if (action === 'logout') {
      await endSession();
      return NextResponse.json({ ok: true });
    }

    if (action !== 'register' && action !== 'login') {
      return fail('Nicht gefunden', 404);
    }

    if (tooManyAttempts(req, action)) {
      return fail('Zu viele Versuche. Bitte in ein paar Minuten erneut probieren.', 429);
    }

    const body = (await req.json().catch(() => ({}))) as {
      email?: unknown;
      password?: unknown;
    };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    await ensureAuthTables();

    if (action === 'register') {
      if (!EMAIL_PATTERN.test(email) || email.length > 200) {
        return fail('Bitte eine gültige E-Mail-Adresse eingeben.', 400);
      }
      if (password.length < 8 || password.length > 200) {
        return fail('Das Passwort muss mindestens 8 Zeichen lang sein.', 400);
      }

      const id = randomUUID();
      const passwordHash = await hashPassword(password);
      const created = (await sql`
        INSERT INTO users (id, email, password_hash)
        VALUES (${id}, ${email}, ${passwordHash})
        ON CONFLICT (email) DO NOTHING
        RETURNING id
      `) as { id: string }[];

      if (created.length === 0) {
        return fail('Diese E-Mail ist schon registriert.', 409);
      }

      await startSession(id);
      return NextResponse.json({ ok: true });
    }

    // login
    const rows = (await sql`
      SELECT id, password_hash, blocked FROM users WHERE email = ${email}
    `) as { id: string; password_hash: string; blocked: boolean }[];
    const row = rows[0];

    if (!row || !(await verifyPassword(password, row.password_hash))) {
      return fail('E-Mail oder Passwort falsch.', 401);
    }
    if (row.blocked) {
      return fail('Dieses Konto ist gesperrt.', 403);
    }

    await sql`UPDATE users SET last_login = now() WHERE id = ${row.id}`;
    await startSession(row.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Auth-Fehler:', error);
    return fail('Serverfehler bei der Anmeldung.', 500);
  }
}
