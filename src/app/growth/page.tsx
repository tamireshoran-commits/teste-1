import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { dashboardService } from '@/server/growth/services/DashboardService';
import { workspaceService } from '@/server/growth/services/WorkspaceService';
import { ActionButton } from './_components/ActionButton';
import { formatCurrency, formatDateTime } from './_components/format';

export const dynamic = 'force-dynamic';

export default async function GrowthDashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const workspace = await workspaceService.ensureForUser(session.user.id);
  const [summary, performance, audit] = await Promise.all([
    dashboardService.summary(workspace.id, session.user.id),
    dashboardService.contentPerformance(workspace.id, session.user.id),
    dashboardService.recentAudit(workspace.id, session.user.id, 8),
  ]);

  const queue = summary.operations.queue;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-ink-900">Painel</h1>
        <ActionButton endpoint="/api/growth/worker/tick" variant="secondary">
          Processar fila agora
        </ActionButton>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Leads" value={summary.leads.total} hint={`${summary.leads.new7d} nos últimos 7 dias`} />
        <Stat label="Leads quentes" value={summary.leads.hot} hint="HOT + prontos para compra" />
        <Stat
          label="Vendas"
          value={summary.deals.won}
          hint={formatCurrency(summary.deals.revenueCents)}
        />
        <Stat
          label="Conversão"
          value={`${(summary.deals.conversionRate * 100).toFixed(1)}%`}
          hint="vendas ÷ leads"
        />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Publicações" value={summary.content.published} hint={`${summary.content.scheduled} agendadas`} />
        <Stat label="Alcance (30d)" value={summary.reach.last30d} hint={`${summary.reach.engagement} interações`} />
        <Stat
          label="Aguardando você"
          value={summary.operations.pendingApprovals + summary.content.pendingApproval}
          hint={`${summary.operations.waitingHuman} conversas com humano`}
        />
        <Stat
          label="Custo de IA (30d)"
          value={`US$ ${summary.cost.last30dUsd.toFixed(4)}`}
          hint={
            summary.cost.last30dUsd === 0
              ? 'sem tabela de preços configurada'
              : `${summary.cost.inputTokens + summary.cost.outputTokens} tokens`
          }
        />
      </section>

      <section className="rounded-xl border border-ink-100 bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
            Fila de processamento
          </h2>
          <span className="text-xs text-ink-500">
            {(queue['DEAD'] ?? 0) > 0
              ? `${queue['DEAD']} job(s) esgotaram as tentativas`
              : 'sem jobs mortos'}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-6 text-sm text-ink-700">
          <span>Na fila: <strong>{queue['QUEUED'] ?? 0}</strong></span>
          <span>Executando: <strong>{queue['RUNNING'] ?? 0}</strong></span>
          <span>Concluídos: <strong>{queue['DONE'] ?? 0}</strong></span>
          <span className="text-score-bad">
            Falhos: <strong>{queue['DEAD'] ?? 0}</strong>
          </span>
        </div>
      </section>

      <section className="rounded-xl border border-ink-100 bg-white p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Desempenho por conteúdo
        </h2>

        {performance.length === 0 ? (
          <p className="mt-4 text-sm text-ink-500">
            Nenhuma publicação com métricas ainda. Depois da primeira coleta, esta
            tabela liga cada conteúdo aos leads e à receita que ele gerou.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="pb-2">Tema</th>
                  <th className="pb-2">Formato</th>
                  <th className="pb-2 text-right">Alcance</th>
                  <th className="pb-2 text-right">Engajamento</th>
                  <th className="pb-2 text-right">Leads</th>
                  <th className="pb-2 text-right">Receita</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {performance.slice(0, 10).map((row) => (
                  <tr key={row.contentPieceId}>
                    <td className="py-2 pr-4 text-ink-900">{row.theme}</td>
                    <td className="py-2 pr-4 text-ink-500">{row.format}</td>
                    <td className="py-2 text-right tabular-nums">{row.reach}</td>
                    <td className="py-2 text-right tabular-nums">
                      {(row.engagementRate * 100).toFixed(1)}%
                    </td>
                    <td className="py-2 text-right tabular-nums">{row.leads}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCurrency(row.revenueCents)}
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
          Últimas ações dos agentes
        </h2>

        {audit.length === 0 ? (
          <p className="mt-4 text-sm text-ink-500">
            Nada registrado ainda.{' '}
            <Link href="/growth/configuracoes" className="text-brand-500">
              Comece pela estratégia
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-4 space-y-2 text-sm">
            {audit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap gap-2 text-ink-700">
                <span className="text-ink-500 tabular-nums">
                  {formatDateTime(entry.createdAt)}
                </span>
                <strong className="text-ink-900">{entry.action}</strong>
                <span className="text-ink-500">
                  {entry.actorType.toLowerCase()} · {entry.actor}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-ink-100 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
        {label}
      </p>
      <p className="mt-2 text-3xl font-semibold tabular-nums text-ink-900">
        {value}
      </p>
      {hint !== undefined && (
        <p className="mt-1 text-xs text-ink-500">{hint}</p>
      )}
    </div>
  );
}
