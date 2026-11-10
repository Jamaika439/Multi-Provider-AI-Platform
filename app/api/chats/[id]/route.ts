import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getCurrentUser, ownsChat } from '@/lib/auth';

interface MessageRow {
  id: string | number;
  role: string;
  content: string | null;
}

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/chats/[id]
 * Lädt die Nachrichten eines eigenen Chats aus Neon.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 });
  }
  if (!(await ownsChat(id, user.id))) {
    return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
  }

  try {
    const rows = (await sql`
      SELECT id, role, content
      FROM messages
      WHERE chat_id = ${id}
      ORDER BY created_at ASC
    `) as MessageRow[];

    return NextResponse.json(
      rows.map((row) => ({
        id: String(row.id),
        role: row.role,
        content: row.content ?? '',
      }))
    );
  } catch (error) {
    console.error('Nachrichten laden fehlgeschlagen:', error);
    return NextResponse.json(
      { error: 'Fehler beim Laden der Nachrichten' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/chats/[id]
 * Löscht einen eigenen Chat und seine Nachrichten aus Neon.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 });
  }
  if (!(await ownsChat(id, user.id))) {
    return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
  }

  try {
    await sql`DELETE FROM messages WHERE chat_id = ${id}`;
    await sql`DELETE FROM chats WHERE id = ${id}`;
    await sql`DELETE FROM chat_owners WHERE chat_id = ${id}`;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Chat löschen fehlgeschlagen:', error);
    return NextResponse.json(
      { error: 'Fehler beim Löschen' },
      { status: 500 }
    );
  }
}
