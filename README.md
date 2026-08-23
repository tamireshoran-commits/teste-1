# StayScore

Análise de competitividade para imóveis de aluguel por temporada. O produto
recebe dados de um anúncio (Airbnb, Booking.com) e a exportação de pricing do
PriceLabs, e devolve scores, diagnóstico e recomendações priorizadas por
impacto.

> **Estado atual: Etapas 0 a 4 concluídas.** Pricing, fotos e anúncios
> (Airbnb/Booking) estão funcionais de ponta a ponta. Faltam o motor de
> recomendações, o dashboard e o relatório — ver [Roadmap](#roadmap).

### Dois módulos neste repositório

| Módulo | O que faz | Onde |
|---|---|---|
| **StayScore** | Análise de competitividade de anúncios de temporada | `src/server/core/`, `/analises` |
| **Growth Engine** | Marketing e vendas por agentes de IA (Instagram/Facebook) | `src/server/growth/`, `/growth` |

Compartilham banco, autenticação, fila de conceitos (providers, prompts
versionados, custo de IA) e infraestrutura de testes; o domínio de cada um é
independente. Ver [Growth Engine](#growth-engine--marketing-e-vendas-por-agentes)
e o [documento de arquitetura](docs/growth/ARQUITETURA.md).

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
| `npm run growth:gateway` | Confere a conexão com o gateway de IA (modelos, chave, latência) |

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
| **Airbnb** | ✅ Entrada manual validada + mock rotulado | `RealAirbnbProvider` (stub pronto) quando houver acesso oficial |
| **Booking.com** | ✅ Entrada manual validada + mock rotulado | `RealBookingProvider` (stub pronto) quando houver parceria |
| **PriceLabs API** | `PriceLabsAPIProvider` lança `ProviderUnavailableError` | Implementar `load()` + `PRICING_PROVIDER=PRICELABS_API` |
| **Visão (fotos)** | ✅ `GeminiVisionProvider` real; `MockVisionProvider` como fallback | Adaptadores Claude/OpenAI via `VISION_PROVIDER` |
| **LLM (texto)** | ✅ `GeminiLLMProvider` real; `MockLLMProvider` sem improviso | Adaptadores Claude/OpenAI via `LLM_PROVIDER` |
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

Sem `GEMINI_API_KEY`, o registry cai para o `MockVisionProvider` com um aviso
no log — a aplicação continua funcionando, e o resultado vem marcado
`provider: "mock"` para a interface poder rotular como simulado.

### Escolha do modelo

O Google **retira modelos antigos do acesso de contas novas**. O
`gemini-2.5-flash` já responde `404 — no longer available to new users` para
elas, mesmo continuando a aparecer em `GET /v1beta/models`. Liste o que a sua
chave realmente acessa antes de fixar `VISION_MODEL`:

```bash
curl -s "https://generativelanguage.googleapis.com/v1beta/models" \
  -H "x-goog-api-key: $GEMINI_API_KEY" | grep '"name"'
```

O provider trata esse 404 como erro de configuração **não retentável**, com
mensagem apontando para `VISION_MODEL` — retentar não faz o modelo voltar.

Os aliases (`gemini-flash-lite-latest`) nunca expiram, mas o modelo por trás
muda sem aviso, e notas de análises antigas deixam de ser comparáveis com as
novas. Por isso o padrão é uma versão fixa.

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

## Módulo de anúncios (Etapa 4)

### Origem dos dados

Sem scraping. O dono informa os dados do próprio anúncio num formulário
validado (`listingSchema.ts`), e o mock existe só para desenvolver a interface.
`RealAirbnbProvider` e `RealBookingProvider` existem como contrato e declaram
indisponibilidade — quando houver acesso oficial, é implementar `fetchListing`.

O mock é **deliberadamente imperfeito** (descrição curta, poucas fotos,
política rígida): um mock perfeito daria score alto e esconderia bugs no
diagnóstico. Tudo que ele devolve vem com `isMock: true` e textos prefixados
com `[EXEMPLO]`.

### Duas camadas de análise

1. **Regras determinísticas** (`checks.ts`) — sempre rodam, custo zero,
   resultado reproduzível: tamanho de título, cobertura de comodidades, campos
   ausentes, rigidez de política, volume de avaliações.
2. **Leitura qualitativa por IA** — julga o que regra não alcança:
   posicionamento, diferenciais, coerência entre título e descrição, tom.

A camada 2 é **best-effort**. Se a IA falhar, ficar indisponível ou responder
fora do contrato, a análise entrega a camada 1 e registra o motivo — um
diagnóstico parcial vale mais que erro na tela.

O prompt recebe o que as regras já detectaram e é instruído a não repetir.
Sem isso, o modelo reescrevia os mesmos achados com outras palavras: numa
verificação real foram 12 problemas para 7 questões distintas.

### Escalas de nota

Airbnb usa 0–5 e Booking 0–10. O schema valida cada plataforma na sua escala
(4,8 é válido no Airbnb, 8,4 não é) e o score normaliza para 0–100 internamente.

A reputação usa encolhimento em direção à média: nota 5,0 com 2 avaliações não
vale o mesmo que 4,8 com 300, e o peso cresce até 30 avaliações.

### O eixo de competitividade

Mede desvio das boas práticas publicadas pelas plataformas, **não** comparação
com concorrentes reais — não temos dados deles, e inventá-los seria ficção. A
razão exibida diz isso explicitamente.

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

316 testes unitários, mais uma suíte de integração que roda contra
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
| `tests/integration/geminiVision.live.test.ts` | Chamada real ao Gemini: contrato, tokens, cache e score (pulada sem chave) |
| `tests/listing/listingSchema.test.ts` | Validação da entrada manual, escala de nota por plataforma, URLs |
| `tests/listing/providers.test.ts` | Providers manual, mock rotulado e stubs de integração real |
| `tests/listing/checks.test.ts` | Regras determinísticas de título, comodidades, políticas e reputação |
| `tests/listing/ListingAnalysisService.test.ts` | Airbnb/Booking Score, fallback sem IA, cache, deduplicação |
| `tests/integration/geminiListing.live.test.ts` | Leitura qualitativa real do anúncio (pulada sem chave) |

---

## Roadmap

| Etapa | Escopo | Estado |
|---|---|---|
| 0 | Fundação: banco, auth, CI, testes | ✅ |
| 1 | Contratos de domínio e prompts versionados | ✅ |
| 2 | Pricing: CSV do PriceLabs, métricas e score | ✅ |
| 3 | Fotos: validação, `GeminiVisionProvider`, cache, custo, Photo Score | ✅ |
| 4 | Airbnb e Booking: entrada manual, mock, scores e leitura por IA | ✅ |
| 5 | `RecommendationEngine` e Overall Score | ⏳ |
| 6 | Dashboard com 🔴 / 🟡 / 🟢 | ⏳ |
| 7 | Relatório completo (PDF depois) | ⏳ |
| 8 | `CompetitorAnalysisService` (mock rotulado) | ⏳ |

O pipeline por etapas com retry granular (`AnalysisStep`) já existe no schema
e passa a ser exercitado quando a UI de análise entrar, na Etapa 6.


---

## Growth Engine — marketing e vendas por agentes

Sistema autônomo que pesquisa mercado, cria conteúdo, publica no
Instagram/Facebook, conversa com quem interage, qualifica leads, vende e
aprende com o resultado. A arquitetura completa, com comparação de
tecnologias, fluxo de dados e fases, está em
[`docs/growth/ARQUITETURA.md`](docs/growth/ARQUITETURA.md).

### Os seis agentes

| Agente | Responsabilidade | Modelo | Saída |
|---|---|---|---|
| 1 · Estrategista de Mercado | Persona, dores, desejos, objeções, concorrentes, oferta | caro | `growth_market_strategies` |
| 2 · Estrategista de Conteúdo | Calendário, pilares, ganchos, roteiros, CTAs | caro | `growth_content_pieces` |
| 3 · Criador de Vídeos | Briefing cena a cena, narração, legendas, thumbnail | barato | `growth_media_assets` |
| 4 · Gerenciador de Redes | Fila de publicação, agendamento, cota, métricas | — | `growth_publications` |
| 5 · Qualificador de Leads | Intenção, dor, urgência, temperatura (frio → pronto) | barato | `growth_leads` |
| 6 · Vendedor por IA | Conversa, objeções, checkout, follow-up | caro | `growth_messages` |

Um sétimo módulo (aprendizado) fecha o laço: métricas → padrões →
instrução para o Agente 2 no próximo calendário.

### Como rodar sem nenhuma credencial

```bash
npm run db:migrate && npm run db:seed
npm run dev
# abra /growth  (login: dev@stayscore.local / stayscore123)
```

Com os padrões do `.env.example`, **nada sai para a internet**: o modelo, as
redes sociais e a geração de mídia são simulados, e todo resultado vem
marcado como `[EXEMPLO]` / `isMock: true`. O ciclo completo é exercitável:

1. **Configurações** → cadastre marca, produto e conecte uma conta simulada;
2. **Configurações → Estratégia** → rode o estrategista de mercado;
3. **Painel → Processar fila agora** → o worker executa os jobs;
4. **Conteúdo** → gere o calendário, aprove uma peça;
5. **Processar fila** → mídia gerada, publicação criada, aprovada e publicada;
6. **Configurações → Simular interação** → chega uma "mensagem";
7. **Processar fila** → lead qualificado e resposta redigida;
8. **Conteúdo → Aprovações** → aprove o envio;
9. **Vendas** → funil, follow-up agendado e aprendizado.

### Rodar com IA de verdade sem pagar por token

O sistema fala com qualquer endpoint no dialeto `/v1/chat/completions`, então
dá para apontá-lo para um gateway que roteia entre fornecedores — incluindo os
de camada gratuita. Com o [OmniRoute](https://omniroute.online/) na máquina:

```bash
npm install -g omniroute && omniroute      # sobe em http://localhost:20128
```

```bash
LLM_PROVIDER="OPENAI_COMPATIBLE"
LLM_BASE_URL="http://localhost:20128/v1"
LLM_API_KEY="<chave gerada no painel do OmniRoute>"
LLM_MODEL_CHEAP="<modelo gratuito>"        # classificação e roteiro de vídeo
LLM_MODEL_SMART="<modelo melhor>"          # estratégia e calendário
LLM_MODEL_PRIVATE="<modelo de confiança>"  # tudo que lê conversa de cliente
IMAGE_PROVIDER="OPENAI_COMPATIBLE"         # /v1/images/generations do mesmo gateway
```

Os três níveis existem por razões diferentes. `cheap` e `smart` separam custo
de capacidade; **`private` separa por privacidade**, e é o que torna seguro
usar fornecedor gratuito no resto:

| Agente | Nível | Lê conversa de cliente? |
|---|---|---|
| Estrategista de mercado | `smart` | não |
| Estrategista de conteúdo | `smart` | não |
| Criador de vídeos | `cheap` | não |
| Módulo de aprendizado | `smart` | não (só métricas agregadas) |
| **Qualificador de leads** | `private` | **sim** |
| **Vendedor** | `private` | **sim** |
| **Follow-up** | `private` | **sim** |

`LLM_MODEL_PRIVATE` vazio cai no `smart`, nunca no `cheap`: o padrão de
fallback é o mais protegido, não o mais barato.

Vale para OpenRouter, Groq, Together, LM Studio e Ollama também — muda a URL e
o nome do modelo, mais nada.

Antes de mandar conversa de cliente por lá, confira a configuração:

```bash
npm run growth:gateway
```

O comando lista os modelos que o **seu** gateway conhece, avisa se o nome
configurado não está entre eles e faz uma geração real em cada nível (`cheap`
e `smart`), medindo tempo e tokens. Nome de modelo errado é o erro mais comum
dessa configuração, e sem isso ele só aparece quando um cliente escreve.

Três coisas a considerar antes de mandar conversa de cliente por lá:

- **Privacidade.** Boa parte dos serviços gratuitos treina com o que recebe.
  Conversa de cliente é dado pessoal, e a LGPD se aplica a você, não ao
  fornecedor. É para isso que serve `LLM_MODEL_PRIVATE`: os três agentes que
  leem mensagem de gente real passam por ele, e só por ele.
- **Limite de uso.** Camada gratuita esbarra em cota. O `fallback` do gateway
  cobre parte disso, e a fila daqui retenta com backoff — na prática, uma cota
  estourada atrasa uma resposta em vez de perder o lead.
- **O gateway precisa morar em algum lugar.** Ele é local por natureza; uma
  aplicação hospedada em serverless não alcança o `localhost` da sua máquina.
  Ou tudo roda no mesmo servidor, ou o gateway fica em uma máquina que a
  aplicação enxergue — nunca exposto à internet aberta.

### Modos de operação

| Ação | Risco | Manual | Semiautomático | Autônomo |
|---|---|---|---|---|
| Gerar estratégia/conteúdo | baixo | executa | executa | executa |
| Gerar mídia (custo de API) | médio | aprova | executa | executa |
| Responder comentário | médio | aprova | executa | executa |
| Publicar | alto | aprova | aprova | executa |
| Enviar DM / follow-up / checkout | alto | aprova | aprova | executa |

O padrão é **manual**. Modo nenhum desliga os guardrails: janela de resposta
da plataforma, opt-out, limite de mensagens por contato, horário silencioso,
cota diária de publicações e a checagem de texto (nada de promessa de
resultado, preço inventado ou link não cadastrado).

### O que o sistema deliberadamente não faz

- **Não inicia DM com quem nunca falou com a conta.** Não existe API oficial
  para prospecção fria; a alternativa seria automação de navegador, que viola
  os Termos e custa a conta. O caminho implementado é o legítimo: comentário →
  resposta → conversa.
- **Não responde fora da janela de 24h.** Passado esse prazo, a conversa vai
  para atendimento humano em vez de tentar burlar a regra.
- **Não publica sem conta aprovada.** Sem App Review da Meta, o publicador
  roda simulado e o conteúdo fica pronto para publicação manual.
- **Não promete resultado, não inventa preço nem link.** É guardrail
  determinístico depois do modelo, não instrução de prompt.

### Fila e worker

Jobs ficam em `growth_jobs` (Postgres, `FOR UPDATE SKIP LOCKED`) com retry,
backoff exponencial, deduplicação e recuperação de job travado. Um ciclo:

```bash
curl -X POST localhost:3000/api/growth/worker/tick -H "x-cron-secret: $CRON_SECRET"
```

Em produção, aponte um cron (Vercel Cron, GitHub Actions, systemd timer) para
esse endpoint a cada minuto, ou rode `runGrowthWorkerTick()` em laço num
processo dedicado.

### Integração real com a Meta

Para sair do modo simulado é preciso, **fora do código**: conta Instagram
Business vinculada a uma Página, app com App Review aprovado (publicação,
comentários e mensagens são permissões distintas) e token de longa duração.
Depois:

```bash
SOCIAL_PROVIDER="META"
META_APP_SECRET="..."        # valida a assinatura do webhook
META_VERIFY_TOKEN="..."      # eco na verificação do webhook
META_TOKEN_MINHA_CONTA="..." # o token em si
```

No painel, cadastre a conta informando **o nome da variável**
(`META_TOKEN_MINHA_CONTA`) no campo de token — o token nunca é gravado no
banco. Webhook: `https://SEU_DOMINIO/api/growth/webhooks/meta`.

### Testes do módulo

| Arquivo | O que garante |
|---|---|
| `tests/growth/approvalPolicy.test.ts` | A matriz ação × modo, incluindo sobrescritas |
| `tests/growth/messagingPolicy.test.ts` | Janela de 24h, opt-out, limite diário, silêncio, duplicidade |
| `tests/growth/time.test.ts` | Horário local por fuso, silêncio cruzando a meia-noite |
| `tests/growth/guardrails.test.ts` | Promessa de resultado, preço fora do catálogo, link e dado sensível |
| `tests/growth/metaWebhook.test.ts` | Assinatura HMAC e normalização de eventos (DM, comentário, feed) |
| `tests/growth/runAgent.test.ts` | Contrato de saída, cache, registro de custo e falha |
| `tests/growth/worker.test.ts` | Despacho, isolamento de falha e backoff |
| `tests/growth/learning.test.ts` | Agregação de desempenho por tema, gancho, CTA e formato |
| `tests/growth/agentsOutput.test.ts` | Score × temperatura, duração de cenas, link do catálogo |
| `tests/llm/OpenAICompatibleLLMProvider.test.ts` | Gateway: modelo por tier, json mode, limites e erros traduzidos |
| `tests/integration/growthQueue.live.test.ts` | Fila e idempotência contra Postgres real |

### Estado das fases

| Fase | Escopo | Estado |
|---|---|---|
| 0 | Arquitetura, comparações, modelo de dados | ✅ |
| 1 | Schema, fila, políticas, guardrails, multi-tenant | ✅ |
| 2 | Agentes 1 e 2 (mercado e conteúdo) | ✅ |
| 3 | Agente 3 e providers de mídia | ✅ |
| 4 | Agente 4: publicação e métricas | ✅ |
| 5 | Webhooks, agentes 5 e 6, CRM, follow-up | ✅ |
| 6 | Aprendizado e realimentação | ✅ |
| 7 | Painel administrativo | ✅ |
| 8 | Produção: App Review, tokens, worker dedicado | ⏳ operação |
| 9 | SaaS: billing, onboarding, limites por plano | ⏳ futuro |
