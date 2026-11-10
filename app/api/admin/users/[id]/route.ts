import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { updateUserStatus, deleteUser } from '@/lib/db/users';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.role || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  // Prevent admin from deactivating themselves
  if (id === session.user.id) {
    return NextResponse.json({ error: 'Cannot modify own account' }, { status: 400 });
  }

  try {
    const { is_active } = await req.json();
    const user = await updateUserStatus(id, is_active);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    return NextResponse.json(user);
  } catch (e) {
    console.error('Update user error:', e);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.role || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  // Prevent admin from deleting themselves
  if (id === session.user.id) {
    return NextResponse.json({ error: 'Cannot delete own account' }, { status: 400 });
  }

  try {
    await deleteUser(id);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Delete user error:', e);
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}