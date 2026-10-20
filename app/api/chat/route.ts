/**
 * app/api/chat/route.ts
 * =============================================================================
 * Endpunkt POST /api/chat. Hier laufen alle Chat-Nachrichten ein.
 *
 * Ablauf einer Anfrage:
 *  1. Anfrage prüfen (gültiges JSON, Nachrichten, Chat-ID, bekanntes Modell).
 *  2a. Bildmodell: Text -> Pollinations-Bild-URL als Markdown zurückschicken.
 *  2b. Sprachmodell: Anbieter über lib/providers.ts wählen, Antwort streamen.
 *  3. Nach Ende der Antwort den Verlauf in chat.db speichern (persistChat).
 *
 * Die Antwort ist ein Stream im "UI-Message-Stream"-Format des AI SDK. Der
 * Hook useChat im Browser versteht dieses Format und zeigt den Text live an.
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

/** Maximale Laufzeit in Sekunden (relevant auf Hosting-Diensten wie Vercel). */
export const maxDuration = 60;

/** Bildbeschreibungen werden gekürzt, damit die URL nicht zu lang wird. */
const MAX_IMAGE_PROMPT_CHARS = 500;

/**
 * Speichert den fertigen Chatverlauf in der Datenbank.
 *
 * Es wird nur Klartext gespeichert (Rolle + Text), keine Denkschritte oder
 * Werkzeugaufrufe. Leere Nachrichten werden übersprungen. Der Titel des Chats
 * ist der Anfang der ersten Nutzernachricht.
 *
 * Fehler werden nur protokolliert und nicht weitergeworfen: Die Antwort ist zu
 * diesem Zeitpunkt schon beim Nutzer, ein Speicherfehler darf sie nicht
 * nachträglich kaputt machen.
 */
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
    console.error('Chat konnte nicht gespeichert werden:', error);
  }
}

/** Einfache Text-Fehlerantwort mit passendem HTTP-Status. */
function errorResponse(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function POST(req: Request) {
  // --- 1. Anfrage prüfen -------------------------------------------------------
  // Alles, was von außen kommt, wird geprüft und nie blind vertraut.
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
    // --- 2a. Bildgenerierung -----------------------------------------------------
    if (model.provider === 'image') {
      const lastMessage = messages[messages.length - 1];
      const prompt = getMessageText(lastMessage)
        .trim()
        .slice(0, MAX_IMAGE_PROMPT_CHARS);

      if (!prompt) {
        return errorResponse('Bitte beschreibe das Bild, das erstellt werden soll.', 400);
      }

      // encodeURIComponent lässt ( und ) unverändert. Die würden das
      // Markdown-Bild unten vorzeitig beenden, deshalb zusätzlich kodieren.
      const encodedPrompt = encodeURIComponent(prompt)
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29');
      const imageUrl =
        `https://image.pollinations.ai/prompt/${encodedPrompt}` +
        `?width=1024&height=1024&nologo=true`;

      // Die Oberfläche erkennt dieses Markdown-Muster und zeigt ein <img>.
      const markdown = `![Generiertes Bild](${imageUrl})`;

      // ID des Textblocks in der Antwort. Muss nur innerhalb der Antwort
      // eindeutig sein.
      const textId = crypto.randomUUID();

      // Wir bauen den Stream von Hand. Ein vollständiger Stream besteht aus
      // "start" -> Inhalt -> "finish". Ohne diese Rahmen-Signale wäre der Stream
      // unvollständig, und der Client könnte den Abschluss nicht sauber erkennen.
      const stream = createUIMessageStream({
        originalMessages: messages,
        execute: ({ writer }) => {
          writer.write({ type: 'start' });
          writer.write({ type: 'text-start', id: textId });
          writer.write({ type: 'text-delta', id: textId, delta: markdown });
          writer.write({ type: 'text-end', id: textId });
          writer.write({ type: 'finish' });
        },
        // Wird nach Ende des Streams aufgerufen: Verlauf speichern.
        onEnd: ({ messages: finalMessages }) =>
          persistChat(chatId, finalMessages),
      });

      return createUIMessageStreamResponse({ stream });
    }

    // --- 2b. Sprachmodell ----------------------------------------------------------
    const result = streamText({
      // Wirft MissingApiKeyError, wenn der Key des Anbieters fehlt.
      model: getLanguageModel(model),
      // Wandelt die Nachrichten der Oberfläche (UIMessage) in das Format um,
      // das die Modelle erwarten.
      messages: await convertToModelMessages(messages),
    });

    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      // Nach Ende der Antwort speichern (siehe persistChat).
      onEnd: ({ messages: finalMessages }) => persistChat(chatId, finalMessages),
      // Fehler des Anbieters (falsche Modell-ID, ungültiger Key, kein Guthaben ...)
      // laufen mitten im Stream auf. Ohne diese Funktion würde der Client nur
      // eine allgemeine Fehlermeldung sehen. So erscheint der echte Text im Chat.
      onError: (error) =>
        error instanceof Error ? error.message : 'Unbekannter Fehler bei der KI-Anfrage.',
    });
  } catch (error) {
    // Fehler vor Beginn des Streams, z. B. fehlender API-Key.
    console.error('API Chat Error:', error);

    if (error instanceof MissingApiKeyError) {
      return errorResponse(error.message, 400);
    }

    return errorResponse('Fehler bei der KI-Anfrage.', 500);
  }
}
