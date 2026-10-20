/**
 * app/api/chats/route.ts
 * =============================================================================
 * Endpunkt /api/chats: die Liste aller Chats für die Seitenleiste.
 *
 *  - GET  /api/chats  liefert alle Chats, neueste zuerst.
 *  - POST /api/chats  legt einen leeren Chat an (falls es ihn noch nicht gibt).
 *
 * Die Nachrichten eines einzelnen Chats liegen in app/api/chats/[id]/route.ts.
 * =============================================================================
 */
import { NextResponse } from 'next/server';

import { getDb, queryAll, saveDb } from '@/lib/db';

/** Eine Zeile aus der Tabelle "chats". */
interface ChatRow extends Record<string, string | number | null | Uint8Array> {
  id: string;
  title: string | null;
  created_at: string;
}

/** Alle Chats laden, sortiert nach Erstellzeit. `rowid` entscheidet bei gleicher Sekunde. */
export async function GET() {
  try {
    const db = await getDb();
    const chats = queryAll<ChatRow>(
      db,
      'SELECT id, title, created_at FROM chats ORDER BY created_at DESC, rowid DESC'
    );

    return NextResponse.json(chats);
  } catch (error) {
    console.error('Chats laden fehlgeschlagen:', error);
    return NextResponse.json({ error: 'Fehler beim Laden' }, { status: 500 });
  }
}

/**
 * Legt einen Chat an. INSERT OR IGNORE sorgt dafür, dass ein zweiter Aufruf mit
 * derselben ID nichts überschreibt (der Titel bleibt erhalten).
 */
export async function POST(req: Request) {
  try {
    const { id, title } = await req.json();

    if (typeof id !== 'string' || !id.trim()) {
      return NextResponse.json({ error: 'Chat-ID fehlt' }, { status: 400 });
    }

    const db = await getDb();
    db.run('INSERT OR IGNORE INTO chats (id, title) VALUES (?, ?)', [
      id,
      typeof title === 'string' && title.trim() ? title : 'Neuer Chat',
    ]);
    saveDb(db);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Chat speichern fehlgeschlagen:', error);
    return NextResponse.json({ error: 'Fehler beim Speichern' }, { status: 500 });
  }
}
