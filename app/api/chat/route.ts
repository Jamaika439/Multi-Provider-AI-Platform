/**
 * app/api/chat/route.ts
 * =============================================================================
 * Endpunkt POST /api/chat. Verarbeitet eingehende KI-Anfragen und speichert
 * den Verlauf nach der Generierung in der Neon-PostgreSQL-Datenbank.
 * =============================================================================
 */
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
} from 'ai';

import { saveChatMessages, type StoredMessage } from '@/lib/db';
import { getMessageText, makeChatTitle } from '@/lib/messages';
import { findModel } from '@/lib/models';
import { getLanguageModel, MissingApiKeyError } from '@/lib/providers';

export const maxDuration = 60;
const MAX_IMAGE_PROMPT_CHARS = 500;

async function persistChat(chatId: string, messages: UIMessage[]) {
  try {
    const stored: StoredMessage[] = [];

    for (const message of messages) {
      if (message.role !== 'user' && message.role !== 'assistant') continue;

      const content = getMessageText(message);
      if (!content.trim()) continue;

      stored.push({ role: message.role, content });
    }

    const firstUser = stored.find((message) => message.role === 'user');
    if (!firstUser) return;

    await saveChatMessages(chatId, makeChatTitle(firstUser.content), stored);
  } catch (error) {
    console.error('Chat konnte nicht in Neon gespeichert werden:', error);
  }
}

function errorResponse(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function POST(req: Request) {
  let body: { messages?: UIMessage[]; model?: string; chatId?: string };

  try {
    body = await req.json();
  } catch {
    return errorResponse('Ungültige Anfrage.', 400);
  }

  const { messages, model: modelKey, chatId } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return errorResponse('Es wurden keine Nachrichten gesendet.', 400);
  }

  if (typeof chatId !== 'string' || !chatId.trim()) {
    return errorResponse('Die Chat-ID fehlt.', 400);
  }

  const model = findModel(modelKey);

  if (!model) {
    return errorResponse(`Unbekannter Modellschlüssel: ${String(modelKey)}`, 400);
  }

  try {
    // --- Bildgenerierung -----------------------------------------------------
    if (model.provider === 'image') {
      const lastMessage = messages[messages.length - 1];
      const prompt = getMessageText(lastMessage)
        .trim()
        .slice(0, MAX_IMAGE_PROMPT_CHARS);

      if (!prompt) {
        return errorResponse('Bitte beschreibe das Bild, das erstellt werden soll.', 400);
      }

      const encodedPrompt = encodeURIComponent(prompt)
        .replace(/\(/g, '\%28') .replace(/\)/g, '%29');
      const imageUrl =
        `https://image.pollinations.ai/prompt/${encodedPrompt}` +
        `?width=1024&height=1024&nologo=true`;

      const markdown = `![Generiertes Bild](${imageUrl})`;
      const textId = crypto.randomUUID();

      const stream = createUIMessageStream({
        originalMessages: messages,
        execute: ({ writer }) => {
          writer.write({ type: 'start' });
          writer.write({ type: 'text-start', id: textId });
          writer.write({ type: 'text-delta', id: textId, delta: markdown });
          writer.write({ type: 'text-end', id: textId });
          writer.write({ type: 'finish' });
        },
        onEnd: ({ messages: finalMessages }) =>
          persistChat(chatId, finalMessages),
      });

      return createUIMessageStreamResponse({ stream });
    }

    // --- Sprachmodell --------------------------------------------------------
    const result = streamText({
      model: getLanguageModel(model),
      messages: await convertToModelMessages(messages),
    });

    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      onEnd: ({ messages: finalMessages }) => persistChat(chatId, finalMessages),
      onError: (error) =>
        error instanceof Error ? error.message : 'Unbekannter Fehler bei der KI-Anfrage.',
    });
  } catch (error) {
    console.error('API Chat Error:', error);

    if (error instanceof MissingApiKeyError) {
      return errorResponse(error.message, 400);
    }

    return errorResponse('Fehler bei der KI-Anfrage.', 500);
  }
}