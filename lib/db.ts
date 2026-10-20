/**
 * lib/db.ts
 * =============================================================================
 * Chat-Datenbank auf Basis von sql.js (SQLite, das komplett im Speicher läuft).
 *
 * So funktioniert es:
 *  1. Beim ersten Zugriff wird chat.db (falls vorhanden) in den Speicher geladen.
 *  2. Alle Abfragen laufen im Speicher, das ist schnell.
 *  3. Nach jeder Änderung wird der gesamte Inhalt zurück in chat.db geschrieben
 *     (saveDb). Bei kleinen Datenmengen ist das völlig in Ordnung.
 *
 * Tabellen:
 *  - chats:    id (z. B. "chat-<uuid>"), title, created_at
 *  - messages: id (Zähler), chat_id, role ("user"/"assistant"), content, created_at
 * =============================================================================
 */
import fs from 'fs';
import path from 'path';
import initSqlJs, { type BindParams, type Database, type SqlValue } from 'sql.js';

/** Speicherort der Datenbankdatei: im Projektordner, neben package.json. */
const dbPath = path.join(process.cwd(), 'chat.db');

/**
 * Im Dev-Modus (Hot Reload) wird dieses Modul mehrfach neu geladen. Würde jede
 * Kopie ihre eigene Datenbank im Speicher halten, überschrieben sich alte und
 * neue Kopie gegenseitig in chat.db und Chats gingen verloren. Deshalb hängen
 * wir die einzige Instanz an `globalThis`, das überlebt Neuladen.
 */
const globalForDb = globalThis as unknown as {
  __chatDb?: Promise<Database>;
};

/**
 * Tabellenstruktur. "IF NOT EXISTS" macht das Skript gefahrlos wiederholbar:
 * vorhandene Tabellen und Daten bleiben unangetastet, fehlende werden angelegt.
 * Der Index beschleunigt das Laden der Nachrichten eines Chats.
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    title TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT,
    role TEXT,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages (chat_id);
`;

/**
 * Startet sql.js und öffnet (oder erzeugt) die Datenbank.
 *
 * Die WASM-Datei von sql.js wird bewusst von der Festplatte gelesen und dem
 * Modul mitgegeben (wasmBinary). Das ist zuverlässiger als das automatische
 * Nachladen, das in Next.js je nach Bundler scheitern kann.
 */
async function openDb(): Promise<Database> {
  const wasmPath = path.join(
    process.cwd(),
    'node_modules',
    'sql.js',
    'dist',
    'sql-wasm.wasm'
  );
  const wasmFile = fs.readFileSync(wasmPath);

  // Buffer -> ArrayBuffer, so wie sql.js es erwartet.
  const wasmBinary = wasmFile.buffer.slice(
    wasmFile.byteOffset,
    wasmFile.byteOffset + wasmFile.byteLength
  ) as ArrayBuffer;

  const SQL = await initSqlJs({ wasmBinary });

  // Vorhandene Datei laden, sonst leere Datenbank beginnen.
  const db = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database();

  db.run(SCHEMA);
  saveDb(db);

  return db;
}

/**
 * Gibt die (einzige) Datenbank zurück und öffnet sie beim ersten Aufruf.
 * Der Rückgabewert ist ein Promise, deshalb immer `await getDb()` schreiben.
 * Mehrere gleichzeitige Aufrufer bekommen dasselbe Promise, es gibt also keine
 * doppelte Initialisierung.
 */
export function getDb(): Promise<Database> {
  if (!globalForDb.__chatDb) {
    globalForDb.__chatDb = openDb().catch((error) => {
      // Ist das Öffnen gescheitert, wird das Ergebnis nicht dauerhaft
      // zwischengespeichert, damit der nächste Aufruf es erneut versucht.
      globalForDb.__chatDb = undefined;
      throw error;
    });
  }

  return globalForDb.__chatDb;
}

/**
 * Schreibt die Datenbank aus dem Speicher nach chat.db.
 *
 * Erst wird in eine Temp-Datei (chat.db.tmp) geschrieben und diese dann
 * umbenannt. Das Umbenennen ist praktisch "alles oder nichts": Stürzt der
 * Server mitten im Schreiben ab, bleibt die alte chat.db heil, statt halb
 * überschrieben zu sein.
 */
export function saveDb(db: Database) {
  const buffer = Buffer.from(db.export());
  const tmpPath = `${dbPath}.tmp`;

  fs.writeFileSync(tmpPath, buffer);
  fs.renameSync(tmpPath, dbPath);
}

/**
 * Führt eine SELECT-Abfrage aus und gibt alle Zeilen als Objekte zurück.
 *
 * `?` im SQL sind Platzhalter, die Werte kommen getrennt über `params`.
 * Das schützt vor SQL-Injection und ist Pflicht, sobald Nutzerdaten im Spiel
 * sind. Niemals Werte per Textverkettung in das SQL schreiben.
 *
 * Das Statement wird im `finally` immer freigegeben, sonst würde der Speicher
 * mit der Zeit volllaufen.
 */
export function queryAll<T extends Record<string, SqlValue>>(
  db: Database,
  sql: string,
  params: BindParams = []
): T[] {
  const statement = db.prepare(sql);

  try {
    statement.bind(params);

    const rows: T[] = [];
    while (statement.step()) {
      rows.push(statement.getAsObject() as T);
    }

    return rows;
  } finally {
    statement.free();
  }
}

/** Form einer gespeicherten Nachricht. */
export interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Speichert den kompletten Verlauf eines Chats.
 *
 * - Existiert der Chat noch nicht, wird er mit `title` angelegt. Bei einem
 *   bestehenden Chat bleibt der Titel unverändert (INSERT OR IGNORE).
 * - Die Nachrichten werden komplett ersetzt: erst löschen, dann alle neu
 *   einfügen. Das ist einfacher und sicherer als "nur die neuen" zu suchen,
 *   und bei Chatgrößen wie hier unproblematisch.
 * - Alles läuft in einer Transaktion (BEGIN ... COMMIT): Entweder wird alles
 *   gespeichert oder, bei einem Fehler, nichts (ROLLBACK). So kann ein Chat
 *   nie halb gespeichert zurückbleiben.
 */
export async function saveChatMessages(
  chatId: string,
  title: string,
  messages: StoredMessage[]
) {
  const db = await getDb();

  db.run('BEGIN');

  try {
    db.run('INSERT OR IGNORE INTO chats (id, title) VALUES (?, ?)', [
      chatId,
      title,
    ]);
    db.run('DELETE FROM messages WHERE chat_id = ?', [chatId]);

    for (const message of messages) {
      db.run(
        'INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)',
        [chatId, message.role, message.content]
      );
    }

    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }

  // Erst nach erfolgreichem COMMIT auf die Festplatte schreiben.
  saveDb(db);
}
