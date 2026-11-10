import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isAdmin = req.auth?.user?.role === 'admin';
  const isAdminRoute = req.nextUrl.pathname.startsWith('/admin');
  const isLoginPage = req.nextUrl.pathname === '/login';
  const isApiRoute = req.nextUrl.pathname.startsWith('/api/');
  const isAuthApiRoute = req.nextUrl.pathname.startsWith('/api/auth');
  const isPublicRoute = req.nextUrl.pathname === '/' || req.nextUrl.pathname.startsWith('/_next') || req.nextUrl.pathname.startsWith('/favicon');

  // Allow public routes
  if (isPublicRoute) return NextResponse.next();

  // Allow auth API routes
  if (isAuthApiRoute) return NextResponse.next();

  // Protect other API routes
  if (isApiRoute) {
    if (!isLoggedIn) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (req.nextUrl.pathname.startsWith('/api/admin') && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.next();
  }

  // Redirect to login if not authenticated
  if (!isLoggedIn) {
    const loginUrl = new URL('/login', req.nextUrl.origin);
    loginUrl.searchParams.set('callbackUrl', req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Admin routes require admin role
  if (isAdminRoute && !isAdmin) {
    return NextResponse.redirect(new URL('/', req.nextUrl.origin));
  }

  // Redirect logged-in users from login page to home
  if (isLoginPage && isLoggedIn) {
    return NextResponse.redirect(new URL('/', req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};