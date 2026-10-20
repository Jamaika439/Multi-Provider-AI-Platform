// app/api/chat/route.ts
import { NextResponse } from 'next/server';
import { streamText } from 'ai';
import { saveChatMessages } from '@/lib/db';
import { findModel, IMAGE_MODEL } from '@/lib/models';
import { getLanguageModel, MissingApiKeyError } from '@/lib/providers';
import { getMessageText, makeChatTitle } from '@/lib/messages';

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { messages, chatId, model: modelKey } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Keine gültigen Nachrichten übergeben' },
        { status: 400 }
      );
    }

    // Modell auflösen
    const modelDef = findModel(modelKey) ?? findModel('gemini-3.8-flash')!;
    const activeChatId = chatId || `chat-${Date.now()}`;

    // Nachrichten für das AI SDK formatieren
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

    // Titel aus erster User-Nachricht
    const firstUserText =
      formattedMessages.find((m) => m.role === 'user')?.content || '';
    const activeTitle = makeChatTitle(firstUserText);

    // Spezieller Fall: Bildgenerierung (Pollinations)
    if (modelDef.key === IMAGE_MODEL || modelDef.provider === 'image') {
      const prompt = formattedMessages[formattedMessages.length - 1]?.content || '';
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
      const markdown = `![Generiertes Bild](${imageUrl})`;

      // Speichern
      await saveChatMessages(activeChatId, activeTitle, [
        ...formattedMessages,
        { role: 'assistant', content: markdown },
      ]);

      // Als Stream zurückgeben (einfacher Text-Stream)
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder(markdown));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    // Normales Sprachmodell
    const languageModel = getLanguageModel(modelDef);

    const result = await streamText({
      model: languageModel,
      messages: formattedMessages,
      onFinish: async ({ text }) => {
        try {
          await saveChatMessages(activeChatId, activeTitle, [
            ...formattedMessages,
            { role: 'assistant', content: text || '' },
          ]);
        } catch (dbError) {
          console.error('Fehler beim Speichern in Neon:', dbError);
        }
      },
    });

    return result.toTextStreamResponse();
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