import { NextResponse } from 'next/server';
import { saveChatMessages } from '@/lib/db';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText } from 'ai';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY || '',
});

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { messages, chatId, title, model } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Keine gültigen Nachrichten übergeben' },
        { status: 400 }
      );
    }

    const formattedMessages = messages.map((m: any) => {
      let content = m.content;
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

    // Nutzt das exakt vom Frontend übergebene Modell über OpenRouter (wie lokal)
    const activeModel = model || 'deepseek/deepseek-chat';

    const activeChatId = chatId || `chat-${Date.now()}`;
    const activeTitle = title || formattedMessages[0]?.content?.slice(0, 30) || 'Neuer Chat';

    const result = await streamText({
      model: openrouter(activeModel),
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