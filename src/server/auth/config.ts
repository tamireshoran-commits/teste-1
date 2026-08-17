import { PrismaAdapter } from '@auth/prisma-adapter';
import bcrypt from 'bcryptjs';
import type { NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { env } from '@/server/config/env';
import { prisma } from '@/server/db/prisma';

export const credentialsSchema = z.object({
  email: z.string().email('E-mail inválido').toLowerCase().trim(),
  password: z.string().min(8, 'A senha deve ter ao menos 8 caracteres'),
});

/**
 * Auth.js com credenciais (e-mail + senha).
 *
 * O Credentials provider exige sessão via JWT — sessões em banco não são
 * suportadas para esse fluxo. O PrismaAdapter continua registrado para que
 * provedores OAuth possam ser adicionados depois sem migrar o modelo de dados.
 */
export const authConfig = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt' },
  secret: env.AUTH_SECRET,
  trustHost: true,
  pages: {
    signIn: '/login',
  },
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'E-mail', type: 'email' },
        password: { label: 'Senha', type: 'password' },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.passwordHash) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
} satisfies NextAuthConfig;
