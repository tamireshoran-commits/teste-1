/**
 * Erro de autorização.
 *
 * Em módulo próprio, separado de `auth/index.ts`, porque importar aquele
 * arquivo inicializa o NextAuth inteiro. Os serviços de domínio precisam só
 * deste erro — e passam a ser importáveis em teste sem carregar o framework.
 */
export class UnauthorizedError extends Error {
  readonly status = 401;

  constructor(message = 'Não autenticado') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}
