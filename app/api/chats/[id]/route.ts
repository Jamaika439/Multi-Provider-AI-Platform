/**
 * app/api/chats/[id]/route.ts
 * =============================================================================
 * Endpunkt /api/chats/<chat-id>: Lädt oder löscht einen spezifischen Chat
 * aus der Neon-PostgreSQL-Datenbank.
 * =============================================================================
 */
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

interface MessageRow {
  id: string | number;
  role: string;
  content: string | null;
}

/**
 * Nachrichten eines Chats aus Neon abrufen.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

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
 * Chat und zugehörige Nachrichten in Neon löschen.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Falls du in Neon ON DELETE CASCADE konfiguriert hast, löscht
    // das Entfernen aus 'chats' automatisch auch die Nachrichten.
    await sql`DELETE FROM messages WHERE chat_id = ${id}`;
    await sql`DELETE FROM chats WHERE id = ${id}`;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Chat löschen fehlgeschlagen:', error);
    return NextResponse.json({ error: 'Fehler beim Löschen' }, { status: 500 });
  }
}