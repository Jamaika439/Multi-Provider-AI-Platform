/**
 * lib/db.ts
 * =============================================================================
 * Anbindung an die Neon Serverless PostgreSQL-Datenbank.
 * 
 * Tabellen in Neon:
 *  - chats:    id (TEXT, PK), title (TEXT), created_at (TIMESTAMPTZ)
 *  - messages: id (UUID / SERIAL), chat_id (TEXT), role (TEXT), content (TEXT), created_at (TIMESTAMPTZ)
 * =============================================================================
 */
import { neon } from '@neondatabase/serverless';

/** Neon Client für Serverless-Abfragen via WebSockets / HTTP */
export const sql = neon(process.env.DATABASE_URL!);

/** Form einer zu speichernden Nachricht. */
export interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Speichert den Verlauf eines Chats in Neon.
 * 
 * - Legt den Chat mit `title` an (falls neu). Bei Konflikt bleibt der bestehende Titel erhalten.
 * - Löscht alte Nachrichten des Chats und fügt den aktuellen Stand sauber neu ein.
 */
export async function saveChatMessages(
  chatId: string,
  title: string,
  messages: StoredMessage[]
) {
  // 1. Chat anlegen oder unverändert lassen, falls er existiert
  await sql`
    INSERT INTO chats (id, title)
    VALUES (${chatId}, ${title})
    ON CONFLICT (id) DO NOTHING
  `;

  // 2. Bestehende Nachrichten des Chats aufräumen
  await sql`
    DELETE FROM messages
    WHERE chat_id = ${chatId}
  `;

  // 3. Nachrichten neu einfügen
  for (const message of messages) {
    await sql`
      INSERT INTO messages (chat_id, role, content)
      VALUES (${chatId}, ${message.role}, ${message.content})
    `;
  }
}