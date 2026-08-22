import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { conversationService } from '@/server/growth/services/ConversationService';
import { ActionButton } from '../../_components/ActionButton';
import {
  CHANNEL_LABEL,
  STATUS_LABEL,
  TEMPERATURE_LABEL,
  formatCurrency,
  formatDateTime,
} from '../../_components/format';

export const dynamic = 'force-dynamic';

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const { id } = await params;
  const conversation = await conversationService.getForUser(id, session.user.id);

  if (conversation === null) notFound();

  const lead = conversation.leads[0];
  const objections = Array.isArray(lead?.objections) ? lead.objections : [];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/growth/conversas" className="text-sm text-brand-600">
          ← Conversas
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-ink-900">
          {conversation.contact.username ?? conversation.contact.externalId}
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          {CHANNEL_LABEL[conversation.channel] ?? conversation.channel} ·{' '}
          {STATUS_LABEL[conversation.status] ?? conversation.status}
          {conversation.sourceContentPiece !== null && (
            <> · veio do conteúdo “{conversation.sourceContentPiece.theme}”</>
          )}
          {conversation.contact.optOut && (
            <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-xs text-score-bad">
              pediu para não receber mensagens
            </span>
          )}
        </p>
      </div>

      {lead !== undefined && (
        <section className="rounded-xl border border-ink-100 bg-white p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
            Qualificação
          </h2>

          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Info label="Temperatura" value={`${TEMPERATURE_LABEL[lead.temperature] ?? lead.temperature} (${lead.score})`} />
            <Info label="Interesse" value={lead.intent} />
            <Info label="Problema" value={lead.problem} />
            <Info label="Produto" value={lead.product?.name ?? null} />
            <Info label="Orçamento" value={lead.budget} />
            <Info label="Urgência" value={lead.urgency} />
            <Info label="Estágio" value={lead.decisionStage} />
            <Info
              label="Objeções"
              value={objections.length > 0 ? objections.join('; ') : null}
            />
            <Info
              label="Negócio"
              value={
                lead.deals[0] !== undefined
                  ? `${lead.deals[0].stage} · ${formatCurrency(lead.deals[0].valueCents ?? 0)}`
                  : null
              }
            />
          </dl>
        </section>
      )}

      <section className="rounded-xl border border-ink-100 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
            Histórico
          </h2>

          {conversation.status !== 'HUMAN_HANDLED' && (
            <ActionButton
              endpoint={`/api/growth/conversations/${conversation.id}/takeover`}
              variant="secondary"
              confirmMessage="A partir daqui o agente para de responder nesta conversa. Continuar?"
            >
              Assumir conversa
            </ActionButton>
          )}
        </div>

        <ul className="mt-5 space-y-4">
          {conversation.messages.map((message) => (
            <li
              key={message.id}
              className={
                message.direction === 'INBOUND' ? 'text-left' : 'text-right'
              }
            >
              <div
                className={`inline-block max-w-[80%] rounded-xl px-4 py-3 text-sm ${
                  message.direction === 'INBOUND'
                    ? 'bg-ink-100 text-ink-900'
                    : 'bg-brand-500 text-white'
                }`}
              >
                <p className="whitespace-pre-wrap">{message.text}</p>
              </div>

              <p className="mt-1 text-xs text-ink-500">
                {formatDateTime(
                  message.sentAt ?? message.receivedAt ?? message.createdAt,
                )}{' '}
                · {STATUS_LABEL[message.status] ?? message.status}
                {message.agent !== null && ` · ${message.agent}`}
                {message.blockedReason !== null && (
                  <span className="text-score-bad"> · {message.blockedReason}</span>
                )}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-1 text-ink-900">{value ?? '—'}</dd>
    </div>
  );
}
