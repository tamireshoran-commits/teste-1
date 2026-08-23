import { describe, expect, it } from 'vitest';
import { modelForTier } from '@/server/core/providers/ai/llm/LLMProvider';
import { OpenAICompatibleLLMProvider } from '@/server/core/providers/ai/llm/OpenAICompatibleLLMProvider';
import {
  InvalidInputError,
  ProviderError,
  RateLimitError,
} from '@/server/core/shared/errors';

/**
 * Provider de endpoint compatível com OpenAI.
 *
 * Os testes cobrem o que muda quando a chamada passa por um gateway como o
 * OmniRoute: o modelo que responde pode não ser o pedido, o endpoint pode não
 * aceitar `response_format`, e o erro chega no formato do gateway, não no da
 * OpenAI.
 */

interface Call {
  url: string;
  body: Record<string, unknown>;
}

function fakeFetch(
  responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>,
) {
  const calls: Call[] = [];

  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });

    const next = responses.shift();

    if (next === undefined) throw new Error('chamada inesperada ao fetch');

    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: next.headers,
    });
  }) as unknown as typeof fetch;

  return { impl, calls };
}

function completion(content: string, model = 'roteado/modelo-x') {
  return {
    model,
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 120, completion_tokens: 40 },
  };
}

function build(
  fetchImpl: typeof fetch,
  overrides: Partial<{ jsonMode: boolean; privateModel: string }> = {},
) {
  return new OpenAICompatibleLLMProvider({
    baseUrl: 'http://localhost:20128/v1/',
    apiKey: 'chave-de-teste',
    cheapModel: 'barato',
    smartModel: 'caro',
    fetchImpl,
    label: 'gateway',
    ...overrides,
  });
}

const parse = (raw: unknown) => raw as { ok: boolean };

describe('provider compatível com OpenAI', () => {
  it('envia o prompt e devolve o JSON já validado', async () => {
    const { impl, calls } = fakeFetch([
      { status: 200, body: completion('{"ok":true}') },
    ]);

    const result = await build(impl).completeJSON({
      prompt: 'diga sim',
      parse,
      tier: 'cheap',
    });

    expect(result.data).toEqual({ ok: true });
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 40 });
    // O gateway pode atender com outro modelo; é o que responde que conta.
    expect(result.model).toBe('roteado/modelo-x');

    expect(calls[0]?.url).toBe('http://localhost:20128/v1/chat/completions');
    expect(calls[0]?.body['model']).toBe('barato');
    expect(calls[0]?.body['response_format']).toEqual({ type: 'json_object' });
  });

  it('usa o modelo caro quando o agente pede o tier smart', async () => {
    const { impl, calls } = fakeFetch([
      { status: 200, body: completion('{"ok":true}') },
    ]);

    await build(impl).completeJSON({ prompt: 'p', parse, tier: 'smart' });

    expect(calls[0]?.body['model']).toBe('caro');
  });

  it('inclui o prompt de sistema quando informado', async () => {
    const { impl, calls } = fakeFetch([
      { status: 200, body: completion('{"ok":true}') },
    ]);

    await build(impl).completeJSON({
      prompt: 'usuário',
      system: 'sistema',
      parse,
    });

    expect(calls[0]?.body['messages']).toEqual([
      { role: 'system', content: 'sistema' },
      { role: 'user', content: 'usuário' },
    ]);
  });

  it('repete sem response_format quando o modelo roteado não aceita', async () => {
    const { impl, calls } = fakeFetch([
      {
        status: 400,
        body: { error: { message: 'response_format is not supported' } },
      },
      { status: 200, body: completion('{"ok":true}') },
    ]);

    const result = await build(impl).completeJSON({ prompt: 'p', parse });

    expect(result.data).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body['response_format']).toBeUndefined();
  });

  it('não repete quando o 400 é por outro motivo', async () => {
    const { impl, calls } = fakeFetch([
      { status: 400, body: { error: { message: 'prompt muito longo' } } },
    ]);

    await expect(
      build(impl).completeJSON({ prompt: 'p', parse }),
    ).rejects.toBeInstanceOf(InvalidInputError);

    expect(calls).toHaveLength(1);
  });

  it('aceita JSON embrulhado em bloco de markdown', async () => {
    const { impl } = fakeFetch([
      {
        status: 200,
        body: completion('```json\n{"ok":true}\n```'),
      },
    ]);

    const result = await build(impl).completeJSON({ prompt: 'p', parse });

    expect(result.data).toEqual({ ok: true });
  });

  it('traduz 429 para RateLimitError respeitando o Retry-After', async () => {
    const { impl } = fakeFetch([
      {
        status: 429,
        body: { error: { message: 'slow down' } },
        headers: { 'retry-after': '30' },
      },
    ]);

    const error = await build(impl)
      .completeJSON({ prompt: 'p', parse })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterMs).toBe(30_000);
    expect((error as RateLimitError).retryable).toBe(true);
  });

  it('trata credencial recusada como erro definitivo', async () => {
    const { impl } = fakeFetch([
      { status: 401, body: { error: { message: 'invalid api key' } } },
    ]);

    const error = (await build(impl)
      .completeJSON({ prompt: 'p', parse })
      .catch((e: unknown) => e)) as ProviderError;

    expect(error).toBeInstanceOf(ProviderError);
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/LLM_API_KEY/);
  });

  it('explica o que fazer quando o modelo não existe no gateway', async () => {
    const { impl } = fakeFetch([
      { status: 404, body: { error: { message: 'model not found' } } },
    ]);

    const error = (await build(impl)
      .completeJSON({ prompt: 'p', parse })
      .catch((e: unknown) => e)) as ProviderError;

    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/LLM_MODEL_CHEAP/);
  });

  it('considera falha de servidor retentável', async () => {
    const { impl } = fakeFetch([
      { status: 503, body: { error: { message: 'upstream indisponível' } } },
    ]);

    const error = (await build(impl)
      .completeJSON({ prompt: 'p', parse })
      .catch((e: unknown) => e)) as ProviderError;

    expect(error.retryable).toBe(true);
  });

  it('trata resposta vazia como falha retentável', async () => {
    const { impl } = fakeFetch([{ status: 200, body: completion('   ') }]);

    const error = (await build(impl)
      .completeJSON({ prompt: 'p', parse })
      .catch((e: unknown) => e)) as ProviderError;

    expect(error.retryable).toBe(true);
    expect(error.message).toMatch(/vazia/);
  });

  it('usa o modelo reservado quando a chamada vê dado de cliente', async () => {
    const { impl, calls } = fakeFetch([
      { status: 200, body: completion('{"ok":true}') },
    ]);

    await build(impl, { privateModel: 'confiavel' }).completeJSON({
      prompt: 'p',
      parse,
      tier: 'private',
    });

    expect(calls[0]?.body['model']).toBe('confiavel');
  });

  it('sem modelo reservado configurado, o nível private cai no smart', async () => {
    const { impl, calls } = fakeFetch([
      { status: 200, body: completion('{"ok":true}') },
    ]);

    await build(impl).completeJSON({ prompt: 'p', parse, tier: 'private' });

    // Nunca no barato: o padrão de fallback precisa ser o mais protegido, não
    // o mais econômico.
    expect(calls[0]?.body['model']).toBe('caro');
  });

  it('não envia response_format quando o json mode está desligado', async () => {
    const { impl, calls } = fakeFetch([
      { status: 200, body: completion('{"ok":true}') },
    ]);

    await build(impl, { jsonMode: false }).completeJSON({ prompt: 'p', parse });

    expect(calls[0]?.body['response_format']).toBeUndefined();
  });
});


describe('mapeamento de nível para modelo', () => {
  const models = { cheap: 'barato', smart: 'caro', private: 'confiavel' };

  it('escolhe o modelo de cada nível', () => {
    expect(modelForTier('cheap', models)).toBe('barato');
    expect(modelForTier('smart', models)).toBe('caro');
    expect(modelForTier('private', models)).toBe('confiavel');
  });

  it('sem nível informado, usa o barato', () => {
    expect(modelForTier(undefined, models)).toBe('barato');
  });

  it('private sem configuração cai no smart, nunca no barato', () => {
    const semPrivate = { cheap: 'barato', smart: 'caro' };

    expect(modelForTier('private', semPrivate)).toBe('caro');
  });
});
