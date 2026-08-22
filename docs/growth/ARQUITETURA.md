# Growth Engine — arquitetura de um sistema autônomo de marketing e vendas

Documento de arquitetura do módulo **Growth Engine**: uma "empresa digital"
operada por agentes de IA que pesquisa mercado, cria conteúdo, publica em
Instagram/Facebook, conversa com quem interage, qualifica leads, vende e
aprende com o resultado.

Este documento é a **etapa 1 do processo** pedido: analisar, propor
arquitetura, comparar tecnologias, definir fluxo de dados e banco, delimitar o
MVP e dividir em fases. O código das fases já implementadas vive em
`src/server/growth/`.

---

## 1. Leitura do problema

O pedido descreve dezesseis capacidades, mas elas não têm o mesmo peso técnico.
Agrupando por natureza:

| Grupo | Capacidades | Natureza técnica | Risco |
|---|---|---|---|
| **Geração** | 1–4 (pesquisa, estratégia, conteúdo, vídeo) | Chamadas de LLM com saída estruturada | Baixo — falha custa uma retentativa |
| **Distribuição** | 5 (publicar) | Integração com API oficial, fila, agendamento | **Alto** — ação pública e irreversível |
| **Captação** | 6–8 (monitorar, identificar, iniciar conversa) | Webhooks + regras de plataforma | **Alto** — limites rígidos da Meta |
| **Conversão** | 9–14 (conversar, qualificar, vender, follow-up) | LLM com memória + máquina de estados + políticas | **Alto** — fala com pessoa real em nome da marca |
| **Memória** | 15 (CRM) | Banco relacional | Baixo |
| **Aprendizado** | 16 (otimizar) | Agregação de métricas + realimentação | Baixo |

Três conclusões que orientam toda a arquitetura:

1. **O gargalo não é a IA, é a integração.** Gerar um roteiro é uma chamada de
   API. Publicar esse roteiro como Reels exige conta profissional, App Review
   da Meta, token de página de longa duração e respeito a limite de publicações
   por dia. O sistema precisa ser desenhado em torno das restrições da
   plataforma, não do modelo.
2. **Toda ação externa é irreversível.** Um post publicado e uma DM enviada não
   voltam atrás. Isso obriga a separar **decidir** de **executar**, com um
   ponto de aprovação no meio — que é exatamente o que os três modos de
   operação pedidos implementam.
3. **O sistema é assíncrono por natureza.** Um lead responde três horas depois;
   um post é agendado para terça; um follow-up acontece em 48h. Nada disso cabe
   no ciclo de vida de uma requisição HTTP. **Fila e agendador não são
   otimização, são requisito funcional.**

### 1.1 O que as plataformas permitem — e o que não permitem

Esta seção existe porque metade dos projetos desse tipo morre aqui. As regras
abaixo valem para as APIs oficiais da Meta e **precisam ser reconfirmadas na
documentação vigente antes do go-live** (a Meta renomeia permissões e muda
limites com frequência; as versões da Graph API expiram em ~2 anos).

| Capacidade pedida | Situação na API oficial | Como o sistema trata |
|---|---|---|
| Publicar no Instagram | Permitido para conta Business/Creator vinculada a uma Página, via `POST /{ig-user-id}/media` + `/media_publish`. Há um teto de publicações por 24h (na faixa de 25) | Fila com agendamento e controle de cota |
| Publicar no Facebook | Permitido na Página via `POST /{page-id}/feed`, `/photos`, `/videos` | Mesma fila |
| Ler comentários | Permitido (`instagram_manage_comments` / `pages_read_engagement`) + webhook `comments` | Ingestão por webhook, com polling de reconciliação |
| Responder comentário | Permitido | Ação de baixo risco (configurável) |
| Responder DM | Permitido **dentro da janela de 24h** desde a última mensagem da pessoa. Fora dela, só com tag permitida (ex.: `HUMAN_AGENT`, que exige aprovação do recurso) | `MessagingPolicy` bloqueia envio fora da janela |
| DM privada a partir de um comentário | Permitido **uma única vez por comentário** (private reply), em janela curta | Modelado como ação própria, com deduplicação |
| **Iniciar DM para quem nunca falou com a marca** | **Não é permitido.** Não existe API oficial para prospecção fria por DM | O sistema **não implementa isso**. O item 8 do pedido é atendido pelo caminho legítimo: comentário → resposta pública → private reply → conversa |
| Automação por navegador/conta pessoal | Viola os Termos e leva a bloqueio da conta | Fora de escopo, sem exceção |

> **Decisão de projeto:** "iniciar conversas automaticamente" é implementado
> como **resposta automática a uma interação existente** (comentário, menção,
> mensagem, reação a story). É o máximo que a API oficial permite, e é o que a
> própria instrução do pedido determina ("dentro das permissões das
> plataformas"). Qualquer coisa além disso queima o ativo mais caro do
> projeto: a conta.

---

## 2. Arquitetura recomendada

### 2.1 Visão geral

**Monólito modular com núcleo de domínio isolado, fila persistida em Postgres e
integrações atrás de interfaces.** Roda em um processo no início; cada módulo
pode virar serviço sem reescrita, porque a fronteira já existe no código.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Painel administrativo (Next.js App Router, React Server Components)     │
│  dashboard · conteúdo/aprovações · conversas · vendas · configurações    │
└───────────────┬──────────────────────────────────────────────────────────┘
                │ mesma aplicação (sem API pública separada no MVP)
┌───────────────▼──────────────────────────────────────────────────────────┐
│  Camada de aplicação — src/server/growth/services/                       │
│  StrategyService · ContentService · PublishingService                    │
│  ConversationService · LeadService · DealService · FollowUpService       │
│  LearningService · ApprovalService                                       │
│  (única camada que conhece Prisma e HTTP ao mesmo tempo)                 │
└───┬───────────────────────────────┬──────────────────────────┬───────────┘
    │                               │                          │
┌───▼─────────────────────┐ ┌───────▼──────────────┐ ┌─────────▼───────────┐
│ NÚCLEO (core)           │ │ FILA                 │ │ INTEGRAÇÕES         │
│ agentes 1..6            │ │ growth_jobs (Postgres)│ │ LLMProvider         │
│ políticas e guardrails  │ │ worker + agendador   │ │ SocialPublisher     │
│ scoring de lead         │ │ retry + backoff      │ │ SocialMessenger     │
│ nada de Prisma/Next     │ │ dedupe + idempotência│ │ VideoProvider       │
└─────────────────────────┘ └──────────────────────┘ │ ImageProvider       │
                                                     │ (mock ⇄ real p/ env)│
┌──────────────────────────────────────────────────┐ └─────────────────────┘
│ Webhooks: /api/growth/webhooks/meta               │
│ verificação de assinatura → growth_webhook_events │──► fila
└──────────────────────────────────────────────────┘
                                │
                    ┌───────────▼────────────┐
                    │ PostgreSQL (Prisma 7)  │
                    │ CRM + conteúdo + jobs  │
                    └────────────────────────┘
```

### 2.2 Por que monólito modular, e não microsserviços

| Critério | Monólito modular | Microsserviços por agente |
|---|---|---|
| Implementação | Um deploy, um schema, transação local | 6 serviços, contratos, versionamento |
| Custo | 1 container + 1 banco (~US$ 20–40/mês) | 6 containers + broker + observabilidade |
| Manutenção | Refatorar entre módulos é um commit | Mudança de contrato = deploy coordenado |
| Escala | Vertical até dezenas de workspaces; depois extrai o worker | Escala por agente desde o dia 1 |
| Depuração | Um stack trace | Trace distribuído obrigatório |

Para um sistema com **um usuário no início** e volume de milhares (não milhões)
de eventos por dia, microsserviço é custo sem contrapartida. A regra adotada é
**"módulo hoje, serviço quando doer"**: o núcleo não importa Prisma nem Next,
então extrair o worker de conversas é mover uma pasta e trocar a chamada
direta por HTTP.

### 2.3 Comparação das decisões técnicas

**Backend / linguagem**

| Opção | Implementação | Custo | Escala | IA | Redes sociais | Veredito |
|---|---|---|---|---|---|---|
| **Next.js + TypeScript (escolhido)** | Alta — UI, API e webhooks no mesmo projeto | Baixo | Boa (worker separado depois) | SDKs oficiais em TS para todos os provedores | `fetch` direto na Graph API | ✅ Reaproveita a base já existente neste repositório |
| Python (FastAPI + LangGraph/CrewAI) | Média — precisa de frontend separado | Baixo | Boa | Ecossistema de agentes mais rico | Igual | Melhor se o projeto virasse pesquisa de agentes; aqui pagaria dois stacks |
| n8n / Make / Zapier | Muito alta no começo | Cresce rápido por execução | Ruim | Limitado a nós prontos | Bom | Ótimo protótipo, teto baixo: lógica de venda vira espaguete visual |
| NestJS + Next separados | Média | Médio | Ótima | Igual | Igual | Estrutura de empresa grande para um time de um |

**Banco de dados**

| Opção | Veredito |
|---|---|
| **PostgreSQL + Prisma (escolhido)** | CRM é relacional (contato → conversa → lead → negócio). Transação e `unique` resolvem idempotência de webhook sem infraestrutura extra. `Json` cobre o que é fluido (saída de agente, métricas) |
| MongoDB | Bom para documento de conversa, ruim para funil e relatório com junção |
| Supabase | Postgres + Auth + Storage prontos; é a evolução natural do deploy, não uma alternativa de modelagem |
| Firebase | Trava o modelo de dados e encarece consulta analítica |

**Fila e agendamento** — é aqui que a maioria erra por excesso.

| Opção | Implementação | Custo | Escala | Veredito |
|---|---|---|---|---|
| **Tabela `growth_jobs` no Postgres (escolhido no MVP)** | Alta — `SELECT ... FOR UPDATE SKIP LOCKED` | Zero | Milhares de jobs/dia | ✅ Sem infra nova, transacional com o dado |
| BullMQ + Redis | Média | ~US$ 10/mês | Centenas de milhares | Fase 2, quando o volume justificar |
| Inngest / QStash / Trigger.dev | Alta | Por evento | Ótima | Excelente em serverless puro; adiciona dependência externa |
| SQS / Temporal | Baixa | Médio | Altíssima | Só faz sentido em escala de SaaS consolidado |

**Provedores de IA** — já abstraídos por `LLMProvider` neste repositório.

| Uso | Recomendação | Motivo |
|---|---|---|
| Classificação, qualificação de lead, extração | Modelo *cheap* (ex.: Gemini Flash Lite) | Volume alto, tarefa simples; custo por conversa precisa ficar em centavos |
| Estratégia de mercado, plano de conteúdo, resposta de venda | Modelo *smart* | Poucas chamadas, impacto direto na receita |
| Imagem | Provider dedicado, atrás de `ImageProvider` | Preço e qualidade mudam rápido; trocar não pode significar refatorar |
| Vídeo | Provider dedicado, atrás de `VideoProvider` | Idem, com custo por segundo relevante |

O ponto que importa mais que a escolha do fornecedor: **`tier: 'cheap' | 'smart'`
é decisão do chamador**, e todo consumo cai em `ai_usage_logs` com tokens reais.

**Hospedagem**

| Opção | Prós | Contras |
|---|---|---|
| **Vercel + Neon/Supabase (recomendado p/ começar)** | Deploy trivial, HTTPS e domínio prontos, cron nativo | Função serverless tem teto de duração: o worker precisa de execuções curtas disparadas por cron |
| Railway / Render / Fly.io | Processo longo (worker de verdade), Postgres junto | Um pouco mais de operação manual |
| VPS + Docker Compose | Mais barato em escala, controle total | Você vira o time de infraestrutura |

Recomendação: **Vercel + Neon no início; migrar o worker para Railway/Fly
quando os jobs passarem a exigir execução contínua.** O código não muda — o
worker já é um laço que consome a tabela de jobs.

---

## 3. Fluxo de dados

### 3.1 Estratégia → conteúdo

```
Usuário informa nicho/produto
   └─► job strategy.research
        └─► Agente 1 (Estrategista de Mercado)
             prompt versionado + LLM smart → JSON validado por Zod
             └─► growth_market_strategies (persona, dores, objeções, oferta, tom)
                  └─► job content.plan
                       └─► Agente 2 (Estrategista de Conteúdo)
                            recebe: estratégia + insights de aprendizado
                            └─► growth_content_plans + growth_content_pieces
                                 status = DRAFT | PENDING_APPROVAL (pelo modo)
```

### 3.2 Conteúdo → publicação

```
ContentPiece aprovado
   └─► job media.generate  ─► Agente 3 → growth_media_assets (imagem/vídeo/narração/legenda)
        └─► job publish.schedule
             └─► PublishingService: valida cota, janela e conta conectada
                  └─► [MODO MANUAL] growth_approval_requests → humano aprova
                  └─► job publish.execute
                       └─► SocialPublisher (Meta Graph API) → growth_publications
                            └─► job metrics.collect (T+1h, T+24h, T+7d)
                                 └─► growth_content_metrics
```

### 3.3 Interação → lead → venda (o caminho da receita)

```
Comentário/DM na Meta
   └─► webhook (assinatura X-Hub-Signature-256 verificada)
        └─► growth_webhook_events (dedupe por id externo)  ← idempotência
             └─► job inbound.process
                  ├─► upsert growth_contacts + growth_conversations + growth_messages
                  ├─► Agente 5 (Qualificador): intenção, dor, urgência, estágio
                  │    └─► growth_leads (COLD | WARM | HOT | READY)
                  └─► Agente 6 (Vendedor)
                       entrada: histórico + estratégia + produtos + objeções conhecidas
                       └─► MessagingPolicy (janela 24h? opt-out? limite? horário?)
                            ├─► permitido + modo autônomo  → job message.send
                            ├─► permitido + modo manual    → aprovação humana
                            └─► bloqueado                  → tarefa para humano
                                 └─► growth_deals + growth_follow_up_tasks
```

### 3.4 Resultado → aprendizado

```
cron diário
   └─► job learning.analyze
        junta: métricas de conteúdo × leads originados × negócios ganhos
        └─► growth_learning_insights (padrão, evidência, confiança)
             └─► entra no prompt do Agente 2 no próximo plano
```

O laço se fecha aqui: **o desempenho medido vira instrução do próximo
conteúdo.** É o item 16 do pedido, e é o que diferencia o sistema de um
gerador de posts.

---

## 4. Modelo de dados

Tabelas com prefixo `growth_` (o banco é compartilhado com o módulo StayScore
já existente neste repositório). Detalhe completo em `prisma/schema.prisma`.

| Domínio | Tabelas | Papel |
|---|---|---|
| Tenant | `growth_workspaces`, `growth_workspace_members` | Multi-tenant desde o dia 1 — sem isso, virar SaaS é reescrita |
| Marca | `growth_brand_profiles`, `growth_products` | Tom de voz, proposta, guardrails, preços e links de checkout |
| Estratégia | `growth_market_strategies` | Saída do Agente 1, versionada |
| Conteúdo | `growth_content_plans`, `growth_content_pieces`, `growth_media_assets` | Calendário, peças e mídias |
| Distribuição | `growth_social_accounts`, `growth_publications`, `growth_content_metrics` | Contas conectadas, publicações e desempenho |
| CRM | `growth_contacts`, `growth_conversations`, `growth_messages`, `growth_leads`, `growth_deals` | Memória de quem falou com a marca |
| Operação | `growth_follow_up_tasks`, `growth_approval_requests`, `growth_jobs`, `growth_webhook_events` | Fila, aprovações e idempotência |
| Telemetria | `growth_agent_runs`, `growth_audit_logs`, `growth_learning_insights` | Custo por agente, rastro de ação e padrões aprendidos |

Três decisões de modelagem que merecem justificativa:

- **`Contact` é separado de `Lead`.** Quem comentou uma vez é contato; vira lead
  quando demonstra intenção. Misturar os dois enche o funil de ruído e destrói
  a taxa de conversão como métrica.
- **`Message` guarda `status` (`PENDING_APPROVAL` → `QUEUED` → `SENT`).** A
  mensagem gerada pela IA existe no banco antes de ser enviada; é isso que
  torna o modo manual possível sem duplicar código.
- **`growth_jobs` tem `dedupeKey` único.** Webhook da Meta reenvia evento; sem
  chave de deduplicação, a mesma pessoa recebe a mesma resposta duas vezes.

---

## 5. Modos de aprovação

Não é uma flag booleana: é uma **matriz ação × risco**, avaliada por
`ApprovalPolicy` antes de qualquer efeito externo.

| Ação | Risco | MANUAL | SEMIAUTOMÁTICO | AUTÔNOMO |
|---|---|---|---|---|
| Gerar estratégia / plano de conteúdo | baixo | executa | executa | executa |
| Gerar mídia (custo de API) | médio | aprova | executa | executa |
| Publicar post/Reels | alto | aprova | aprova | executa |
| Responder comentário público | médio | aprova | executa | executa |
| Enviar DM de resposta | alto | aprova | aprova | executa |
| Enviar follow-up | alto | aprova | aprova | executa |
| Enviar link de checkout | alto | aprova | aprova | executa |
| Transferir para humano | baixo | executa | executa | executa |

Regras acima do modo, que **nenhum modo desliga** (`guardrails`):

1. Nada é enviado fora da janela permitida pela plataforma.
2. Nada é enviado a quem pediu para parar (`optOut`).
3. Teto de mensagens por contato e por dia.
4. Horário silencioso configurável por workspace.
5. Teto de custo de IA por workspace/dia.
6. O agente não promete resultado, não inventa preço e não cita o que não está
   em `growth_products`.

---

## 6. Custo por usuário

Modelo de custo por workspace ativo, com volume moderado (30 posts e 500
conversas por mês):

| Item | Estimativa mensal |
|---|---|
| LLM — qualificação e vendas (modelo barato, ~2k tokens/troca) | poucos dólares |
| LLM — estratégia e plano (modelo caro, poucas chamadas) | poucos dólares |
| Imagem/vídeo | **domina o custo**; varia de centavos a dólares por peça |
| Banco + hospedagem | US$ 0–25 (planos iniciais) |

Por isso o sistema **mede antes de otimizar**: `growth_agent_runs` e
`ai_usage_logs` registram tokens reais por agente. O custo em dólar só aparece
quando `MODEL_PRICING_JSON` estiver configurado com a tabela oficial do
fornecedor — o sistema nunca inventa um preço. Controles disponíveis: `tier`
por tarefa, cache por versão de prompt, teto diário por workspace e geração de
vídeo sob demanda em vez de para todo o calendário.

---

## 7. Confiabilidade e segurança

| Preocupação | Tratamento |
|---|---|
| Erro transitório | `withRetry` com backoff e jitter; só erro marcado `retryable` |
| Job envenenado | `attempts` / `maxAttempts` → status `DEAD`, visível no painel |
| Webhook duplicado | `growth_webhook_events.externalId` único + `dedupeKey` no job |
| Webhook forjado | HMAC SHA-256 (`X-Hub-Signature-256`) com comparação em tempo constante |
| Token vazado | Token nunca em texto claro no código; referência por env/secret, com data de expiração no banco |
| Ação indevida do agente | `growth_audit_logs` registra ator, ação, alvo e modo vigente |
| Dado pessoal (LGPD) | Base legal por interação, `optOut` respeitado, exclusão a pedido, retenção configurável |
| Observabilidade | Log JSON estruturado com `workspaceId`/`jobId`; painel mostra fila, falhas e custo |

---

## 8. MVP e fases

**MVP (o menor sistema que fecha o laço completo):** um workspace, um produto,
uma conta do Instagram conectada; o Agente 1 gera a estratégia, o Agente 2 gera
o calendário, o humano aprova, o post vai ao ar, o comentário chega por
webhook, o Agente 5 qualifica, o Agente 6 responde com aprovação humana, o
lead vira negócio e o painel mostra tudo. **Modo MANUAL como padrão.**

| Fase | Entrega | Estado |
|---|---|---|
| **0** | Arquitetura, comparações, fluxo de dados, modelo de banco (este documento) | ✅ |
| **1** | Schema Prisma, migration, seed, multi-tenant, fila `growth_jobs`, políticas e guardrails | ✅ |
| **2** | Agente 1 (mercado) e Agente 2 (conteúdo), prompts versionados, saída validada | ✅ |
| **3** | Agente 3 (roteiro → imagem/vídeo/narração), providers de mídia com mock | ✅ |
| **4** | Agente 4: publicação Meta, fila, agendamento, cota, métricas | ✅ |
| **5** | Webhooks, Agente 5 (qualificação), Agente 6 (vendas), CRM, follow-up | ✅ |
| **6** | Aprendizado com resultados e realimentação do Agente 2 | ✅ |
| **7** | Painel administrativo completo | ✅ |
| **8** | Produção: App Review da Meta, tokens de longa duração, worker dedicado, cron | ⏳ operação |
| **9** | SaaS: billing, onboarding self-service, limites por plano, isolamento por tenant | ⏳ futuro |

As fases 8 e 9 dependem de decisões que não são de código: aprovação da Meta,
conta de negócios verificada e modelo comercial.

---

## 9. O que este sistema deliberadamente não faz

Listado para não gerar expectativa falsa:

- **Não faz prospecção fria por DM.** Não existe API oficial para isso.
- **Não automatiza conta pessoal por navegador.** Viola os Termos.
- **Não publica sem conta profissional aprovada.** Sem App Review da Meta, o
  publicador roda em modo mock e o conteúdo fica pronto para publicação manual.
- **Não garante resultado de venda.** O agente é instruído a nunca prometer
  resultado — isso é guardrail de produto, não timidez.
- **Não inventa preço, prazo ou característica.** O Agente 6 só afirma o que
  está em `growth_products`; fora disso, transfere para humano.
