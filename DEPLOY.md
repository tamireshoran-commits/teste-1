# Deploy — Vercel + Neon

Passo a passo para colocar o StayScore no ar. Tudo em free tier.

## 1. Banco no Neon

1. Crie uma conta em [neon.tech](https://neon.tech) e um projeto PostgreSQL.
2. Copie a **connection string** (formato `postgresql://user:pass@host/db?sslmode=require`).

O Prisma 7 usa driver adapter, então a string padrão do Neon funciona direto —
não é preciso o driver serverless deles.

## 2. Aplicar as migrations

Do seu computador, apontando para o Neon:

```bash
DATABASE_URL="<string-do-neon>" npx prisma migrate deploy
DATABASE_URL="<string-do-neon>" npm run db:seed
```

O seed cria a configuração de scoring `v1`. Ele **não** cria o usuário de
desenvolvimento quando `NODE_ENV=production`.

## 3. Deploy na Vercel

1. Em [vercel.com](https://vercel.com), importe o repositório do GitHub.
2. A Vercel detecta Next.js sozinha. O `build` já roda `prisma generate`.
3. Configure as variáveis de ambiente:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | a connection string do Neon |
| `AUTH_SECRET` | gere com `openssl rand -base64 32` |
| `AUTH_URL` | a URL do projeto, ex. `https://stayscore.vercel.app` |
| `GEMINI_API_KEY` | sua chave do Google AI Studio |
| `VISION_PROVIDER` | `GEMINI` |
| `LLM_PROVIDER` | `GEMINI` |
| `VISION_MODEL` | `gemini-3.5-flash-lite` |
| `LLM_MODEL_CHEAP` | `gemini-3.5-flash-lite` |
| `LLM_MODEL_SMART` | `gemini-3.5-flash` |

Opcional, para o custo em dólar aparecer no relatório: `MODEL_PRICING_JSON`
com os preços da tabela oficial do Google.

## O que considerar antes de mandar tráfego real

**Fotos não são persistidas.** Os bytes vivem em memória entre o upload e a
execução da análise. Numa única instância isso funciona; na Vercel, onde cada
requisição pode cair em uma instância diferente, o upload e o `run` podem
não compartilhar memória. **Antes de abrir para usuários, mova as imagens para
um object storage** (Vercel Blob, Cloudflare R2 ou S3) implementando o
`StorageProvider` que já existe. Enquanto isso, a etapa de fotos reporta
exatamente esse caso e pede o reenvio, em vez de falhar sem explicação.

**A execução é síncrona.** Uma análise leva cerca de 7 segundos com 6 fotos.
Funções da Vercel no plano gratuito têm limite de 10 segundos — com 20 ou 30
fotos isso estoura. Duas saídas, em ordem de esforço: subir o plano, ou mover
o pipeline para uma fila. O modelo `AnalysisStep` já foi desenhado para a
segunda opção.

**Teto de custo.** `MAX_COST_PER_ANALYSIS_USD` só atua quando os preços estão
configurados. Sem eles, o limitador não tem como saber quanto foi gasto —
configure `MODEL_PRICING_JSON` antes de expor a aplicação a terceiros.

## Alternativa: servidor próprio

O `docker-compose.yml` na raiz sobe o Postgres de desenvolvimento. Para
produção em VPS, use `npm run build && npm start` atrás de um proxy reverso,
com as mesmas variáveis de ambiente acima.
