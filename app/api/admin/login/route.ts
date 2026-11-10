import { NextResponse } from 'next/server';
import {
  checkAdminPassword,
  endAdminSession,
  startAdminSession,
  tooManyAttempts,
} from '@/lib/auth';

/** POST /api/admin/login  { password } */
export async function POST(req: Request) {
  if (tooManyAttempts(req, 'admin')) {
    return NextResponse.json(
      { error: 'Zu viele Versuche. Bitte später erneut probieren.' },
      { status: 429 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as { password?: unknown };
  const password = typeof body.password === 'string' ? body.password : '';

  if (!checkAdminPassword(password)) {
    return NextResponse.json({ error: 'Falsches Passwort.' }, { status: 401 });
  }

  await startAdminSession();
  return NextResponse.json({ ok: true });
}

/** DELETE /api/admin/login  (Admin abmelden) */
export async function DELETE() {
  await endAdminSession();
  return NextResponse.json({ ok: true });
}
