/**
 * app/api/chats/[id]/route.ts
 * =============================================================================
 * Endpunkt /api/chats/<chat-id>: ein einzelner Chat.
 *
 *  - GET    liefert alle Nachrichten des Chats (älteste zuerst).
 *  - DELETE löscht den Chat samt aller Nachrichten.
 *
 * "[id]" im Ordnernamen ist eine dynamische Route von Next.js: Der Teil der URL
 * an dieser Stelle steht als `params.id` zur Verfügung.
 * =============================================================================
 */
import { NextResponse } from 'next/server';

import { getDb, queryAll, saveDb } from '@/lib/db';

/** Eine Zeile aus der Tabelle "messages" (nur die Spalten, die wir brauchen). */
interface MessageRow extends Record<string, string | number | null | Uint8Array> {
  id: number;
  role: string;
  content: string | null;
}

/**
 * Nachrichten eines Chats laden.
 * In dieser Next.js-Version ist `params` ein Promise und muss mit `await`
 * gelesen werden.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = await getDb();
    const rows = queryAll<MessageRow>(
      db,
      'SELECT id, role, content FROM messages WHERE chat_id = ? ORDER BY id ASC',
      [id]
    );

    // Die Oberfläche bekommt IDs als Text. Fehlender Inhalt wird zu "".
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
 * Chat und Nachrichten löschen. Beides in einer Transaktion, damit nie
 * verwaiste Nachrichten ohne Chat (oder umgekehrt) übrig bleiben.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = await getDb();

    db.run('BEGIN');
    try {
      db.run('DELETE FROM messages WHERE chat_id = ?', [id]);
      db.run('DELETE FROM chats WHERE id = ?', [id]);
      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }

    saveDb(db);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Chat löschen fehlgeschlagen:', error);
    return NextResponse.json({ error: 'Fehler beim Löschen' }, { status: 500 });
  }
}
