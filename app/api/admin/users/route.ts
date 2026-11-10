import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { listUsers, createUser, updateUserStatus, deleteUser } from '@/lib/db/users';

export async function GET() {
  const session = await auth();
  if (!session?.user?.role || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const users = await listUsers();
    return NextResponse.json(users);
  } catch (e) {
    console.error('List users error:', e);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.role || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { email, password, name, role } = await req.json();
    
    if (!email || !password) {
      return NextResponse.json({ error: 'E-Mail und Passwort erforderlich' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Passwort muss mindestens 8 Zeichen haben' }, { status: 400 });
    }

    const user = await createUser(email, password, name, role || 'user');
    return NextResponse.json(user);
  } catch (e: unknown) {
    console.error('Create user error:', e);
    if (e instanceof Error && e.message.includes('duplicate')) {
      return NextResponse.json({ error: 'E-Mail bereits registriert' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Fehler beim Erstellen' }, { status: 500 });
  }
}