import 'dotenv/config';
import { env } from '../src/server/config/env.js';
import type { ModelTier } from '../src/server/core/providers/ai/llm/LLMProvider.js';
import { OpenAICompatibleLLMProvider } from '../src/server/core/providers/ai/llm/OpenAICompatibleLLMProvider.js';

/**
 * Diagnóstico da conexão com um gateway de IA (OmniRoute e afins).
 *
 * Existe porque a parte mais frágil dessa configuração não é o código: é
 * acertar o nome do modelo. Cada gateway batiza os modelos do seu jeito, e um
 * nome errado só aparece quando um cliente real manda mensagem e a resposta
 * não sai. Este comando descobre isso em dez segundos, antes de ir para o ar.
 *
 *   npm run growth:gateway
 */

const CHECK = '✔';
const CROSS = '✘';
const WARN = '⚠';

async function main(): Promise<void> {
  console.log('\n== Configuração ==\n');

  const baseUrl = env.LLM_BASE_URL?.trim() ?? '';
  const apiKey = env.LLM_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || '';

  console.log(`  LLM_PROVIDER     ${env.LLM_PROVIDER}`);
  console.log(`  LLM_BASE_URL     ${baseUrl || '(vazio)'}`);
  console.log(`  LLM_API_KEY      ${apiKey ? 'definida' : '(vazia)'}`);
  console.log(`  LLM_MODEL_CHEAP  ${env.LLM_MODEL_CHEAP}`);
  console.log(`  LLM_MODEL_SMART  ${env.LLM_MODEL_SMART}`);
  console.log(
    `  LLM_MODEL_PRIVATE ${env.LLM_MODEL_PRIVATE ?? '(vazio — usa o SMART)'}`,
  );
  console.log(`  IMAGE_PROVIDER   ${env.IMAGE_PROVIDER}`);

  if (env.LLM_PROVIDER !== 'OPENAI_COMPATIBLE' && env.LLM_PROVIDER !== 'OPENAI') {
    console.log(
      `\n${WARN}  LLM_PROVIDER não é OPENAI_COMPATIBLE: o sistema não vai usar ` +
        'o gateway.\n   Ajuste o .env antes de continuar.\n',
    );
    process.exitCode = 1;
    return;
  }

  if (baseUrl === '') {
    console.log(
      `\n${CROSS}  Falta LLM_BASE_URL.\n` +
        '   Com o OmniRoute local, use: http://localhost:20128/v1\n',
    );
    process.exitCode = 1;
    return;
  }

  await listModels(baseUrl, apiKey);

  console.log('\n== Teste de geração ==\n');

  const privateModel = env.LLM_MODEL_PRIVATE ?? env.LLM_MODEL_SMART;

  const cheap = await testModel('cheap', env.LLM_MODEL_CHEAP, baseUrl, apiKey);
  const smart = await testModel('smart', env.LLM_MODEL_SMART, baseUrl, apiKey);
  const reserved = await testModel('private', privateModel, baseUrl, apiKey);

  console.log('\n== Resultado ==\n');

  if (cheap && smart && reserved) {
    console.log(`${CHECK}  Gateway respondendo nos três níveis de modelo.`);

    if (env.LLM_MODEL_PRIVATE === undefined) {
      console.log(
        `\n${WARN}  LLM_MODEL_PRIVATE está vazio, então as conversas com\n` +
          '   cliente usam o mesmo modelo do SMART. Se o SMART é um\n' +
          '   fornecedor gratuito que treina com o que recebe, configure\n' +
          '   um modelo de confiança aqui — é o nível que lê mensagem de\n' +
          '   gente real (qualificação, venda e follow-up).\n',
      );
    } else {
      console.log(
        '\n   Conversas de cliente vão para ' +
          `"${env.LLM_MODEL_PRIVATE}". Confirme que esse fornecedor não\n` +
          '   treina com o que recebe.\n',
      );
    }

    return;
  }

  console.log(`${CROSS}  Corrija os itens acima antes de usar em produção.\n`);
  process.exitCode = 1;
}

/**
 * Lista os modelos que o gateway conhece.
 *
 * `/v1/models` é padrão no dialeto OpenAI, mas nem todo gateway implementa —
 * por isso a ausência é aviso, não erro.
 */
async function listModels(baseUrl: string, apiKey: string): Promise<void> {
  console.log('\n== Modelos disponíveis no gateway ==\n');

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey || 'local'}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      console.log(
        `  ${WARN}  O gateway respondeu ${response.status} em /models. ` +
          'Pegue os nomes no painel dele.',
      );
      return;
    }

    const payload = (await response.json()) as {
      data?: Array<{ id?: string }>;
    };

    const ids = (payload.data ?? [])
      .map((model) => model.id)
      .filter((id): id is string => typeof id === 'string')
      .sort();

    if (ids.length === 0) {
      console.log(`  ${WARN}  Nenhum modelo listado. Conecte um provedor no painel.`);
      return;
    }

    console.log(`  ${ids.length} modelos. Primeiros 40:\n`);

    for (const id of ids.slice(0, 40)) {
      const inUse = [
        env.LLM_MODEL_CHEAP,
        env.LLM_MODEL_SMART,
        env.LLM_MODEL_PRIVATE,
      ].includes(id)
        ? ' <- em uso'
        : '';
      console.log(`    ${id}${inUse}`);
    }

    for (const [label, model] of [
      ['LLM_MODEL_CHEAP', env.LLM_MODEL_CHEAP],
      ['LLM_MODEL_SMART', env.LLM_MODEL_SMART],
      ['LLM_MODEL_PRIVATE', env.LLM_MODEL_PRIVATE],
    ] as const) {
      if (model !== undefined && !ids.includes(model)) {
        console.log(
          `\n  ${WARN}  ${label}="${model}" não aparece na lista do gateway. ` +
            'Copie um nome exatamente como está acima.',
        );
      }
    }
  } catch (error) {
    console.log(
      `  ${WARN}  Não foi possível listar (${describe(error)}). ` +
        'Alguns gateways não expõem /models — siga para o teste.',
    );
  }
}

/** Faz uma geração real e mínima, para provar que o caminho inteiro funciona. */
async function testModel(
  tier: ModelTier,
  model: string,
  baseUrl: string,
  apiKey: string,
): Promise<boolean> {
  const provider = new OpenAICompatibleLLMProvider({
    baseUrl,
    apiKey: apiKey || 'local',
    cheapModel: env.LLM_MODEL_CHEAP,
    smartModel: env.LLM_MODEL_SMART,
    privateModel: env.LLM_MODEL_PRIVATE,
    jsonMode: env.LLM_JSON_MODE,
    defaultTimeoutMs: 45_000,
    label: 'gateway',
  });

  const startedAt = Date.now();

  try {
    const result = await provider.completeJSON({
      prompt:
        'Responda apenas com este JSON, sem nenhum texto em volta: ' +
        '{"ok": true, "idioma": "pt-BR"}',
      parse: (raw) => {
        const value = raw as { ok?: unknown };

        if (value.ok !== true) {
          throw new Error('o modelo não devolveu o JSON pedido');
        }

        return value;
      },
      tier,
      maxOutputTokens: 100,
      temperature: 0,
    });

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    const tokens = (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0);

    console.log(
      `  ${CHECK}  ${tier.padEnd(7)} "${model}" respondeu em ${elapsed}s ` +
        `(${tokens} tokens, modelo usado: ${result.model})`,
    );

    if (result.model !== model) {
      console.log(
        `       ${WARN}  o gateway roteou para outro modelo — normal com ` +
          'estratégia automática, mas confira se é o que você quer.',
      );
    }

    return true;
  } catch (error) {
    console.log(`  ${CROSS}  ${tier.padEnd(7)} "${model}" falhou: ${describe(error)}`);
    console.log(`       ${sugestao(error)}`);

    return false;
  }
}

/** Traduz a falha para a próxima ação, não para um código de erro. */
function sugestao(error: unknown): string {
  const message = describe(error).toLowerCase();

  if (message.includes('fetch failed') || message.includes('econnrefused')) {
    return 'O gateway não está no ar. Rode `omniroute` e tente de novo.';
  }

  if (message.includes('llm_api_key') || message.includes('401')) {
    return 'Chave recusada. Gere outra no painel (Endpoints) e atualize LLM_API_KEY.';
  }

  if (message.includes('llm_model') || message.includes('not found')) {
    return 'Nome de modelo inválido. Use um da lista acima.';
  }

  if (message.includes('limite') || message.includes('rate')) {
    return 'Cota do provedor gratuito esgotada. Configure um fallback no painel.';
  }

  if (message.includes('tempo esgotado')) {
    return 'O provedor demorou demais. Troque por outro ou aumente o tempo limite.';
  }

  return 'Confira o painel do gateway e o provedor conectado.';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error: unknown) => {
  console.error(`\n${CROSS}  Falha inesperada:`, describe(error), '\n');
  process.exitCode = 1;
});
