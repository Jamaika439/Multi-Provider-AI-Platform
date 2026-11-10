import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { getUserByEmail, verifyPassword } from '@/lib/db/users';

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'E-Mail', type: 'email' },
        password: { label: 'Passwort', type: 'password' },
      },
      authorize: async (credentials) => {
        if (!credentials?.email || !credentials?.password) return null;
        
        const user = await getUserByEmail(credentials.email as string);
        if (!user || !user.is_active) return null;
        
        const valid = await verifyPassword(user, credentials.password as string);
        if (!valid) return null;
        
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    jwt: ({ token, user }) => {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    session: ({ session, token }) => {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: { strategy: 'jwt' },
  secret: process.env.AUTH_SECRET,
});