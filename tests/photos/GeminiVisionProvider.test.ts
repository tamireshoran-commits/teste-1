import { describe, expect, it, vi } from 'vitest';
import { GeminiVisionProvider } from '@/server/core/providers/ai/vision/GeminiVisionProvider';
import {
  extractJsonObject,
  parsePhotoResponse,
} from '@/server/core/providers/ai/vision/photoResponseSchema';
import { sha256 } from '@/server/core/shared/cache';
import {
  InvalidInputError,
  ProviderError,
  RateLimitError,
  TimeoutError,
} from '@/server/core/shared/errors';
import type { ImageInput } from '@/server/core/types';

const IMAGE: ImageInput = {
  id: 'foto-1',
  data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]),
  mimeType: 'image/jpeg',
  sizeBytes: 8,
  position: 0,
  sha256: sha256('foto-1'),
};

const VALID_JSON = JSON.stringify({
  room_type: 'sala',
  visual_quality: 82,
  lighting: 75,
  composition: 80,
  professionalism: 70,
  value_perception: 78,
  clarity: 85,
  strengths: ['Ambiente amplo'],
  problems: ['Sombra no canto'],
  recommendations: ['Fotografar de manhã'],
  score: 79,
});

/** Cliente falso com a mesma forma da parte do SDK que consumimos. */
function fakeClient(
  impl: () => Promise<unknown> | never,
): { models: { generateContent: ReturnType<typeof vi.fn> } } {
  return { models: { generateContent: vi.fn(impl) } };
}

function providerWith(impl: () => Promise<unknown>): GeminiVisionProvider {
  return new GeminiVisionProvider({
    apiKey: 'chave-de-teste',
    model: 'gemini-2.5-flash',
    client: fakeClient(impl) as never,
  });
}

describe('GeminiVisionProvider — caminho feliz', () => {
  it('analisa uma imagem e devolve o resultado tipado', async () => {
    const provider = providerWith(async () => ({
      text: VALID_JSON,
      usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 180 },
    }));

    const output = await provider.analyzeImage(IMAGE);

    expect(output.result).toMatchObject({
      photoId: 'foto-1',
      roomType: 'sala',
      lighting: 75,
      score: 79,
    });
    expect(output.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 180,
      imageCount: 1,
    });
  });

  it('envia a imagem como inlineData em base64, uma por chamada', async () => {
    const client = fakeClient(async () => ({ text: VALID_JSON }));
    const provider = new GeminiVisionProvider({
      apiKey: 'k',
      model: 'gemini-2.5-flash',
      client: client as never,
    });

    await provider.analyzeImage(IMAGE);

    const call = client.models.generateContent.mock.calls[0]![0] as {
      contents: Array<{ parts: Array<Record<string, unknown>> }>;
      config: Record<string, unknown>;
    };

    const parts = call.contents[0]!.parts;
    const inline = parts.find((p) => 'inlineData' in p)!['inlineData'] as {
      mimeType: string;
      data: string;
    };

    expect(parts).toHaveLength(2);
    expect(inline.mimeType).toBe('image/jpeg');
    expect(inline.data).toBe(Buffer.from(IMAGE.data).toString('base64'));
    expect(call.config['responseMimeType']).toBe('application/json');
  });

  it('trata usageMetadata ausente como zero, sem quebrar', async () => {
    const provider = providerWith(async () => ({ text: VALID_JSON }));
    const output = await provider.analyzeImage(IMAGE);

    expect(output.usage.inputTokens).toBe(0);
    expect(output.usage.outputTokens).toBe(0);
  });
});

describe('GeminiVisionProvider — tradução de erros', () => {
  const cases: Array<{
    nome: string;
    erro: unknown;
    tipo: unknown;
    retryable: boolean;
  }> = [
    {
      nome: 'rate limit por status 429',
      erro: Object.assign(new Error('too many requests'), { status: 429 }),
      tipo: RateLimitError,
      retryable: true,
    },
    {
      nome: 'rate limit por mensagem de quota',
      erro: new Error('RESOURCE_EXHAUSTED: quota exceeded'),
      tipo: RateLimitError,
      retryable: true,
    },
    {
      nome: 'imagem inválida por status 400',
      erro: Object.assign(new Error('cannot decode image'), { status: 400 }),
      tipo: InvalidInputError,
      retryable: false,
    },
    {
      nome: 'credencial inválida por 403',
      erro: Object.assign(new Error('permission denied'), { status: 403 }),
      tipo: ProviderError,
      retryable: false,
    },
    {
      nome: 'falha do servidor por 503',
      erro: Object.assign(new Error('service unavailable'), { status: 503 }),
      tipo: ProviderError,
      retryable: true,
    },
    {
      nome: 'erro de rede desconhecido',
      erro: new Error('socket hang up'),
      tipo: ProviderError,
      retryable: true,
    },
  ];

  for (const caso of cases) {
    it(`mapeia ${caso.nome}`, async () => {
      const provider = providerWith(async () => {
        throw caso.erro;
      });

      const error = await provider
        .analyzeImage(IMAGE)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(caso.tipo as never);
      expect((error as { retryable: boolean }).retryable).toBe(caso.retryable);
    });
  }

  it('401 de credencial não é confundido com imagem inválida', async () => {
    // Regressão de um bug pego só na chamada real: o corpo do 401 contém
    // "ACCESS_TOKEN_TYPE_UNSUPPORTED", e o filtro por /unsupported/ avaliado
    // antes do status classificava o problema como arquivo inválido — o
    // usuário veria "imagem rejeitada" quando o defeito era a credencial.
    const corpoReal = JSON.stringify({
      error: {
        code: 401,
        message:
          'Request had invalid authentication credentials. Expected OAuth 2 ' +
          'access token, login cookie or other valid authentication credential.',
        status: 'UNAUTHENTICATED',
        details: [{ reason: 'ACCESS_TOKEN_TYPE_UNSUPPORTED' }],
      },
    });

    const provider = providerWith(async () => {
      throw Object.assign(new Error(corpoReal), { status: 401 });
    });

    const error = await provider.analyzeImage(IMAGE).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).not.toBeInstanceOf(InvalidInputError);
    expect((error as ProviderError).message).toMatch(/[Cc]redencial/);
    expect((error as ProviderError).retryable).toBe(false);
  });

  it('classifica credencial inválida mesmo sem status numérico', async () => {
    const provider = providerWith(async () => {
      throw new Error('UNAUTHENTICATED: API key not valid');
    });

    const error = await provider.analyzeImage(IMAGE).catch((e: unknown) => e);

    expect((error as ProviderError).retryable).toBe(false);
    expect((error as ProviderError).message).toMatch(/[Cc]redencial/);
  });

  it('converte abort em TimeoutError', async () => {
    const provider = providerWith(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });

    const error = await provider.analyzeImage(IMAGE).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as TimeoutError).retryable).toBe(true);
  });

  it('extrai o retryDelay informado pela API', async () => {
    const provider = providerWith(async () => {
      throw Object.assign(
        new Error('{"error":{"code":429,"retryDelay":"32s"}}'),
        { status: 429 },
      );
    });

    const error = (await provider
      .analyzeImage(IMAGE)
      .catch((e: unknown) => e)) as RateLimitError;

    expect(error.retryAfterMs).toBe(32_000);
  });

  it('rejeita imagem vazia antes de chamar a API', async () => {
    const client = fakeClient(async () => ({ text: VALID_JSON }));
    const provider = new GeminiVisionProvider({
      apiKey: 'k',
      model: 'gemini-2.5-flash',
      client: client as never,
    });

    await expect(
      provider.analyzeImage({ ...IMAGE, data: new Uint8Array(0) }),
    ).rejects.toThrow(InvalidInputError);

    // Nunca chegou a gastar uma chamada.
    expect(client.models.generateContent).not.toHaveBeenCalled();
  });

  it('rejeita mime não suportado antes de chamar a API', async () => {
    const client = fakeClient(async () => ({ text: VALID_JSON }));
    const provider = new GeminiVisionProvider({
      apiKey: 'k',
      model: 'gemini-2.5-flash',
      client: client as never,
    });

    await expect(
      provider.analyzeImage({ ...IMAGE, mimeType: 'image/gif' }),
    ).rejects.toThrow(/não aceita imagens/);

    expect(client.models.generateContent).not.toHaveBeenCalled();
  });

  it('resposta vazia é tratada como falha retentável', async () => {
    const provider = providerWith(async () => ({ text: '' }));
    const error = await provider.analyzeImage(IMAGE).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).retryable).toBe(true);
  });

  it('sem API key o provider se declara indisponível', async () => {
    const provider = new GeminiVisionProvider({
      apiKey: '   ',
      model: 'gemini-2.5-flash',
      client: fakeClient(async () => ({})) as never,
    });

    expect(await provider.isAvailable()).toBe(false);
  });
});

describe('extractJsonObject', () => {
  it('lê JSON puro', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('lê JSON dentro de cerca de código', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('lê JSON com texto antes e depois', () => {
    expect(
      extractJsonObject('Aqui está a análise:\n{"a":1}\nEspero ter ajudado.'),
    ).toEqual({ a: 1 });
  });

  it('falha de forma retentável quando não há JSON', () => {
    const error = (() => {
      try {
        extractJsonObject('não consigo analisar esta imagem');
      } catch (e) {
        return e;
      }
    })() as ProviderError;

    expect(error).toBeInstanceOf(ProviderError);
    expect(error.retryable).toBe(true);
  });

  it('falha de forma retentável para JSON malformado', () => {
    expect(() => extractJsonObject('{"a": }')).toThrow(ProviderError);
  });
});

describe('parsePhotoResponse', () => {
  it('aceita notas como string numérica', () => {
    const result = parsePhotoResponse(
      { ...JSON.parse(VALID_JSON), lighting: '75', score: '79' },
      'foto-1',
    );

    expect(result.lighting).toBe(75);
    expect(result.score).toBe(79);
  });

  it('satura notas fora da faixa em vez de rejeitar', () => {
    const result = parsePhotoResponse(
      { ...JSON.parse(VALID_JSON), lighting: 150, clarity: -20 },
      'foto-1',
    );

    expect(result.lighting).toBe(100);
    expect(result.clarity).toBe(0);
  });

  it('normaliza ambiente desconhecido para "outro"', () => {
    const result = parsePhotoResponse(
      { ...JSON.parse(VALID_JSON), room_type: 'adega climatizada' },
      'foto-1',
    );

    expect(result.roomType).toBe('outro');
  });

  it('rejeita resposta sem os campos obrigatórios', () => {
    expect(() => parsePhotoResponse({ room_type: 'sala' }, 'foto-1')).toThrow(
      ProviderError,
    );
  });

  it('usa o photoId do chamador, não o que o modelo eventualmente inventar', () => {
    const result = parsePhotoResponse(
      { ...JSON.parse(VALID_JSON), photoId: 'inventado' },
      'foto-real',
    );

    expect(result.photoId).toBe('foto-real');
  });
});
