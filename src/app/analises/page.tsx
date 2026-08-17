import Link from 'next/link';
import { redirect } from 'next/navigation';
import { scoreTone } from '@/components/ScoreDial';
import { auth } from '@/server/auth';
import { analysisService } from '@/server/services/AnalysisService';

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Rascunho',
  QUEUED: 'Na fila',
  RUNNING: 'Executando',
  PARTIAL: 'Parcial',
  COMPLETED: 'Concluída',
  FAILED: 'Falhou',
};

const TONE_CLASS = {
  bad: 'text-score-bad',
  mid: 'text-score-mid',
  good: 'text-score-good',
  none: 'text-ink-300',
} as const;

export default async function AnalysesPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const analyses = await analysisService.listForUser(session.user.id);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
          Minhas análises
        </h1>
        <Link
          href="/analises/nova"
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          Nova análise
        </Link>
      </div>

      {analyses.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-ink-300 p-10 text-center">
          <p className="text-ink-500">Você ainda não criou nenhuma análise.</p>
          <Link
            href="/analises/nova"
            className="mt-4 inline-block rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            Criar a primeira
          </Link>
        </div>
      ) : (
        <ul className="mt-8 space-y-3">
          {analyses.map((analysis) => (
            <li key={analysis.id}>
              <Link
                href={`/analises/${analysis.id}`}
                className="flex items-center justify-between rounded-xl border border-ink-100 bg-white p-5 transition hover:border-brand-500"
              >
                <div>
                  <p className="font-medium text-ink-900">
                    {analysis.property.name}
                  </p>
                  <p className="mt-1 text-sm text-ink-500">
                    {STATUS_LABEL[analysis.status] ?? analysis.status} ·{' '}
                    {new Intl.DateTimeFormat('pt-BR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }).format(analysis.createdAt)}
                  </p>
                </div>

                <span
                  className={`text-3xl font-semibold tabular-nums ${
                    TONE_CLASS[scoreTone(analysis.overallScore)]
                  }`}
                >
                  {analysis.overallScore ?? '—'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
