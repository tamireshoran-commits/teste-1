/**
 * Aritmética de horário local por workspace.
 *
 * O horário silencioso e o limite diário são conceitos do fuso do cliente, não
 * do servidor: um workspace em São Paulo e outro em Lisboa não podem depender
 * de o container estar em UTC. Tudo aqui usa `Intl` com o fuso do workspace,
 * sem dependência externa de datas.
 */

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(date: Date, timeZone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, number> = {};

  for (const part of formatter.formatToParts(date)) {
    if (part.type === 'literal') continue;

    const value = Number(part.value);

    // `hour12: false` devolve 24 à meia-noite em algumas plataformas; o resto
    // dos campos vai como está (aplicar módulo aqui transformaria 2026 em 26).
    parts[part.type] = part.type === 'hour' ? value % 24 : value;
  }

  return {
    year: parts['year'] ?? 1970,
    month: parts['month'] ?? 1,
    day: parts['day'] ?? 1,
    hour: parts['hour'] ?? 0,
    minute: parts['minute'] ?? 0,
    second: parts['second'] ?? 0,
  };
}

/** Fuso inválido derruba o `Intl`; cai para UTC em vez de quebrar o envio. */
export function safeTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return 'UTC';
  }
}

/** Hora local (0-23) no fuso informado. */
export function localHour(date: Date, timeZone: string): number {
  return localParts(date, safeTimeZone(timeZone)).hour;
}

/** Data local no formato YYYY-MM-DD — chave de "hoje" para limites diários. */
export function localDayKey(date: Date, timeZone: string): string {
  const { year, month, day } = localParts(date, safeTimeZone(timeZone));
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface QuietHours {
  /** Hora em que o silêncio começa (ex.: 21). */
  start: number;
  /** Hora em que o silêncio termina (ex.: 8). */
  end: number;
}

/**
 * O intervalo pode cruzar a meia-noite (21h → 8h), que é justamente o caso
 * comum. `start === end` significa "sem horário silencioso".
 */
export function isQuietHour(
  date: Date,
  timeZone: string,
  quiet: QuietHours,
): boolean {
  const start = normalizeHour(quiet.start);
  const end = normalizeHour(quiet.end);

  if (start === end) return false;

  const hour = localHour(date, timeZone);

  return start < end
    ? hour >= start && hour < end
    : hour >= start || hour < end;
}

/**
 * Primeiro instante fora do horário silencioso, a partir de `from`.
 *
 * Avança de 15 em 15 minutos em vez de calcular o offset diretamente: assim o
 * resultado continua correto em dias de mudança de horário de verão, quando a
 * diferença entre hora local e UTC muda no meio do intervalo.
 */
export function nextAllowedInstant(
  from: Date,
  timeZone: string,
  quiet: QuietHours,
): Date {
  if (!isQuietHour(from, timeZone, quiet)) return from;

  const stepMs = 15 * 60 * 1000;
  let cursor = new Date(from.getTime());

  // 24h de busca: mais que isso significa configuração impossível.
  for (let i = 0; i < 96; i++) {
    cursor = new Date(cursor.getTime() + stepMs);
    if (!isQuietHour(cursor, timeZone, quiet)) return cursor;
  }

  return cursor;
}

/** Início do próximo dia local — quando um limite diário se renova. */
export function startOfNextLocalDay(date: Date, timeZone: string): Date {
  const zone = safeTimeZone(timeZone);
  const today = localDayKey(date, zone);

  const stepMs = 15 * 60 * 1000;
  let cursor = new Date(date.getTime());

  for (let i = 0; i < 200; i++) {
    cursor = new Date(cursor.getTime() + stepMs);
    if (localDayKey(cursor, zone) !== today) return cursor;
  }

  return new Date(date.getTime() + 24 * 60 * 60 * 1000);
}

function normalizeHour(hour: number): number {
  if (!Number.isFinite(hour)) return 0;
  return Math.min(23, Math.max(0, Math.trunc(hour)));
}

export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (60 * 60 * 1000);
}
