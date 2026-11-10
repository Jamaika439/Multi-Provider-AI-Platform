import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { ensureAuthTables, getCurrentUser } from '@/lib/auth';

interface ChatRow {
  id: string;
  title: string;
  created_at: string;
}

/**
 * GET /api/chats
 * Lädt die Chats des eingeloggten Nutzers aus der Neon PostgreSQL-Datenbank.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 });
  }

  try {
    await ensureAuthTables();
    const chats = (await sql`
      SELECT c.id, c.title, c.created_at
      FROM chats c
      JOIN chat_owners o ON o.chat_id = c.id
      WHERE o.user_id = ${user.id}
      ORDER BY c.created_at DESC
    `) as ChatRow[];

    return NextResponse.json(chats);
  } catch (error) {
    console.error('Fehler beim Laden der Chatliste aus Neon:', error);
    return NextResponse.json(
      { error: 'Fehler beim Laden der Chats' },
      { status: 500 }
    );
  }
}
