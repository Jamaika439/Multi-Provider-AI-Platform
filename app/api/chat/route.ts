import { NextResponse } from 'next/server';
import { saveChatMessages } from '@/lib/db';
import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { messages, chatId, title } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Keine gültigen Nachrichten übergeben' },
        { status: 400 }
      );
    }

    // Wandelt Frontend-Nachrichten (z.B. mit parts-Array) in das vom AI SDK erwartete Format um
    const formattedMessages = messages.map((m: any) => {
      let content = m.content;
      
      // Falls content leer ist, aber parts vorhanden sind (wie im Log gesehen)
      if (!content && Array.isArray(m.parts)) {
        content = m.parts
          .filter((p: any) => p.type === 'text')
          .map((p: any) => p.text)
          .join('');
      }

      return {
        role: m.role || 'user',
        content: typeof content === 'string' ? content : String(content || ''),
      };
    });

    const activeChatId = chatId || `chat-${Date.now()}`;
    const activeTitle = title || formattedMessages[0]?.content?.slice(0, 30) || 'Neuer Chat';

    const result = await streamText({
      model: openai('gpt-4o-mini'),
      messages: formattedMessages,
      onFinish: async ({ text }) => {
        try {
          const fullMessages = [
            ...formattedMessages,
            { role: 'assistant', content: text || '' }
          ];
          await saveChatMessages(activeChatId, activeTitle, fullMessages);
        } catch (dbError) {
          console.error('Fehler beim Speichern in Neon:', dbError);
        }
      },
    });

    return result.toTextStreamResponse();
  } catch (error: any) {
    console.error('Fehler in /api/chat:', error);
    return NextResponse.json(
      { error: error.message || 'Fehler beim Verarbeiten der Nachricht' },
      { status: 500 }
    );
  }
}