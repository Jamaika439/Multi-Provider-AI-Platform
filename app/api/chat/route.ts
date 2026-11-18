import { NextResponse } from 'next/server';
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
} from 'ai';
import { saveChatMessages } from '@/lib/db';
import { findModel, IMAGE_MODEL } from '@/lib/models';
import { getLanguageModel, MissingApiKeyError } from '@/lib/providers';
import { getMessageText, makeChatTitle } from '@/lib/messages';
import { agentTools, AGENT_SYSTEM } from '@/lib/agents/tools';
import { claimChat, getCurrentUser, isAdmin } from '@/lib/auth';

// Agent-Läufe mit mehreren Schritten brauchen Zeit.
// Vercel: je nach Plan sind bis zu 300 s möglich, sonst ggf. auf 60 senken.
export const maxDuration = 60;

/**
 * Maximale Ausgabelänge pro Antwort (bzw. pro Agent-Schritt) je Anbieter.
 * Zu hohe Werte lehnt ein Anbieter mit Fehler ab, dann hier senken.
 * Genaue Limits stehen in der Doku des jeweiligen Anbieters/Modells.
 */
const OUTPUT_LIMITS: Record<string, number> = {
  google: 32000,
  openai: 32000,
  groq: 16000,
  openrouter: 16000,
  cohere: 4000,
};
const DEFAULT_OUTPUT_LIMIT = 8000;

const AGENT_MAX_STEPS = 15;

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 });
    }

    const body = await req.json();
    const { messages, chatId, model: modelKey, agent } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Keine gültigen Nachrichten übergeben' },
        { status: 400 }
      );
    }

    const modelDef = findModel(modelKey) ?? findModel('gemini-1.5-flash')!;
    const activeChatId = chatId || `chat-${Date.now()}`;

    // Bezahlte Modelle und der Agent-Modus (schreibt ins Repo) nur für den Admin
    const admin = await isAdmin();
    if (!modelDef.isFree && !admin) {
      return NextResponse.json(
        { error: 'Bezahlte Modelle sind nur für den Admin freigeschaltet.' },
        { status: 403 }
      );
    }
    if (agent === true && !admin) {
      return NextResponse.json(
        { error: 'Der Agent-Modus ist nur für den Admin (zuerst unter /admin anmelden).' },
        { status: 403 }
      );
    }

    // Chat dem Nutzer zuordnen; fremde Chat-IDs werden abgelehnt
    if (!(await claimChat(activeChatId, user.id))) {
      return NextResponse.json({ error: 'Kein Zugriff auf diesen Chat.' }, { status: 403 });
    }

    // Nachrichten formatieren
    const formattedMessages = messages.map((m: any) => {
      let content = m.content;
      if (!content && Array.isArray(m.parts)) {
        content = getMessageText(m);
      }
      return {
        role: m.role || 'user',
        content: typeof content === 'string' ? content : String(content || ''),
      };
    });

    const firstUserText =
      formattedMessages.find((m: { role: string }) => m.role === 'user')
        ?.content || '';
    const activeTitle = makeChatTitle(firstUserText);

    // === Bildgenerierung (Pollinations) ===
    if (modelDef.key === IMAGE_MODEL || modelDef.provider === 'image') {
      const prompt =
        formattedMessages[formattedMessages.length - 1]?.content || '';
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
        prompt
      )}?width=1024&height=1024&nologo=true`;
      const imageMarkdown = `![Generiertes Bild](${imageUrl})`;

      await saveChatMessages(activeChatId, activeTitle, [
        ...formattedMessages,
        { role: 'assistant', content: imageMarkdown },
      ]);

      // Korrektes UI-Message-Stream-Format für useChat
      const stream = createUIMessageStream({
        execute: ({ writer }) => {
          const id = `img-${Date.now()}`;
          writer.write({ type: 'text-start', id });
          writer.write({ type: 'text-delta', id, delta: imageMarkdown });
          writer.write({ type: 'text-end', id });
        },
      });

      return createUIMessageStreamResponse({ stream });
    }

    // === Sprachmodell (normal oder Agent-Modus) ===
    const useAgent = agent === true;

    if (useAgent && !process.env.GITHUB_TOKEN) {
      return NextResponse.json(
        {
          error:
            'Agent-Modus: GITHUB_TOKEN fehlt (in .env.local bzw. in den Vercel-Umgebungsvariablen setzen).',
        },
        { status: 400 }
      );
    }

    const languageModel = getLanguageModel(modelDef);
    const maxOutputTokens =
      OUTPUT_LIMITS[modelDef.provider] ?? DEFAULT_OUTPUT_LIMIT;

    // System-Nachricht nur senden, wenn Modell sie unterstützt (OpenRouter Free oft nicht)
    const supportsSystem = modelDef.supportsSystemMessage !== false;

    const result = streamText({
      model: languageModel,
      messages: formattedMessages,
      maxOutputTokens,
      // Keine stillen Wiederholungen: Fehler sofort anzeigen statt ewig laden
      maxRetries: 0,
      // Timeout: Agent bis 4:30 min, normal 2 min
      abortSignal: AbortSignal.timeout(useAgent ? 270_000 : 120_000),
      onError: ({ error }) => {
        console.error('[streamText]', error);
      },
      ...(useAgent
        ? {
            system: AGENT_SYSTEM,
            tools: agentTools,
            stopWhen: stepCountIs(AGENT_MAX_STEPS),
          }
        : supportsSystem
        ? {}
        : {}),
      onFinish: async ({ text, steps }) => {
        try {
          // Im Agent-Modus steht der Text über mehrere Schritte verteilt.
          const finalText = useAgent
            ? steps
                .map((step) => step.text)
                .filter(Boolean)
                .join('\n\n')
            : text;

          await saveChatMessages(activeChatId, activeTitle, [
            ...formattedMessages,
            { role: 'assistant', content: finalText || '' },
          ]);
        } catch (dbError) {
          console.error('Fehler beim Speichern in Neon:', dbError);
        }
      },
    });

    // Echte Fehlermeldung des Anbieters anzeigen (statt "An error occurred.")
    return result.toUIMessageStreamResponse({
      onError: (error) =>
        (error instanceof Error ? error.message : String(error)).slice(0, 300),
    });
  } catch (error: any) {
    console.error('Fehler in /api/chat:', error);

    if (error instanceof MissingApiKeyError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      { error: error.message || 'Fehler beim Verarbeiten der Nachricht' },
      { status: 500 }
    );
  }
}
