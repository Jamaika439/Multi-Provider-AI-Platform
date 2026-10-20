import { NextResponse } from 'next/server';
import { sql, saveChatMessages } from '@/lib/db';

export async function POST(req: Request) {
  try {
    const { chatId, title, messages } = await req.json();

    // KI-Verarbeitung / Response Generierung
    // ...

    // Nachrichten in Neon speichern
    if (chatId && messages) {
      await saveChatMessages(chatId, title || 'Neuer Chat', messages);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Fehler in /api/chat:', error);
    return NextResponse.json(
      { error: 'Fehler beim Verarbeiten der Nachricht' },
      { status: 500 }
    );
  }
}