import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { createSession, getUserSessions, getSession, saveMessage, getMessages } from '@/lib/db/users';

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const sessions = await getUserSessions(session.user.id);
    return NextResponse.json(sessions);
  } catch (e) {
    console.error('Get sessions error:', e);
    return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { title, modelId } = await req.json();
    const newSession = await createSession(session.user.id, title || 'Neuer Chat', modelId || 'google/gemini-2.5-flash');
    return NextResponse.json(newSession);
  } catch (e) {
    console.error('Create session error:', e);
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }
}