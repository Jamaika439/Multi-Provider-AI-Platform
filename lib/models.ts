import { randomUUID } from 'node:crypto';
import { sql } from '@/lib/db';
import { getProviderKeys } from '@/lib/providers';

const IMAGE_MODEL_ID = '@cf/black-forest-labs/flux-1-schnell';

let tableReady: Promise<void> | null = null;

export function ensureImagesTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS images (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          mime TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
    })().catch((error) => {
      tableReady = null;
      throw error;
    });
  }
  return tableReady;
}

export async function saveImage(userId: string, mime: string, base64: string): Promise<string> {
  await ensureImagesTable();
  const id = randomUUID();
  await sql`INSERT INTO images (id, user_id, mime, data) VALUES (${id}, ${userId}, ${mime}, ${base64})`;
  return id;
}

export async function loadImage(
  id: string
): Promise<{ user_id: string; mime: string; data: string } | null> {
  await ensureImagesTable();
  const rows = (await sql`SELECT user_id, mime, data FROM images WHERE id = ${id}`) as {
    user_id: string;
    mime: string;
    data: string;
  }[];
  return rows[0] ?? null;
}

/**
 * Erzeugt ein Bild mit FLUX (Cloudflare Workers AI).
 * null = Cloudflare nicht eingerichtet, Fehler = Anbieter hat abgelehnt.
 */
export async function generateImage(
  prompt: string
): Promise<{ mime: string; base64: string } | null> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const keys = getProviderKeys('cloudflare');
  if (!accountId || keys.length === 0) return null;

  let lastStatus = 0;
  let lastDetail = '';
  for (const key of keys) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${IMAGE_MODEL_ID}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key.value}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: prompt.slice(0, 2000),
          steps: 8,
        }),
        signal: AbortSignal.timeout(50_000),
      }
    );

    if (response.ok) {
      const data = (await response.json()) as {
        result?: { image?: string };
        image?: string;
      };
      const base64 = data.result?.image ?? data.image;
      if (base64) return { mime: 'image/jpeg', base64 };
      throw new Error('Cloudflare hat kein Bild geliefert.');
    }

    lastStatus = response.status;
    lastDetail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    if (![401, 402, 403, 429].includes(response.status)) break;
  }

  throw new Error(
    `Cloudflare-Bildgenerierung fehlgeschlagen (HTTP ${lastStatus}). ${lastDetail}`.trim()
  );
}
