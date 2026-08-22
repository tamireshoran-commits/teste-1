import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { conversationService } from '@/server/growth/services/ConversationService';
import { workspaceService } from '@/server/growth/services/WorkspaceService';
import {
  CHANNEL_LABEL,
  STATUS_LABEL,
  TEMPERATURE_LABEL,
  TEMPERATURE_TONE,
  formatDateTime,
} from '../_components/format';

export const dynamic = 'force-dynamic';

export default async function ConversationsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const workspace = await workspaceService.ensureForUser(session.user.id);
  const conversations = await conversationService.listForWorkspace(
    workspace.id,
    session.user.id,
  );

  const waitingHuman = conversations.filter((c) => c.status === 'WAITING_HUMAN');
  const hot = conversations.filter((c) =>
    c.leads.some((lead) => ['HOT', 'READY'].includes(lead.temperature)),
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold text-ink-900">Conversas</h1>
        <p className="text-sm text-ink-500">
          {conversations.length} conversas · {hot.length} com lead quente ·{' '}
          {waitingHuman.length} precisam de humano
        </p>
      </div>

      {waitingHuman.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-800">
            Precisam de você
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {waitingHuman.map((conversation) => (
              <li key={conversation.id}>
                <Link
                  href={`/growth/conversas/${conversation.id}`}
                  className="text-brand-600 hover:underline"
                >
                  {conversation.contact.username ?? conversation.contact.externalId}
                </Link>
                <span className="ml-2 text-ink-500">
                  {conversation.nextAction ?? 'aguardando atendimento'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-ink-100 bg-white">
        {conversations.length === 0 ? (
          <p className="p-6 text-sm text-ink-500">
            Nenhuma conversa ainda. Com o provedor simulado, use o botão de
            simulação em Configurações para testar o fluxo de ponta a ponta.
          </p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {conversations.map((conversation) => {
              const lead = conversation.leads[0];
              const lastMessage = conversation.messages[0];

              return (
                <li key={conversation.id}>
                  <Link
                    href={`/growth/conversas/${conversation.id}`}
                    className="block p-5 transition hover:bg-ink-50"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-ink-900">
                          {conversation.contact.username ??
                            conversation.contact.externalId}
                        </p>
                        <p className="mt-1 text-xs text-ink-500">
                          {CHANNEL_LABEL[conversation.channel] ?? conversation.channel} ·{' '}
                          {STATUS_LABEL[conversation.status] ?? conversation.status} ·{' '}
                          {formatDateTime(conversation.updatedAt)}
                        </p>
                        {lastMessage !== undefined && (
                          <p className="mt-2 line-clamp-2 max-w-2xl text-sm text-ink-700">
                            {lastMessage.direction === 'INBOUND' ? '' : 'Você: '}
                            {lastMessage.text}
                          </p>
                        )}
                      </div>

                      {lead !== undefined && (
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-medium ${
                            TEMPERATURE_TONE[lead.temperature] ?? ''
                          }`}
                        >
                          {TEMPERATURE_LABEL[lead.temperature] ?? lead.temperature} ·{' '}
                          {lead.score}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
