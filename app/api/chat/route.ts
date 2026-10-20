/**
 * app/api/chats/route.ts
 * =============================================================================
 * Endpunkt /api/chats: Lädt die Liste aller gespeicherten Chats aus Neon.
 * =============================================================================
 */
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

interface ChatRow {
  id: string;
  title: string;
  created_at: string;
}

export async function GET() {
  try {
    const chats = (await sql`
      SELECT id, title, created_at 
      FROM chats 
      ORDER BY created_at DESC
    `) as ChatRow[];

    return NextResponse.json(chats);
  } catch (error) {
    console.error('Fehler beim Laden der Chatliste:', error);
    return NextResponse.json(
      { error: 'Fehler beim Laden der Chats' },
      { status: 500 }
    );
  }
}