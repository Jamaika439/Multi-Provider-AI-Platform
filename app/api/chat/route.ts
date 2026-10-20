import { NextResponse } from 'next/server';
import { saveChatMessages } from '@/lib/db';
import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { messages, chatId, title } = body;

    const activeChatId = chatId || `chat-${Date.now()}`;
    const activeTitle = title || messages[0]?.content?.slice(0, 30) || 'Neuer Chat';

    const result = await streamText({
      model: openai('gpt-4o-mini'),
      messages,
      onFinish: async ({ text }) => {
        try {
          const fullMessages = [
            ...messages,
            { role: 'assistant', content: text || '' }
          ];
          await saveChatMessages(activeChatId, activeTitle, fullMessages);
        } catch (dbError) {
          console.error('Fehler beim Speichern:', dbError);
        }
      },
    });

    // Ersetzt toDataStreamResponse() durch den direkten Stream-Return
    return result.toAIStreamResponse();
  } catch (error: any) {
    console.error('Fehler in /api/chat:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}