import { NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { loadImage } from '@/lib/images';

/** GET /api/images/[id]: liefert ein selbst erzeugtes Bild (nur Besitzer oder Admin). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 });
  }

  const image = await loadImage(id);
  if (!image || (image.user_id !== user.id && !(await isAdmin()))) {
    return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
  }

  return new Response(new Uint8Array(Buffer.from(image.data, 'base64')), {
    headers: {
      'Content-Type': image.mime,
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
