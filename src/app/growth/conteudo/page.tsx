import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { approvalService } from '@/server/growth/services/ApprovalService';
import { contentService } from '@/server/growth/services/ContentService';
import { workspaceService } from '@/server/growth/services/WorkspaceService';
import { ActionButton } from '../_components/ActionButton';
import { JsonForm } from '../_components/JsonForm';
import { STATUS_LABEL, formatDate } from '../_components/format';

export const dynamic = 'force-dynamic';

const OBJECTIVE_LABEL: Record<string, string> = {
  REACH: 'Alcance',
  ENGAGEMENT: 'Engajamento',
  LEADS: 'Geração de leads',
  SALES: 'Venda',
};

const FUNNEL_LABEL: Record<string, string> = {
  AWARENESS: 'Descoberta',
  INTEREST: 'Interesse',
  CONSIDERATION: 'Consideração',
  DECISION: 'Decisão',
  RETENTION: 'Retenção',
};

export default async function ContentPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const workspace = await workspaceService.ensureForUser(session.user.id);

  const [pieces, approvals] = await Promise.all([
    contentService.listPieces(workspace.id, session.user.id),
    approvalService.listPending(workspace.id, session.user.id),
  ]);

  const pending = pieces.filter((p) => p.status === 'PENDING_APPROVAL');
  const scheduled = pieces.filter((p) =>
    ['APPROVED', 'SCHEDULED'].includes(p.status),
  );
  const published = pieces.filter((p) => p.status === 'PUBLISHED');
  const others = pieces.filter(
    (p) => !['PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'PUBLISHED'].includes(p.status),
  );

  const today = new Date();
  const inThirtyDays = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-ink-900">Conteúdo</h1>

      <section className="rounded-xl border border-ink-100 bg-white p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Novo calendário
        </h2>
        <p className="mt-1 text-sm text-ink-500">
          O estrategista de conteúdo usa a estratégia ativa e o aprendizado das
          publicações anteriores para montar o calendário.
        </p>

        <div className="mt-4 max-w-xl">
          <JsonForm
            endpoint="/api/growth/plans"
            submitLabel="Gerar calendário"
            successMessage="Calendário na fila. Processe a fila para ver as peças."
            fields={[
              {
                name: 'title',
                label: 'Título do plano',
                required: true,
                placeholder: 'Ex.: Lançamento de setembro',
              },
              {
                name: 'periodStart',
                label: 'Início',
                type: 'date',
                required: true,
                defaultValue: today.toISOString().slice(0, 10),
              },
              {
                name: 'periodEnd',
                label: 'Fim',
                type: 'date',
                required: true,
                defaultValue: inThirtyDays.toISOString().slice(0, 10),
              },
              {
                name: 'pieceCount',
                label: 'Quantidade de peças',
                type: 'number',
                defaultValue: 8,
                help: 'Entre 1 e 30. Cada peça vira roteiro, legenda e mídia.',
              },
            ]}
          />
        </div>
      </section>

      {approvals.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-800">
            Aguardando sua aprovação ({approvals.length})
          </h2>

          <ul className="mt-4 space-y-3">
            {approvals.map((approval) => (
              <li
                key={approval.id}
                className="rounded-lg border border-amber-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink-900">{approval.title}</p>
                    <p className="mt-1 text-xs text-ink-500">
                      {approval.actionType} · risco {approval.riskLevel} ·{' '}
                      {approval.requestedByAgent ?? 'sistema'}
                    </p>
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-ink-50 p-3 text-xs text-ink-700">
                      {JSON.stringify(approval.payload, null, 2)}
                    </pre>
                  </div>

                  <div className="flex gap-2">
                    <ActionButton
                      endpoint={`/api/growth/approvals/${approval.id}`}
                      body={{ decision: 'APPROVED' }}
                    >
                      Aprovar
                    </ActionButton>
                    <ActionButton
                      endpoint={`/api/growth/approvals/${approval.id}`}
                      body={{ decision: 'REJECTED' }}
                      variant="danger"
                    >
                      Reprovar
                    </ActionButton>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ContentGroup
        title={`Aguardando aprovação (${pending.length})`}
        pieces={pending}
        showDecision
      />
      <ContentGroup title={`Agendados (${scheduled.length})`} pieces={scheduled} />
      <ContentGroup title={`Publicados (${published.length})`} pieces={published} />
      {others.length > 0 && (
        <ContentGroup title={`Rascunhos e reprovados (${others.length})`} pieces={others} />
      )}
    </div>
  );
}

type PieceWithRelations = Awaited<
  ReturnType<typeof contentService.listPieces>
>[number];

function ContentGroup({
  title,
  pieces,
  showDecision = false,
}: {
  title: string;
  pieces: PieceWithRelations[];
  showDecision?: boolean;
}) {
  return (
    <section className="rounded-xl border border-ink-100 bg-white p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
        {title}
      </h2>

      {pieces.length === 0 ? (
        <p className="mt-4 text-sm text-ink-500">Nada aqui ainda.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {pieces.map((piece) => (
            <li key={piece.id} className="rounded-lg border border-ink-100 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                    <span className="rounded bg-ink-100 px-2 py-0.5 font-medium">
                      {piece.format}
                    </span>
                    <span>{OBJECTIVE_LABEL[piece.objective] ?? piece.objective}</span>
                    <span>· {FUNNEL_LABEL[piece.funnelStage] ?? piece.funnelStage}</span>
                    {piece.scheduledFor !== null && (
                      <span>· {formatDate(piece.scheduledFor)}</span>
                    )}
                    <span>· {STATUS_LABEL[piece.status] ?? piece.status}</span>
                    {piece.media.some((asset) => asset.isMock) && (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-800">
                        mídia simulada
                      </span>
                    )}
                  </div>

                  <p className="mt-2 font-medium text-ink-900">{piece.theme}</p>
                  <p className="mt-1 text-sm text-ink-700">
                    <strong>Gancho:</strong> {piece.hook}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-ink-700">
                    {piece.caption}
                  </p>
                  <p className="mt-2 text-sm text-brand-600">{piece.cta}</p>

                  {piece.rejectionReason !== null && (
                    <p className="mt-2 text-xs text-score-bad">
                      {piece.rejectionReason}
                    </p>
                  )}

                  {piece.publications.length > 0 && (
                    <p className="mt-2 text-xs text-ink-500">
                      {piece.publications
                        .map(
                          (pub) =>
                            `${pub.platform}: ${STATUS_LABEL[pub.status] ?? pub.status}${
                              pub.isMock ? ' (simulado)' : ''
                            }`,
                        )
                        .join(' · ')}
                    </p>
                  )}
                </div>

                {showDecision && (
                  <div className="flex gap-2">
                    <ActionButton
                      endpoint={`/api/growth/content/${piece.id}/decision`}
                      body={{ decision: 'APPROVE' }}
                    >
                      Aprovar
                    </ActionButton>
                    <ActionButton
                      endpoint={`/api/growth/content/${piece.id}/decision`}
                      body={{ decision: 'REJECT', reason: 'Reprovado no painel.' }}
                      variant="danger"
                    >
                      Reprovar
                    </ActionButton>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
