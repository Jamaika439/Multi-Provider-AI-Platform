import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getProviderKeys } from '@/lib/providers';

export const maxDuration = 60;

const MODEL = 'whisper-large-v3-turbo';
const MAX_BYTES = 4_000_000;

// Hilft Whisper, englische Fachwörter in deutschen Sätzen richtig zu schreiben.
const VOCABULARY_HINT =
  'Deutsches Gespräch mit englischen Begriffen: Deployment, Commit, Pull Request, Branch, Merge, Prompt, Token, API, Backend, Frontend, Vercel, GitHub, Gemini, Groq, NVIDIA, Cloudflare, OpenRouter, Agent, Streaming, Download, Upload, Feature, Bug, Fix, Update.';

/** POST /api/transcribe  (multipart: audio) -> { text } über Groq Whisper */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  const audio = form?.get('audio');
  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: 'Keine Aufnahme erhalten.' }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Die Aufnahme ist zu lang.' }, { status: 413 });
  }

  const keys = getProviderKeys('groq');
  if (keys.length === 0) {
    return NextResponse.json(
      { error: 'Für die Spracheingabe fehlt GROQ_API_KEY.' },
      { status: 400 }
    );
  }

  let lastStatus = 0;
  for (const key of keys) {
    const body = new FormData();
    body.append('file', audio, audio.name || 'aufnahme.webm');
    body.append('model', MODEL);
    body.append('language', 'de');
    body.append('prompt', VOCABULARY_HINT);
    body.append('temperature', '0');
    body.append('response_format', 'json');

    try {
      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key.value}` },
        body,
        signal: AbortSignal.timeout(45_000),
      });

      if (response.ok) {
        const data = (await response.json()) as { text?: string };
        return NextResponse.json({ text: (data.text ?? '').trim() });
      }

      lastStatus = response.status;
      // Nur bei Key-/Limit-Problemen den nächsten Key probieren
      if (![401, 402, 403, 429].includes(response.status)) break;
    } catch (error) {
      console.error('[transcribe]', error);
      break;
    }
  }

  return NextResponse.json(
    {
      error: lastStatus
        ? `Spracherkennung fehlgeschlagen (HTTP ${lastStatus}).`
        : 'Spracherkennung nicht erreichbar.',
    },
    { status: 502 }
  );
}
