# Growth Engine

Marketing e vendas por agentes de IA. A arquitetura completa está em
[`docs/growth/ARQUITETURA.md`](../../../docs/growth/ARQUITETURA.md); este
arquivo descreve só as fronteiras internas do módulo.

```
growth/
├── types/        DTOs do domínio — uniões de string espelhando os enums do Prisma
├── policy/       decisões puras: aprovação, mensageria, guardrails, horário local
├── analytics/    cálculo de desempenho de conteúdo (puro, testável sem banco)
├── agents/       os seis agentes: prompt + contrato Zod + execução instrumentada
├── providers/    integrações: Meta, mídia, modelo simulado — atrás de interfaces
├── jobs/         fila em Postgres, worker e registro de handlers
├── services/     camada de aplicação: liga domínio, Prisma e HTTP
└── webhooks/     recepção e normalização dos eventos da Meta
```

## Regras de dependência

| Camada | Pode importar | Nunca importa |
|---|---|---|
| `types`, `policy`, `analytics` | nada do projeto | Prisma, Next, serviços |
| `agents` | `types`, `policy`, prompts e providers de IA do núcleo | Prisma, Next |
| `providers` | `types`, utilidades do núcleo | serviços, Prisma |
| `jobs` | contratos e serviços | — |
| `services` | tudo acima + Prisma | rotas do Next |

O teste rápido: se um arquivo de `policy/` ou `agents/` precisar de
`prisma`, a regra está no lugar errado — ela pertence a `services/`.

## Onde mexer para cada mudança

| Quero… | Mexo em |
|---|---|
| mudar o que um agente escreve | `prompts/growth/<agente>/vN.md` (nova versão) |
| mudar o contrato de saída de um agente | `agents/<agente>.ts` (schema Zod) |
| mudar quem aprova o quê | `policy/approvalPolicy.ts` |
| mudar o que o sistema se recusa a enviar | `policy/messagingPolicy.ts`, `policy/guardrails.ts` |
| trocar de rede social ou de gerador de vídeo | `providers/` + `providers/registry.ts` |
| adicionar uma etapa assíncrona | `jobs/types.ts` + `jobs/registry.ts` + um serviço |

## Ordem das verificações no envio de uma mensagem

É a parte do sistema que mais custa se estiver errada, então está escrita
explicitamente em `services/SalesService.ts`:

1. pedido de descadastro — antes de qualquer chamada ao modelo;
2. política de plataforma (janela, limites, silêncio) — antes de gastar token;
3. geração pelo modelo;
4. guardrail determinístico sobre o texto gerado;
5. política de aprovação — humano no meio, se o modo pedir;
6. envio, com a política reavaliada (o tempo passou desde a aprovação).
