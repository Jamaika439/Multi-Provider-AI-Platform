import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { getSession, saveMessage, getMessages } from '@/lib/db/users';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const chatSession = await getSession(id);
    if (!chatSession || chatSession.user_id !== session.user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const messages = await getMessages(id);
    return NextResponse.json({ session: chatSession, messages });
  } catch (e) {
    console.error('Get session error:', e);
    return NextResponse.json({ error: 'Failed to fetch session' }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const chatSession = await getSession(id);
    if (!chatSession || chatSession.user_id !== session.user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { role, content, modelId } = await req.json();
    await saveMessage(id, role, content, modelId);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Save message error:', e);
    return NextResponse.json({ error: 'Failed to save message' }, { status: 500 });
  }
}