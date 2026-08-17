import { describe, expect, it, vi } from 'vitest';
import {
  AppError,
  InvalidInputError,
  ProviderError,
  RateLimitError,
  TimeoutError,
  ValidationError,
  isRetryable,
  toAppError,
} from '@/server/core/shared/errors';
import { withRetry, withTimeout } from '@/server/core/shared/retry';

/** Sleep instantâneo, para os testes não esperarem de verdade. */
const noSleep = async () => {};

describe('withRetry', () => {
  it('devolve o resultado na primeira tentativa bem-sucedida', async () => {
    const fn = vi.fn(async () => 'ok');

    await expect(withRetry(fn, { sleep: noSleep })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retenta erros transitórios até obter sucesso', async () => {
    let attempts = 0;

    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new ProviderError('instável');
        return 'ok';
      },
      { retries: 3, sleep: noSleep },
    );

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('não retenta erros não transitórios', async () => {
    const fn = vi.fn(async () => {
      throw new InvalidInputError('imagem corrompida');
    });

    await expect(withRetry(fn, { retries: 3, sleep: noSleep })).rejects.toThrow(
      InvalidInputError,
    );
    // Uma única chamada: repetir só queimaria orçamento.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respeita o número máximo de tentativas', async () => {
    const fn = vi.fn(async () => {
      throw new ProviderError('sempre falha');
    });

    await expect(withRetry(fn, { retries: 2, sleep: noSleep })).rejects.toThrow();
    // 1 inicial + 2 retentativas.
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('aplica backoff exponencial crescente', async () => {
    const delays: number[] = [];

    await expect(
      withRetry(
        async () => {
          throw new ProviderError('falha');
        },
        {
          retries: 3,
          baseDelayMs: 100,
          jitter: 0,
          sleep: async (ms) => {
            delays.push(ms);
          },
        },
      ),
    ).rejects.toThrow();

    expect(delays).toEqual([100, 200, 400]);
  });

  it('limita o atraso ao teto configurado', async () => {
    const delays: number[] = [];

    await expect(
      withRetry(
        async () => {
          throw new ProviderError('falha');
        },
        {
          retries: 5,
          baseDelayMs: 1000,
          maxDelayMs: 2000,
          jitter: 0,
          sleep: async (ms) => {
            delays.push(ms);
          },
        },
      ),
    ).rejects.toThrow();

    expect(Math.max(...delays)).toBeLessThanOrEqual(2000);
  });

  it('obedece ao retryAfter informado pelo provider', async () => {
    const delays: number[] = [];

    await expect(
      withRetry(
        async () => {
          throw new RateLimitError('gemini', 5000);
        },
        {
          retries: 1,
          baseDelayMs: 100,
          jitter: 0,
          sleep: async (ms) => {
            delays.push(ms);
          },
        },
      ),
    ).rejects.toThrow(RateLimitError);

    expect(delays[0]).toBe(5000);
  });

  it('notifica cada retentativa', async () => {
    const onRetry = vi.fn();

    await expect(
      withRetry(
        async () => {
          throw new ProviderError('falha');
        },
        { retries: 2, sleep: noSleep, onRetry },
      ),
    ).rejects.toThrow();

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0]![0]).toMatchObject({ attempt: 1 });
  });

  it('normaliza qualquer throw para AppError', async () => {
    const error = await withRetry(
      async () => {
        throw new Error('erro cru');
      },
      { retries: 0, sleep: noSleep },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
  });

  it('aceita uma política de retry customizada', async () => {
    const fn = vi.fn(async () => {
      throw new ValidationError('normalmente não retentaria');
    });

    await expect(
      withRetry(fn, { retries: 2, sleep: noSleep, shouldRetry: () => true }),
    ).rejects.toThrow();

    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('withTimeout', () => {
  it('devolve o valor quando a promise resolve a tempo', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'teste')).resolves.toBe(
      'ok',
    );
  });

  it('lança TimeoutError quando estoura o prazo', async () => {
    const lenta = new Promise((resolve) => setTimeout(resolve, 200));

    await expect(withTimeout(lenta, 20, 'operação lenta')).rejects.toThrow(
      TimeoutError,
    );
  });

  it('o TimeoutError é retentável', async () => {
    const lenta = new Promise((resolve) => setTimeout(resolve, 200));
    const error = await withTimeout(lenta, 20, 'x').catch((e: unknown) => e);

    expect(isRetryable(error)).toBe(true);
  });
});

describe('classificação de erros', () => {
  it('marca erros transitórios como retentáveis', () => {
    expect(isRetryable(new ProviderError('rede'))).toBe(true);
    expect(isRetryable(new RateLimitError('gemini'))).toBe(true);
    expect(isRetryable(new TimeoutError('x', 100))).toBe(true);
  });

  it('marca erros de entrada como não retentáveis', () => {
    expect(isRetryable(new ValidationError('csv inválido'))).toBe(false);
    expect(isRetryable(new InvalidInputError('imagem corrompida'))).toBe(false);
    expect(isRetryable(new Error('erro qualquer'))).toBe(false);
  });

  it('serializa o erro preservando código e contexto', () => {
    const error = new InvalidInputError('arquivo grande', 'FILE_TOO_LARGE', {
      sizeMb: 25,
    });

    expect(error.toJSON()).toMatchObject({
      code: 'FILE_TOO_LARGE',
      retryable: false,
      context: { sizeMb: 25 },
    });
  });

  it('converte valores arbitrários para AppError', () => {
    expect(toAppError('string solta')).toBeInstanceOf(AppError);
    expect(toAppError(new Error('x')).message).toBe('x');

    const original = new ValidationError('mantido');
    expect(toAppError(original)).toBe(original);
  });
});
