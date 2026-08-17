/**
 * Logger estruturado mínimo (JSON em uma linha).
 *
 * Sem dependência externa: em produção serverless o stdout já é coletado pela
 * plataforma, e JSON permite filtrar por `scope`/`analysisId` sem parser.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function minLevel(): LogLevel {
  if (process.env.DEBUG_LOGS === 'true' || process.env.DEBUG_LOGS === '1') {
    return 'debug';
  }
  if (process.env.NODE_ENV === 'test') return 'error';
  return 'info';
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(scope: string, context?: Record<string, unknown>): Logger;
}

function serializeContext(
  context: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    if (value instanceof Error) {
      out[key] = {
        name: value.name,
        message: value.message,
        ...('code' in value ? { code: value.code } : {}),
      };
    } else {
      out[key] = value;
    }
  }

  return out;
}

function createLogger(
  scope: string,
  baseContext: Record<string, unknown> = {},
): Logger {
  const emit = (
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ) => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel()]) return;

    const entry = {
      level,
      scope,
      message,
      timestamp: new Date().toISOString(),
      ...serializeContext({ ...baseContext, ...context }),
    };

    const line = JSON.stringify(entry);

    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };

  return {
    debug: (m, c) => emit('debug', m, c),
    info: (m, c) => emit('info', m, c),
    warn: (m, c) => emit('warn', m, c),
    error: (m, c) => emit('error', m, c),
    child: (childScope, childContext) =>
      createLogger(`${scope}:${childScope}`, {
        ...baseContext,
        ...childContext,
      }),
  };
}

export const logger: Logger = createLogger('stayscore');
