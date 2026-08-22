import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { dashboardService } from '@/server/growth/services/DashboardService';
import { followUpService } from '@/server/growth/services/FollowUpService';
import { leadService } from '@/server/growth/services/LeadService';
import { learningService } from '@/server/growth/services/LearningService';
import { workspaceService } from '@/server/growth/services/WorkspaceService';
import {
  STATUS_LABEL,
  TEMPERATURE_LABEL,
  TEMPERATURE_TONE,
  formatCurrency,
  formatDateTime,
} from '../_components/format';

export const dynamic = 'force-dynamic';

const STAGE_LABEL: Record<string, string> = {
  NEW: 'Novo',
  QUALIFIED: 'Qualificado',
  PROPOSAL: 'Proposta',
  NEGOTIATION: 'Negociação',
  CHECKOUT_SENT: 'Checkout enviado',
  WON: 'Ganho',
  LOST: 'Perdido',
};

export default async function SalesPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const workspace = await workspaceService.ensureForUser(session.user.id);
  const userId = session.user.id;

  const [funnel, leads, followUps, insights] = await Promise.all([
    dashboardService.funnel(workspace.id, userId),
    leadService.listForWorkspace(workspace.id, userId),
    followUpService.listForWorkspace(workspace.id, userId),
    learningService.listInsights(workspace.id, userId),
  ]);

  const pendingFollowUps = followUps.filter((task) => task.status === 'PENDING');

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-ink-900">Vendas</h1>

      <section className="rounded-xl border border-ink-100 bg-white p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Funil
        </h2>

        {funnel.length === 0 ? (
          <p className="mt-4 text-sm text-ink-500">
            Nenhum negócio ainda. Um negócio é aberto automaticamente quando um
            lead é classificado como quente.
          </p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
            {funnel.map((stage) => (
              <div
                key={stage.stage}
                className="rounded-lg border border-ink-100 p-4"
              >
                <p className="text-xs uppercase tracking-wide text-ink-500">
                  {STAGE_LABEL[stage.stage] ?? stage.stage}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">
                  {stage.count}
                </p>
                <p className="text-xs text-ink-500">
                  {formatCurrency(stage.valueCents)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-ink-100 bg-white p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Leads
        </h2>

        {leads.length === 0 ? (
          <p className="mt-4 text-sm text-ink-500">Nenhum lead ainda.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="pb-2">Contato</th>
                  <th className="pb-2">Temperatura</th>
                  <th className="pb-2">Interesse</th>
                  <th className="pb-2">Produto</th>
                  <th className="pb-2">Negócio</th>
                  <th className="pb-2">Conversa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {leads.map((lead) => (
                  <tr key={lead.id}>
                    <td className="py-2 pr-4 text-ink-900">
                      {lead.contact.username ?? lead.contact.externalId}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          TEMPERATURE_TONE[lead.temperature] ?? ''
                        }`}
                      >
                        {TEMPERATURE_LABEL[lead.temperature] ?? lead.temperature}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-ink-700">{lead.intent ?? '—'}</td>
                    <td className="py-2 pr-4 text-ink-700">
                      {lead.product?.name ?? '—'}
                    </td>
                    <td className="py-2 pr-4 text-ink-700">
                      {lead.deals[0] !== undefined
                        ? `${STAGE_LABEL[lead.deals[0].stage] ?? lead.deals[0].stage}`
                        : '—'}
                    </td>
                    <td className="py-2">
                      {lead.conversation !== null ? (
                        <Link
                          href={`/growth/conversas/${lead.conversation.id}`}
                          className="text-brand-600 hover:underline"
                        >
                          abrir
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-ink-100 bg-white p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Follow-ups ({pendingFollowUps.length} pendentes)
        </h2>

        {followUps.length === 0 ? (
          <p className="mt-4 text-sm text-ink-500">
            Nenhum follow-up agendado. Eles são criados quando um lead
            demonstra interesse e a conversa para.
          </p>
        ) : (
          <ul className="mt-4 space-y-2 text-sm">
            {followUps.slice(0, 20).map((task) => (
              <li key={task.id} className="flex flex-wrap gap-2 text-ink-700">
                <span className="text-ink-500 tabular-nums">
                  {formatDateTime(task.scheduledFor)}
                </span>
                <strong className="text-ink-900">
                  {task.lead.contact.username ?? task.lead.contact.externalId}
                </strong>
                <span>
                  tentativa {task.attempt}/{task.maxAttempts} ·{' '}
                  {STATUS_LABEL[task.status] ?? task.status}
                </span>
                <span className="text-ink-500">{task.reason}</span>
                {task.cancelledReason !== null && (
                  <span className="text-xs text-score-bad">
                    {task.cancelledReason}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-ink-100 bg-white p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Aprendizado
        </h2>

        {insights.length === 0 ? (
          <p className="mt-4 text-sm text-ink-500">
            Sem padrões detectados ainda. A análise roda com pelo menos três
            publicações medidas — abaixo disso seria anedota, não padrão.
          </p>
        ) : (
          <ul className="mt-4 space-y-3 text-sm">
            {insights.map((insight) => (
              <li key={insight.id} className="rounded-lg border border-ink-100 p-4">
                <p className="text-ink-900">{insight.statement}</p>
                <p className="mt-1 text-ink-700">→ {insight.recommendation}</p>
                <p className="mt-2 text-xs text-ink-500">
                  {insight.dimension} · amostra {insight.sampleSize} · confiança{' '}
                  {(insight.confidence * 100).toFixed(0)}%
                  {insight.appliedAt !== null && ' · já aplicado a um calendário'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
