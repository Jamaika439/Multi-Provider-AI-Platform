import { NextResponse } from 'next/server';
import { streamText, stepCountIs } from 'ai';
import { saveChatMessages } from '@/lib/db';
import { findModel, IMAGE_MODEL } from '@/lib/models';
import { getLanguageModel, MissingApiKeyError } from '@/lib/providers';
import { getMessageText, makeChatTitle } from '@/lib/messages';
import { agentTools, AGENT_SYSTEM } from '@/lib/agents/tools';

// Agent-Läufe mit mehreren Schritten brauchen Zeit.
// Vercel: je nach Plan sind bis zu 300 s möglich, sonst ggf. auf 60 senken.
export const maxDuration = 300;

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
    const body = await req.json();
    const { messages, chatId, model: modelKey, agent } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Keine gültigen Nachrichten übergeben' },
        { status: 400 }
      );
    }

    const modelDef = findModel(modelKey) ?? findModel('gemini-3.8-flash')!;
    const activeChatId = chatId || `chat-${Date.now()}`;

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

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(imageMarkdown));
          controller.close();
        },
      });

      return new Response(stream, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
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

    const result = streamText({
      model: languageModel,
      messages: formattedMessages,
      maxOutputTokens,
      ...(useAgent
        ? {
            system: AGENT_SYSTEM,
            tools: agentTools,
            stopWhen: stepCountIs(AGENT_MAX_STEPS),
          }
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

    return result.toUIMessageStreamResponse();
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