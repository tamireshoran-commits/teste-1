import { describe, expect, it } from 'vitest';
import {
  isQuietHour,
  localDayKey,
  localHour,
  nextAllowedInstant,
  safeTimeZone,
  startOfNextLocalDay,
} from '@/server/growth/policy/time';

const SP = 'America/Sao_Paulo';

describe('horário local do workspace', () => {
  it('converte para a hora local, não a do servidor', () => {
    // 2026-03-10T03:00:00Z = meia-noite em São Paulo (UTC-3).
    const instant = new Date('2026-03-10T03:00:00Z');

    expect(localHour(instant, SP)).toBe(0);
    expect(localHour(instant, 'UTC')).toBe(3);
  });

  it('reconhece o intervalo de silêncio que cruza a meia-noite', () => {
    const quiet = { start: 21, end: 8 };

    // 23h em São Paulo.
    expect(isQuietHour(new Date('2026-03-11T02:00:00Z'), SP, quiet)).toBe(true);
    // 5h em São Paulo.
    expect(isQuietHour(new Date('2026-03-11T08:00:00Z'), SP, quiet)).toBe(true);
    // 14h em São Paulo.
    expect(isQuietHour(new Date('2026-03-11T17:00:00Z'), SP, quiet)).toBe(false);
  });

  it('trata início igual a fim como "sem horário silencioso"', () => {
    expect(
      isQuietHour(new Date('2026-03-11T02:00:00Z'), SP, { start: 0, end: 0 }),
    ).toBe(false);
  });

  it('devolve o próximo instante permitido depois do silêncio', () => {
    const quiet = { start: 21, end: 8 };
    const duringQuiet = new Date('2026-03-11T05:00:00Z'); // 2h em São Paulo

    const next = nextAllowedInstant(duringQuiet, SP, quiet);

    expect(next.getTime()).toBeGreaterThan(duringQuiet.getTime());
    expect(isQuietHour(next, SP, quiet)).toBe(false);
    expect(localHour(next, SP)).toBe(8);
  });

  it('não adia quando já está fora do silêncio', () => {
    const quiet = { start: 21, end: 8 };
    const allowed = new Date('2026-03-11T17:00:00Z');

    expect(nextAllowedInstant(allowed, SP, quiet)).toBe(allowed);
  });

  it('calcula o início do próximo dia local', () => {
    const instant = new Date('2026-03-11T17:00:00Z'); // 14h em São Paulo
    const next = startOfNextLocalDay(instant, SP);

    expect(localDayKey(next, SP)).toBe('2026-03-12');
    expect(localHour(next, SP)).toBe(0);
  });

  it('cai para UTC quando o fuso é inválido, em vez de estourar', () => {
    expect(safeTimeZone('Nao/Existe')).toBe('UTC');
    expect(() => localHour(new Date(), 'Nao/Existe')).not.toThrow();
  });
});
