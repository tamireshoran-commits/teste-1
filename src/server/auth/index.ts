import NextAuth from 'next-auth';
import { authConfig } from './config';
import { UnauthorizedError } from './errors';

export { UnauthorizedError } from './errors';

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

/**
 * Retorna o id do usuário autenticado ou lança.
 * Toda rota de API que toca dados de usuário deve passar por aqui.
 */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    throw new UnauthorizedError();
  }

  return userId;
}
