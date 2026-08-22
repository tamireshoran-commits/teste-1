import { env } from '@/server/config/env';

/**
 * Resolve o token de acesso de uma conta.
 *
 * `SocialAccount.tokenRef` guarda o **nome de uma variável de ambiente**, não
 * o token. Assim o segredo fica no gerenciador de segredos da hospedagem, um
 * dump do banco não vaza acesso às contas dos clientes, e revogar é trocar uma
 * variável — sem migration.
 *
 * Em um SaaS multi-cliente isto evolui para um cofre (KMS/Vault) com envelope
 * encryption; a assinatura desta função não muda.
 */
export function resolveAccessToken(tokenRef: string | null): string | null {
  if (tokenRef !== null && tokenRef.trim() !== '') {
    const fromEnv = process.env[tokenRef];
    if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv;
  }

  const fallback = env.META_ACCESS_TOKEN;
  return fallback !== undefined && fallback.trim() !== '' ? fallback : null;
}
