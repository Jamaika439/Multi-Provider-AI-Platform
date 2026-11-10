import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { ensureAuthTables, isAdmin } from '@/lib/auth';

const deny = () => NextResponse.json({ error: 'Nicht erlaubt' }, { status: 401 });

/** GET /api/admin/users: Liste aller Konten */
export async function GET() {
  if (!(await isAdmin())) return deny();

  try {
    await ensureAuthTables();
    const users = await sql`
      SELECT u.id, u.email, u.created_at, u.last_login, u.blocked,
             (SELECT COUNT(*) FROM chat_owners o WHERE o.user_id = u.id)::int AS chat_count
      FROM users u
      ORDER BY u.created_at DESC
    `;
    return NextResponse.json(users);
  } catch (error) {
    console.error('Admin: Nutzerliste fehlgeschlagen:', error);
    return NextResponse.json({ error: 'Fehler beim Laden' }, { status: 500 });
  }
}

/** PATCH /api/admin/users  { id, blocked }: Konto sperren/entsperren */
export async function PATCH(req: Request) {
  if (!(await isAdmin())) return deny();

  const body = (await req.json().catch(() => ({}))) as {
    id?: unknown;
    blocked?: unknown;
  };
  if (typeof body.id !== 'string' || typeof body.blocked !== 'boolean') {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 });
  }

  await sql`UPDATE users SET blocked = ${body.blocked} WHERE id = ${body.id}`;
  return NextResponse.json({ ok: true });
}

/** DELETE /api/admin/users  { id }: Konto samt Chats löschen */
export async function DELETE(req: Request) {
  if (!(await isAdmin())) return deny();

  const body = (await req.json().catch(() => ({}))) as { id?: unknown };
  if (typeof body.id !== 'string') {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 });
  }

  const id = body.id;
  await sql`DELETE FROM messages WHERE chat_id IN (SELECT chat_id FROM chat_owners WHERE user_id = ${id})`;
  await sql`DELETE FROM chats WHERE id IN (SELECT chat_id FROM chat_owners WHERE user_id = ${id})`;
  await sql`DELETE FROM chat_owners WHERE user_id = ${id}`;
  await sql`DELETE FROM users WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
