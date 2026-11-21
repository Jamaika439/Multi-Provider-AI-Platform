import { sql } from '@/lib/db';

let tableReady: Promise<void> | null = null;

export function ensureUsageTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS usage_log (
          id BIGSERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await sql`CREATE INDEX IF NOT EXISTS usage_log_user_idx ON usage_log (user_id, created_at)`;
    })().catch((error) => {
      tableReady = null;
      throw error;
    });
  }
  return tableReady;
}

export interface UsageEntry {
  userId: string;
  kind: 'chat' | 'image' | 'audio';
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

/** Protokolliert eine Anfrage. Fehler hier dürfen den Chat nie stören. */
export async function logUsage(entry: UsageEntry): Promise<void> {
  try {
    await ensureUsageTable();
    await sql`
      INSERT INTO usage_log (user_id, kind, provider, model, input_tokens, output_tokens)
      VALUES (${entry.userId}, ${entry.kind}, ${entry.provider}, ${entry.model},
              ${Math.round(entry.inputTokens ?? 0)}, ${Math.round(entry.outputTokens ?? 0)})
    `;
  } catch (error) {
    console.error('[usage]', error);
  }
}
