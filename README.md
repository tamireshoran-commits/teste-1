# StayScore

Análise de competitividade para imóveis de aluguel por temporada. O produto
recebe dados de um anúncio (Airbnb, Booking.com) e a exportação de pricing do
PriceLabs, e devolve scores, diagnóstico e recomendações priorizadas por
impacto.

> **Estado atual: Etapas 0 a 3 concluídas.** Pricing e análise de fotos estão
> funcionais de ponta a ponta. Anúncios e recomendações têm os contratos
> prontos, mas ainda não têm implementação — ver [Roadmap](#roadmap).

---

## Stack

| Camada | Escolha |
|---|---|
| Frontend + API | Next.js 16 (App Router), React 19, TypeScript |
| Estilo | Tailwind CSS 4 |
| Banco | PostgreSQL 16 + Prisma 7 (driver adapter `@prisma/adapter-pg`) |
| Autenticação | Auth.js v5 (credenciais, sessão JWT) |
| Testes | Vitest |

## Como rodar

```bash
# 1. Dependências
npm install

# 2. Ambiente
cp .env.example .env
# gere um AUTH_SECRET:  openssl rand -base64 32

# 3. Banco (Docker) + schema
npm run db:up
npm run db:migrate
npm run db:seed

# 4. Aplicação
npm run dev
```

O seed cria a configuração de scoring `v1` e, fora de produção, o usuário
`dev@stayscore.local` / `stayscore123`.

### Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm test` | Testes unitários (Vitest) |
| `npm run test:live` | Testes de integração — banco real e APIs externas |
| `npm run typecheck` | `prisma generate` + `tsc --noEmit` |
| `npm run build` | Build de produção |
| `npm run db:migrate` | Cria e aplica migrations |
| `npm run db:seed` | Popula configuração de scoring e usuário dev |
| `npm run db:studio` | Prisma Studio |

---

## Arquitetura

O princípio central é **baixo acoplamento por interfaces**: nenhuma regra de
negócio conhece um fornecedor concreto.

```
src/
├── app/                          # UI + rotas de API (Next.js)
├── server/
│   ├── config/env.ts             # validação de ambiente (Zod)
│   ├── auth/                     # Auth.js
│   ├── db/                       # Prisma
│   └── core/                     # DOMÍNIO — não importa nada do Next.js
│       ├── types/                # DTOs (independentes do Prisma)
│       ├── providers/            # interfaces + implementações trocáveis
│       │   ├── listing/          # AirbnbDataProvider, BookingDataProvider
│       │   ├── pricing/          # PricingDataProvider, CSVPriceLabsProvider
│       │   ├── ai/               # VisionProvider, LLMProvider
│       │   ├── storage/          # StorageProvider
│       │   └── registry.ts       # única fábrica: resolve provider por env
│       ├── analysis/
│       │   ├── pricing/          # métricas, findings, PricingAnalysisService
│       │   └── scoring/          # pesos configuráveis + buildScore
│       ├── prompts/registry.ts   # carrega prompts versionados
│       └── shared/               # retry, errors, logger, cost, cache, math
├── prompts/<função>/<versão>.md  # prompts versionados, fora do código
└── tests/                        # Vitest
```

Como `server/core/` não depende do framework, extrair a análise para um worker
separado depois é um recorte mecânico, não uma reescrita.

### Decisões que sustentam o produto

**Dado ausente nunca vira zero.** Um campo que o CSV não trouxe fica `null` e a
métrica é marcada `available: false`. No score, o peso do componente
indisponível é redistribuído entre os demais — o usuário não é punido por um
dado que ele não tem, e o relatório diz o que ficou de fora.

**Nada de promessa financeira.** Toda oportunidade carrega um campo `framing`
restrito a `oportunidade potencial`, `recomendação`, `estimativa` ou
`hipótese`. Há teste garantindo isso, e os prompts repetem a regra.

**Toda recomendação tem evidência.** O campo `evidence` aponta a métrica que a
originou. Recomendação sem lastro não é gerada.

**O score mora no backend.** Pesos e limiares vivem em
`analysis/scoring/config.ts`, versionados na tabela `score_configs`. O frontend
apenas exibe.

---

## O que está mockado, e por quê

| Componente | Hoje | Para trocar depois |
|---|---|---|
| **Airbnb** | Sem implementação; contrato pronto | `RealAirbnbProvider` + `AIRBNB_PROVIDER` |
| **Booking.com** | Sem implementação; contrato pronto | `RealBookingProvider` + `BOOKING_PROVIDER` |
| **PriceLabs API** | `PriceLabsAPIProvider` lança `ProviderUnavailableError` | Implementar `load()` + `PRICING_PROVIDER=PRICELABS_API` |
| **Visão (fotos)** | ✅ `GeminiVisionProvider` real; `MockVisionProvider` como fallback | Adaptadores Claude/OpenAI via `VISION_PROVIDER` |
| **LLM (texto)** | Contrato pronto, sem implementação | Etapa 5 |
| **Storage** | ✅ `LocalStorageProvider` (disco) | `LOCAL` → `S3` via env |
| **Concorrentes** | Coluna `isMock` no banco obriga rótulo na UI | Entrada manual ou fonte licenciada |

### Sobre scraping

Este projeto **não faz scraping** de Airbnb ou Booking.com — os Termos de
Serviço das duas plataformas proíbem coleta automatizada. Os dados de anúncio
virão de entrada manual do próprio usuário ou de fonte oficial/parceria.
Detalhes em [`src/server/core/providers/listing/README.md`](src/server/core/providers/listing/README.md).

### Sobre credenciais

Nenhuma credencial no código. Tudo passa por `.env` e é validado no boot por
`src/server/config/env.ts`, que falha com mensagem clara se faltar algo.

A chave do Gemini precisa ser uma **API key da Generative Language API**
(as do Google AI Studio, prefixo `AIza`). Tokens OAuth do Google Cloud, mesmo
rotulados como "chave de API" no console, são recusados com
`ACCESS_TOKEN_TYPE_UNSUPPORTED`.

Sem `GEMINI_API_KEY`, o registry cai para o `MockVisionProvider` com um aviso
no log — a aplicação continua funcionando, e o resultado vem marcado
`provider: "mock"` para a interface poder rotular como simulado.

---

## Módulo de fotos (Etapa 3)

### Fluxo

1. **Validação** (`imageValidation.ts`) — formato conferido pelos *magic bytes*,
   não pela extensão nem pelo `Content-Type`, que o cliente controla. Calcula o
   sha256 usado como chave de cache.
2. **Análise** (`ImageAnalysisService`) — uma chamada de IA por imagem, com
   paralelismo limitado (padrão 3).
3. **Score** (`photoScore.ts` + `insights.ts`) — determinístico, sem IA.

### Garantias

| Garantia | Como |
|---|---|
| Falha isolada | A falha de uma foto vira `PhotoAnalysisFailure`; o lote continua. Nenhuma exceção individual escapa do serviço |
| Retry seletivo | Só erros `retryable` (429, 5xx, timeout) são retentados, com backoff exponencial. Imagem inválida falha na hora, sem gastar crédito |
| Cache | Chave = sha256 + modelo + versão do prompt. Reenviar o mesmo álbum só cobra pelas fotos novas |
| Orçamento | Ao atingir o teto, as fotos restantes falham com `BUDGET_EXCEEDED` em vez de estourar a conta |
| Progresso | `onProgress` reporta "7/24" a cada foto, inclusive nas que falharam |

### Custo

`AIUsageLog` registra **tokens reais** de toda chamada, inclusive as que
falharam — uma tentativa que consumiu entrada antes do timeout custou dinheiro,
e omiti-la subestimaria o gasto.

O **custo em dólar só é estimado se você configurar os preços** em
`MODEL_PRICING_JSON`. Sem isso, o sistema reporta "custo desconhecido" em vez de
exibir um número inventado: preços de fornecedor mudam e variam por região, e um
valor chutado pareceria verdade no relatório do cliente.

---

## Módulo de pricing (Etapa 2)

### Importação de CSV

O `CSVPriceLabsProvider` é tolerante na entrada e rígido na saída. Ele lida com:

- delimitador `,`, `;`, tab ou `|`, detectado automaticamente;
- BOM UTF-8, CRLF, aspas escapadas e quebra de linha dentro de campo;
- decimal brasileiro (`1.234,56`) e americano (`1,234.56`) no mesmo parser;
- moeda (`R$ 250,00`), percentual (`85%`) e negativo contábil (`(12,50)`);
- headers em português ou inglês, em qualquer ordem, por mapa de aliases;
- ambiguidade de data (`03/04/2026`) resolvida uma vez para o arquivo inteiro,
  procurando um dia acima de 12 na coluna.

Nada disso adivinha: valor ambíguo vira `null` mais um aviso em
`dataset.warnings`, e o mapeamento de colunas acompanha o resultado para
auditoria.

### Métricas calculadas

ADR, RevPAR, ocupação, receita, preço médio e mediano, preço por dia da semana,
prêmio de fim de semana, desvio frente ao preço recomendado, piso e teto,
lead time por janela de antecedência, sazonalidade mensal, gaps e **orphan
gaps** (buracos menores que a estadia mínima), impacto de eventos, descontos.

Tudo determinístico — **nenhuma chamada de IA**, logo custo zero e resultado
reproduzível. A IA entra depois só para interpretar o que já foi calculado.

### Pricing Score

Sete componentes ponderados, cada um devolvendo nota **e a razão em texto**:
aderência ao recomendado (25), diferenciação por dia da semana (15), saúde da
ocupação (20), disciplina de piso/teto (10), gestão de gaps (10), disciplina de
descontos (10) e completude dos dados (10).

---

## Testes

227 testes unitários, mais uma suíte de integração que roda contra
serviços reais:

```bash
npm test        # unitários, sem rede
npm run test:live   # banco real + APIs externas (pula o que não tem credencial)
```

| Arquivo | Cobre |
|---|---|
| `tests/pricing/coerce.test.ts` | Conversão de números, moeda, percentual, booleanos |
| `tests/pricing/tokenizer.test.ts` | Tokenizador CSV (RFC 4180) |
| `tests/pricing/dates.test.ts` | Ambiguidade DMY/MDY, datas inválidas, bissexto |
| `tests/pricing/columnMap.test.ts` | Mapeamento de colunas por alias |
| `tests/pricing/CSVPriceLabsProvider.test.ts` | Import completo, robustez e erros |
| `tests/pricing/metrics.test.ts` | ADR, RevPAR, ocupação, gaps órfãos, eventos |
| `tests/pricing/pricingScore.test.ts` | Score, redistribuição de peso, linguagem de hipótese |
| `tests/scoring/buildScore.test.ts` | Média ponderada e componentes indisponíveis |
| `tests/prompts/registry.test.ts` | Interpolação e regras obrigatórias dos prompts |
| `tests/shared/retry.test.ts` | Backoff exponencial, rate limit, timeout |
| `tests/photos/imageValidation.test.ts` | Magic bytes, limite de tamanho, extensão enganosa |
| `tests/photos/GeminiVisionProvider.test.ts` | Tradução de erros da API, parsing tolerante do JSON |
| `tests/photos/ImageAnalysisService.test.ts` | Falha isolada, retry, cache, custo, progresso, paralelismo |
| `tests/photos/photoScore.test.ts` | Photo Score, melhor/pior foto, redundância, cobertura |
| `tests/integration/persistence.live.test.ts` | `AICache` e `AIUsageLog` contra Postgres real |
| `tests/integration/geminiVision.live.test.ts` | Chamada real ao Gemini (pulada sem chave) |

---

## Roadmap

| Etapa | Escopo | Estado |
|---|---|---|
| 0 | Fundação: banco, auth, CI, testes | ✅ |
| 1 | Contratos de domínio e prompts versionados | ✅ |
| 2 | Pricing: CSV do PriceLabs, métricas e score | ✅ |
| 3 | Fotos: validação, `GeminiVisionProvider`, cache, custo, Photo Score | ✅ |
| 4 | Airbnb e Booking: entrada manual e mock, scores | ⏳ |
| 5 | `RecommendationEngine` e Overall Score | ⏳ |
| 6 | Dashboard com 🔴 / 🟡 / 🟢 | ⏳ |
| 7 | Relatório completo (PDF depois) | ⏳ |
| 8 | `CompetitorAnalysisService` (mock rotulado) | ⏳ |

O pipeline por etapas com retry granular (`AnalysisStep`) já existe no schema
e passa a ser exercitado quando a UI de análise entrar, na Etapa 6.
