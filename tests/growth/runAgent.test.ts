import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { MockLLMProvider } from '@/server/core/providers/ai/llm/MockLLMProvider';
import { InMemoryCacheStore } from '@/server/core/shared/cache';
import { NoopUsageRecorder } from '@/server/core/shared/usage';
import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from '@/server/core/providers/ai/llm/LLMProvider';
import { runAgent, type AgentRunRecord } from '@/server/growth/agents/runAgent';

const schema = z.object({
  temperature: z.enum(['COLD', 'WARM', 'HOT', 'READY']),
  score: z.number(),
});

const VALID = { temperature: 'WARM', score: 40 };

const variables = {
  brandName: 'Marca',
  language: 'pt-BR',
  channel: 'IG_DM',
  message: 'quanto custa?',
  history: 'nenhum',
  products: '[]',
  sourceContent: 'post',
};

function options(llm: LLMProvider, extra: Record<string, unknown> = {}) {
  return {
    agent: 'LEAD_QUALIFIER' as const,
    workspaceId: 'ws-1',
    operation: 'test:qualify',
    prompt: 'growth/lead-qualification' as const,
    variables,
    schema,
    llm,
    retries: 1,
    ...extra,
  };
}

/** Conta chamadas para provar que o cache evita a segunda ida ao modelo. */
class CountingLLM implements LLMProvider {
  readonly name = 'counting';
  calls = 0;

  constructor(private readonly response: unknown) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async completeJSON<T>(request: LLMRequest<T>): Promise<LLMResponse<T>> {
    this.calls++;

    return {
      data: request.parse(this.response),
      usage: { inputTokens: 120, outputTokens: 30 },
      model: 'mock-model',
    };
  }
}

describe('execução instrumentada de agentes', () => {
  it('valida a saída e devolve o registro da execução', async () => {
    const llm = new MockLLMProvider().register('Agente 5', VALID);
    const usage = new NoopUsageRecorder();

    const result = await runAgent(options(llm, { usage }));

    expect(result.data).toEqual(VALID);
    expect(result.run.status).toBe('SUCCESS');
    expect(result.run.promptName).toBe('growth/lead-qualification');
    expect(result.run.promptVersion).toBe('v1');
    expect(result.run.workspaceId).toBe('ws-1');

    // O consumo precisa ser atribuível ao workspace para virar custo por
    // cliente depois.
    expect(usage.entries[0]?.workspaceId).toBe('ws-1');
    expect(usage.entries[0]?.operation).toBe('test:qualify');
  });

  it('rejeita saída fora do contrato em vez de propagar dado inválido', async () => {
    const llm = new MockLLMProvider().register('Agente 5', {
      temperature: 'MORNINHO',
      score: 'quarenta',
    });

    const runs: AgentRunRecord[] = [];

    await expect(
      runAgent(
        options(llm, {
          retries: 0,
          onRun: async (record: AgentRunRecord) => {
            runs.push(record);
          },
        }),
      ),
    ).rejects.toThrow(/não respeita o contrato/);

    expect(runs[0]?.status).toBe('FAILED');
  });

  it('registra a falha para o custo não ficar subestimado', async () => {
    const llm = new MockLLMProvider(); // sem resposta registrada: falha
    const usage = new NoopUsageRecorder();

    await expect(runAgent(options(llm, { usage, retries: 0 }))).rejects.toThrow();

    expect(usage.entries).toHaveLength(1);
    expect(usage.entries[0]?.success).toBe(false);
  });

  it('reaproveita o cache sem chamar o modelo de novo', async () => {
    const llm = new CountingLLM(VALID);
    const cache = new InMemoryCacheStore();

    const first = await runAgent(options(llm, { cache }));
    const second = await runAgent(options(llm, { cache }));

    expect(llm.calls).toBe(1);
    expect(first.run.fromCache).toBe(false);
    expect(second.run.fromCache).toBe(true);
    expect(second.data).toEqual(VALID);
  });

  it('falha quando falta variável do prompt, antes de gastar token', async () => {
    const llm = new CountingLLM(VALID);

    await expect(
      runAgent({
        ...options(llm),
        variables: { brandName: 'Marca' },
      }),
    ).rejects.toThrow(/Variáveis ausentes/);

    expect(llm.calls).toBe(0);
  });
});
