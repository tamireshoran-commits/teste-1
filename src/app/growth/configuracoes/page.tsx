import { redirect } from 'next/navigation';
import { env } from '@/server/config/env';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db/prisma';
import { MODE_LABEL } from '@/server/growth/policy/approvalPolicy';
import { strategyService } from '@/server/growth/services/StrategyService';
import { workspaceService } from '@/server/growth/services/WorkspaceService';
import { ActionButton } from '../_components/ActionButton';
import { JsonForm } from '../_components/JsonForm';
import { formatCurrency, formatDateTime } from '../_components/format';

export const dynamic = 'force-dynamic';

const MODE_DESCRIPTION = {
  MANUAL:
    'A IA cria tudo e nada sai sem você aprovar: mídia, publicação, mensagem e follow-up.',
  SEMI_AUTOMATIC:
    'Ações de baixo e médio risco saem sozinhas (gerar mídia, responder comentário). Publicar e enviar mensagem continuam pedindo aprovação.',
  AUTONOMOUS:
    'A IA executa tudo que as integrações permitem. As regras de plataforma, opt-out, limites e horário silencioso continuam valendo — modo nenhum desliga isso.',
} as const;

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const userId = session.user.id;
  const workspace = await workspaceService.ensureForUser(userId);

  const [brand, products, accounts, strategies] = await Promise.all([
    prisma.brandProfile.findUnique({ where: { workspaceId: workspace.id } }),
    prisma.product.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.socialAccount.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: 'asc' },
    }),
    strategyService.listForWorkspace(workspace.id, userId),
  ]);

  const doNotSay = Array.isArray(brand?.doNotSay) ? brand.doNotSay : [];
  const activeStrategy = strategies.find((s) => s.status === 'ACTIVE');

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-ink-900">Configurações</h1>

      <section className="rounded-xl border border-ink-100 bg-white p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Modo de operação
        </h2>

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {(['MANUAL', 'SEMI_AUTOMATIC', 'AUTONOMOUS'] as const).map((mode) => (
            <div
              key={mode}
              className={`rounded-lg border p-4 ${
                workspace.mode === mode
                  ? 'border-brand-500 bg-brand-50'
                  : 'border-ink-100'
              }`}
            >
              <p className="font-medium capitalize text-ink-900">
                {MODE_LABEL[mode]}
              </p>
              <p className="mt-1 text-sm text-ink-700">
                {MODE_DESCRIPTION[mode]}
              </p>

              {workspace.mode !== mode && (
                <div className="mt-3">
                  <ActionButton
                    endpoint="/api/growth/workspace"
                    method="PATCH"
                    body={{ mode }}
                    variant="secondary"
                    confirmMessage={
                      mode === 'AUTONOMOUS'
                        ? 'No modo autônomo o sistema publica e envia mensagens sem sua aprovação. Confirmar?'
                        : undefined
                    }
                  >
                    Usar este modo
                  </ActionButton>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 max-w-xl">
          <JsonForm
            endpoint="/api/growth/workspace"
            method="PATCH"
            submitLabel="Salvar limites"
            successMessage="Limites atualizados."
            fields={[
              {
                name: 'timezone',
                label: 'Fuso horário',
                defaultValue: workspace.timezone,
                help: 'Base do horário silencioso e dos limites diários.',
              },
              {
                name: 'quietHoursStart',
                label: 'Silêncio começa (hora)',
                type: 'number',
                defaultValue: workspace.quietHoursStart,
              },
              {
                name: 'quietHoursEnd',
                label: 'Silêncio termina (hora)',
                type: 'number',
                defaultValue: workspace.quietHoursEnd,
              },
              {
                name: 'maxMessagesPerContactPerDay',
                label: 'Máximo de mensagens por contato/dia',
                type: 'number',
                defaultValue: workspace.maxMessagesPerContactPerDay,
              },
              {
                name: 'maxPublicationsPerDay',
                label: 'Máximo de publicações por dia',
                type: 'number',
                defaultValue: workspace.maxPublicationsPerDay,
                help: 'A Meta também impõe um teto próprio por conta.',
              },
            ]}
          />
        </div>
      </section>

      <section className="rounded-xl border border-ink-100 bg-white p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Marca e tom de voz
        </h2>

        <div className="mt-4 max-w-xl">
          <JsonForm
            endpoint="/api/growth/brand"
            method="PUT"
            submitLabel="Salvar marca"
            successMessage="Marca atualizada."
            listFields={['doNotSay']}
            fields={[
              {
                name: 'name',
                label: 'Nome da marca',
                required: true,
                defaultValue: brand?.name ?? workspace.name,
              },
              {
                name: 'description',
                label: 'Descrição',
                type: 'textarea',
                defaultValue: brand?.description ?? '',
              },
              {
                name: 'toneOfVoice',
                label: 'Tom de voz',
                defaultValue: brand?.toneOfVoice ?? '',
              },
              {
                name: 'valueProposition',
                label: 'Proposta de valor',
                defaultValue: brand?.valueProposition ?? '',
              },
              {
                name: 'defaultCta',
                label: 'CTA padrão',
                defaultValue: brand?.defaultCta ?? '',
              },
              {
                name: 'doNotSay',
                label: 'Termos proibidos',
                defaultValue: doNotSay.join('; '),
                help:
                  'Separe por ponto e vírgula. Nenhuma mensagem ou legenda com esses termos é enviada.',
              },
            ]}
          />
        </div>
      </section>

      <section className="rounded-xl border border-ink-100 bg-white p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Produtos e links
        </h2>
        <p className="mt-1 text-sm text-ink-500">
          O agente de vendas só pode citar preço e enviar link que estejam aqui.
        </p>

        {products.length > 0 && (
          <ul className="mt-4 space-y-2 text-sm">
            {products.map((product) => (
              <li
                key={product.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-100 p-3"
              >
                <span className="text-ink-900">{product.name}</span>
                <span className="text-ink-500">
                  {product.priceCents !== null
                    ? formatCurrency(product.priceCents, product.currency)
                    : 'sob consulta'}
                  {product.checkoutUrl !== null ? ' · checkout ok' : ' · sem checkout'}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 max-w-xl">
          <JsonForm
            endpoint="/api/growth/products"
            submitLabel="Adicionar produto"
            successMessage="Produto cadastrado."
            listFields={['benefits']}
            fields={[
              { name: 'name', label: 'Nome', required: true },
              {
                name: 'description',
                label: 'Descrição',
                type: 'textarea',
                required: true,
              },
              {
                name: 'priceCents',
                label: 'Preço em centavos',
                type: 'number',
                help: '19990 = R$ 199,90. Em centavos para não arredondar preço.',
              },
              { name: 'checkoutUrl', label: 'Link de compra' },
              { name: 'schedulingUrl', label: 'Link de agendamento' },
              {
                name: 'benefits',
                label: 'Benefícios',
                help: 'Separe por ponto e vírgula.',
              },
            ]}
          />
        </div>
      </section>

      <section className="rounded-xl border border-ink-100 bg-white p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Contas conectadas
        </h2>
        <p className="mt-1 text-sm text-ink-500">
          Provedor atual: <strong>{env.SOCIAL_PROVIDER}</strong>.{' '}
          {env.SOCIAL_PROVIDER === 'MOCK'
            ? 'Nada é publicado ou enviado de verdade — tudo fica marcado como simulado.'
            : 'Publicações e mensagens vão para as APIs oficiais da Meta.'}
        </p>

        {accounts.length > 0 && (
          <ul className="mt-4 space-y-2 text-sm">
            {accounts.map((account) => (
              <li
                key={account.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-100 p-3"
              >
                <span className="text-ink-900">
                  {account.platform} · {account.username ?? account.externalId}
                </span>
                <span className="text-ink-500">
                  {account.status}
                  {account.tokenRef !== null ? ` · token em ${account.tokenRef}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 max-w-xl">
          <JsonForm
            endpoint="/api/growth/accounts"
            submitLabel="Conectar conta"
            successMessage="Conta cadastrada."
            fields={[
              {
                name: 'platform',
                label: 'Plataforma',
                type: 'select',
                options: [
                  { value: 'INSTAGRAM', label: 'Instagram' },
                  { value: 'FACEBOOK', label: 'Facebook' },
                ],
              },
              {
                name: 'externalId',
                label: 'ID da conta',
                required: true,
                help: 'Instagram: IG User ID. Facebook: Page ID.',
              },
              { name: 'username', label: 'Usuário' },
              { name: 'pageId', label: 'Page ID vinculada' },
              {
                name: 'tokenRef',
                label: 'Variável de ambiente do token',
                placeholder: 'META_TOKEN_MINHA_CONTA',
                help:
                  'O NOME da variável, nunca o token. O token fica no gerenciador de segredos da hospedagem.',
              },
            ]}
          />
        </div>
      </section>

      <section className="rounded-xl border border-ink-100 bg-white p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Estratégia de mercado
        </h2>

        {activeStrategy !== undefined ? (
          <div className="mt-3 rounded-lg border border-ink-100 p-4 text-sm">
            <p className="font-medium text-ink-900">{activeStrategy.niche}</p>
            <p className="mt-1 text-ink-700">{activeStrategy.valueProposition}</p>
            <p className="mt-2 text-xs text-ink-500">
              atualizada em {formatDateTime(activeStrategy.updatedAt)}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-500">
            Nenhuma estratégia ativa. É o primeiro passo: sem persona e objeções,
            o conteúdo e o vendedor trabalham no escuro.
          </p>
        )}

        <div className="mt-6 max-w-xl">
          <JsonForm
            endpoint="/api/growth/strategies"
            submitLabel="Pesquisar mercado"
            successMessage="Pesquisa na fila. Processe a fila no painel."
            fields={[
              {
                name: 'niche',
                label: 'Nicho',
                required: true,
                placeholder: 'Ex.: nutrição esportiva para corredores amadores',
              },
              {
                name: 'brief',
                label: 'Contexto',
                type: 'textarea',
                required: true,
                placeholder:
                  'O que você vende, para quem, o que já tentou, diferenciais, região...',
                help: 'Quanto mais concreto, menos o agente precisa supor.',
              },
            ]}
          />
        </div>
      </section>

      {env.SOCIAL_PROVIDER === 'MOCK' && (
        <section className="rounded-xl border border-dashed border-ink-300 p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
            Simular interação recebida
          </h2>
          <p className="mt-1 text-sm text-ink-500">
            Cria um evento como se tivesse chegado pelo webhook da Meta, para
            testar qualificação, resposta e follow-up sem depender do App Review.
          </p>

          <div className="mt-4 max-w-xl">
            <JsonForm
              endpoint="/api/growth/simulate/inbound"
              submitLabel="Simular"
              successMessage="Evento criado. Processe a fila no painel."
              fields={[
                {
                  name: 'channel',
                  label: 'Canal',
                  type: 'select',
                  options: [
                    { value: 'IG_DM', label: 'Instagram · direct' },
                    { value: 'IG_COMMENT', label: 'Instagram · comentário' },
                    { value: 'FB_MESSENGER', label: 'Facebook · Messenger' },
                    { value: 'FB_COMMENT', label: 'Facebook · comentário' },
                  ],
                },
                {
                  name: 'text',
                  label: 'Mensagem',
                  type: 'textarea',
                  required: true,
                  placeholder: 'Quanto custa? Tem para quem está começando?',
                },
                {
                  name: 'contactExternalId',
                  label: 'ID do contato',
                  defaultValue: 'sim-contato-1',
                },
                {
                  name: 'contactUsername',
                  label: 'Usuário do contato',
                  defaultValue: 'contato.simulado',
                },
              ]}
            />
          </div>
        </section>
      )}
    </div>
  );
}
