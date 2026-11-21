import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { ensureAuthTables, isAdmin } from '@/lib/auth';
import { ensureImagesTable } from '@/lib/images';
import { ensureUsageTable } from '@/lib/usage';

const deny = () => NextResponse.json({ error: 'Nicht erlaubt' }, { status: 401 });

interface UserRow {
  id: string;
  email: string;
  created_at: string;
  last_login: string | null;
  blocked: boolean;
  chat_count: number;
  requests_total: number;
  requests_today: number;
  tokens_total: string | number;
  tokens_today: string | number;
  images_today: number;
}

interface ProviderRow {
  provider: string;
  requests_today: number;
  tokens_today: string | number;
}

/** GET /api/admin/users: Konten mit Verbrauch (Tag = UTC) plus Verbrauch heute je Anbieter */
export async function GET() {
  if (!(await isAdmin())) return deny();

  try {
    await ensureAuthTables();
    await ensureUsageTable();

    const users = (await sql`
      SELECT u.id, u.email, u.created_at, u.last_login, u.blocked,
        (SELECT COUNT(*) FROM chat_owners o WHERE o.user_id = u.id)::int AS chat_count,
        (SELECT COUNT(*) FROM usage_log l WHERE l.user_id = u.id)::int AS requests_total,
        (SELECT COUNT(*) FROM usage_log l
           WHERE l.user_id = u.id AND l.created_at >= date_trunc('day', now()))::int AS requests_today,
        COALESCE((SELECT SUM(l.input_tokens + l.output_tokens) FROM usage_log l
           WHERE l.user_id = u.id), 0)::bigint AS tokens_total,
        COALESCE((SELECT SUM(l.input_tokens + l.output_tokens) FROM usage_log l
           WHERE l.user_id = u.id AND l.created_at >= date_trunc('day', now())), 0)::bigint AS tokens_today,
        (SELECT COUNT(*) FROM usage_log l
           WHERE l.user_id = u.id AND l.kind = 'image'
             AND l.created_at >= date_trunc('day', now()))::int AS images_today
      FROM users u
      ORDER BY u.created_at DESC
    `) as UserRow[];

    const providers = (await sql`
      SELECT provider,
             COUNT(*)::int AS requests_today,
             COALESCE(SUM(input_tokens + output_tokens), 0)::bigint AS tokens_today
      FROM usage_log
      WHERE created_at >= date_trunc('day', now())
      GROUP BY provider
      ORDER BY requests_today DESC
    `) as ProviderRow[];

    return NextResponse.json({
      users: users.map((user) => ({
        ...user,
        tokens_total: Number(user.tokens_total),
        tokens_today: Number(user.tokens_today),
      })),
      providers: providers.map((row) => ({
        ...row,
        tokens_today: Number(row.tokens_today),
      })),
    });
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

/** DELETE /api/admin/users  { id }: Konto samt Chats, Bildern und Verbrauchsdaten löschen */
export async function DELETE(req: Request) {
  if (!(await isAdmin())) return deny();

  const body = (await req.json().catch(() => ({}))) as { id?: unknown };
  if (typeof body.id !== 'string') {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 });
  }

  const id = body.id;
  await ensureImagesTable();
  await ensureUsageTable();
  await sql`DELETE FROM messages WHERE chat_id IN (SELECT chat_id FROM chat_owners WHERE user_id = ${id})`;
  await sql`DELETE FROM chats WHERE id IN (SELECT chat_id FROM chat_owners WHERE user_id = ${id})`;
  await sql`DELETE FROM chat_owners WHERE user_id = ${id}`;
  await sql`DELETE FROM images WHERE user_id = ${id}`;
  await sql`DELETE FROM usage_log WHERE user_id = ${id}`;
  await sql`DELETE FROM users WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
