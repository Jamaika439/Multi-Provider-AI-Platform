import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getProviderKeys } from '@/lib/providers';
import { logUsage } from '@/lib/usage';

export const maxDuration = 60;

// Gemini-Sprachausgabe (erkennt die Sprache selbst). Das zweite Modell ist der Ersatz.
const TTS_MODELS = ['gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview'];
const ALLOWED_VOICES = [
  'Kore', 'Puck', 'Charon', 'Aoede', 'Fenrir', 'Leda', 'Zephyr', 'Orus',
];
const MAX_CHARS = 2500;

/** Verpackt rohe PCM-Daten (16 Bit, mono) in eine WAV-Datei, die jeder Browser abspielt. */
function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** POST /api/tts  { text, voice } -> audio/wav */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { text?: unknown; voice?: unknown };
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, MAX_CHARS) : '';
  const voice =
    typeof body.voice === 'string' && ALLOWED_VOICES.includes(body.voice) ? body.voice : 'Kore';
  if (!text) {
    return NextResponse.json({ error: 'Kein Text zum Vorlesen.' }, { status: 400 });
  }

  const keys = getProviderKeys('google');
  if (keys.length === 0) {
    return NextResponse.json({ error: 'Für die KI-Stimme fehlt der Google-Key.' }, { status: 400 });
  }

  let lastStatus = 0;
  for (const model of TTS_MODELS) {
    for (const key of keys) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key.value },
            body: JSON.stringify({
              contents: [{ parts: [{ text }] }],
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
                },
              },
            }),
            signal: AbortSignal.timeout(45_000),
          }
        );

        if (response.ok) {
          const data = (await response.json()) as {
            candidates?: {
              content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] };
            }[];
          };
          const inline = data.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)
            ?.inlineData;
          if (!inline?.data) break; // kein Ton geliefert: nächstes Modell probieren

          const rate = Number(/rate=(\d+)/.exec(inline.mimeType ?? '')?.[1] ?? 24000);
          const wav = pcmToWav(Buffer.from(inline.data, 'base64'), rate);
          await logUsage({ userId: user.id, kind: 'audio', provider: 'google', model });
          return new Response(new Uint8Array(wav), {
            headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' },
          });
        }

        lastStatus = response.status;
        // Limit oder Key-Problem: nächster Key. Alles andere: nächstes Modell.
        if (![401, 402, 403, 429].includes(response.status)) break;
      } catch (error) {
        console.error('[tts]', error);
        break;
      }
    }
  }

  return NextResponse.json(
    {
      error: lastStatus
        ? `KI-Stimme nicht verfügbar (HTTP ${lastStatus}).`
        : 'KI-Stimme nicht erreichbar.',
    },
    { status: 502 }
  );
}
