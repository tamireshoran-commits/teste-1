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

---

## Growth Engine em produção

O módulo de marketing e vendas tem três exigências extras.

### 1. O worker precisa rodar

A fila (`growth_jobs`) só anda quando alguém chama um ciclo do worker. Em
serverless não existe processo longo, então use um cron apontando para o
endpoint:

`vercel.json`:

```json
{ "crons": [{ "path": "/api/growth/worker/tick", "schedule": "* * * * *" }] }
```

O endpoint aceita `x-cron-secret: $CRON_SECRET` ou uma sessão autenticada.
Configure `CRON_SECRET` — sem ele, qualquer um na internet pode disparar a
fila da sua conta.

Em VPS, o mesmo ciclo roda em processo dedicado chamando
`runGrowthWorkerTick()` em laço; é o caminho recomendado quando a geração de
vídeo entrar, porque essas chamadas passam de dez segundos.

### 2. Webhook e credenciais da Meta

| Variável | Para quê |
|---|---|
| `SOCIAL_PROVIDER=META` | sai do modo simulado |
| `META_APP_SECRET` | valida a assinatura do webhook (sem ela, tudo é recusado) |
| `META_VERIFY_TOKEN` | eco na verificação inicial do webhook |
| `META_TOKEN_<CONTA>` | token de longa duração, referenciado por nome no painel |

Webhook a cadastrar no app da Meta:
`https://SEU_DOMINIO/api/growth/webhooks/meta`, tópicos `messages`,
`comments` e `feed`.

Antes disso é preciso ter, e não é código: conta Instagram Business vinculada
a uma Página, negócio verificado e App Review aprovado para publicação,
comentários e mensagens — são permissões distintas, revisadas separadamente.

### 3. Mídia acessível publicamente

Na hora de publicar, **a Meta baixa o arquivo do seu servidor** por URL
(`/api/growth/media/<chave>`). Com `STORAGE_PROVIDER=LOCAL`, o arquivo vive no
disco da instância — o que não funciona em serverless, onde a instância que
gerou a mídia não é a que atende o download. Antes de publicar de verdade,
implemente o `StorageProvider` para S3/R2/Vercel Blob.

### Alternativa mais barata: tudo em um servidor só

A conta da Vercel é o maior item fixo, e some se a aplicação, o Postgres e um
gateway de IA (OmniRoute) rodarem juntos em uma VPS pequena — algo em torno de
US$ 5/mês em vez de US$ 20, sem cobrança por função nem por banco.

O que muda:

- `npm run build && npm start` atrás de um proxy reverso (Caddy ou Nginx), com
  Postgres na mesma máquina;
- o worker vira um processo em laço, o que é melhor do que o cron HTTP — sem
  teto de duração, que é o que trava geração de vídeo em serverless;
- `STORAGE_PROVIDER=LOCAL` volta a funcionar, porque existe um disco só;
- o gateway de IA fica acessível em `localhost`, **sem porta aberta para a
  internet**.

O custo dessa economia é operacional: atualização de sistema, backup do banco
e monitoramento passam a ser seus. Se ninguém no time vai cuidar disso, os
US$ 20 da Vercel compram exatamente esse trabalho.

### Primeira semana no ar

Deixe o workspace em **modo manual** e leia o que os agentes escreveram antes
de aprovar. O custo de um mês de conteúdo ruim é pequeno; o de uma DM errada
para um cliente, não. Suba para semiautomático quando as respostas estiverem
consistentes, e para autônomo só depois de ver o funil completo funcionando.
