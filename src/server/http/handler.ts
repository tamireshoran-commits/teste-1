import { NextResponse } from 'next/server';
import { z } from 'zod';
import { UnauthorizedError } from '@/server/auth/errors';
import { AppError, toAppError } from '@/server/core/shared/errors';
import { logger } from '@/server/core/shared/logger';

const log = logger.child('http');

/** Erro do domínio -> status HTTP. */
const STATUS_BY_CODE: Record<string, number> = {
  VALIDATION_ERROR: 400,
  INVALID_INPUT: 400,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_FORMAT: 415,
  NOT_FOUND: 404,
  RATE_LIMIT: 429,
  TIMEOUT: 504,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_ERROR: 502,
  BUDGET_EXCEEDED: 402,
};

/**
 * Envolve um handler de rota com tratamento de erro uniforme.
 *
 * Sem isto, cada rota repetiria o mesmo try/catch e um erro não previsto
 * vazaria stack trace para o cliente.
 */
export function route<T>(
  handler: () => Promise<T>,
  successStatus = 200,
): Promise<NextResponse> {
  return handler()
    .then((data) => NextResponse.json(data as object, { status: successStatus }))
    .catch((error: unknown) => {
      if (error instanceof UnauthorizedError) {
        return NextResponse.json({ error: error.message }, { status: 401 });
      }

      const appError = toAppError(error);
      const status = STATUS_BY_CODE[appError.code] ?? 500;

      // 5xx é falha nossa e precisa aparecer no log com contexto.
      if (status >= 500) {
        log.error('falha na rota', { error: appError, context: appError.context });
      }

      return NextResponse.json(
        {
          error: appError.message,
          code: appError.code,
          ...(Object.keys(appError.context).length > 0
            ? { details: appError.context }
            : {}),
        },
        { status },
      );
    });
}

/** Faz o parse do corpo JSON validando com Zod. */
export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    throw new AppError('Corpo da requisição não é JSON válido.', {
      code: 'VALIDATION_ERROR',
    });
  }

  const parsed = schema.safeParse(raw);

  if (!parsed.success) {
    throw new AppError('Dados inválidos.', {
      code: 'VALIDATION_ERROR',
      context: {
        issues: parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      },
    });
  }

  return parsed.data;
}
