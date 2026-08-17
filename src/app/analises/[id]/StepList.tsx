'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Step {
  type: string;
  status: string;
  message: string | null;
  progressDone: number;
  progressTotal: number;
  errorMessage: string | null;
  attempts: number;
}

const TITLES: Record<string, string> = {
  PRICING: 'Pricing',
  PHOTOS: 'Fotos',
  AIRBNB: 'Airbnb',
  BOOKING: 'Booking.com',
  RECOMMENDATIONS: 'Recomendações',
  REPORT: 'Relatório',
};

const ORDER = ['PRICING', 'PHOTOS', 'AIRBNB', 'BOOKING', 'RECOMMENDATIONS', 'REPORT'];

const BADGE: Record<string, { icon: string; className: string }> = {
  DONE: { icon: '✓', className: 'text-score-good' },
  FAILED: { icon: '✕', className: 'text-score-bad' },
  SKIPPED: { icon: '–', className: 'text-ink-300' },
  RUNNING: { icon: '⋯', className: 'text-brand-500' },
  PENDING: { icon: '○', className: 'text-ink-300' },
};

/**
 * Etapas do pipeline com retry individual.
 *
 * Reexecutar só a etapa que falhou é o que evita o usuário pagar de novo pela
 * análise das fotos porque o anúncio deu erro.
 */
export function StepList({
  analysisId,
  initialSteps,
}: {
  analysisId: string;
  initialSteps: Step[];
}) {
  const router = useRouter();
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const steps = [...initialSteps].sort(
    (a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type),
  );

  async function retry(type: string) {
    setRetrying(type);
    setError(null);

    try {
      const response = await fetch(
        `/api/analyses/${analysisId}/steps/${type.toLowerCase()}/retry`,
        { method: 'POST' },
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(body?.error ?? 'Não foi possível reexecutar a etapa.');
        return;
      }

      router.refresh();
    } catch {
      setError('Falha de rede ao reexecutar a etapa.');
    } finally {
      setRetrying(null);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-ink-100 bg-white p-5">
      <h2 className="mb-3 text-base font-semibold text-ink-900">
        Etapas do processamento
      </h2>

      {error && (
        <p role="alert" className="mb-3 text-sm text-score-bad">
          {error}
        </p>
      )}

      <ul className="divide-y divide-ink-100">
        {steps.map((step) => {
          const badge = BADGE[step.status] ?? BADGE['PENDING']!;

          return (
            <li key={step.type} className="flex items-center gap-3 py-2.5">
              <span className={`w-4 text-center ${badge.className}`}>
                {badge.icon}
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-700">
                  {TITLES[step.type] ?? step.type}
                  {step.progressTotal > 0 && step.status === 'RUNNING' && (
                    <span className="ml-2 text-ink-500">
                      {step.progressDone}/{step.progressTotal}
                    </span>
                  )}
                </p>

                {(step.errorMessage ?? step.message) && (
                  <p
                    className={`truncate text-xs ${
                      step.errorMessage ? 'text-score-bad' : 'text-ink-500'
                    }`}
                    title={step.errorMessage ?? step.message ?? ''}
                  >
                    {step.errorMessage ?? step.message}
                  </p>
                )}
              </div>

              {(step.status === 'FAILED' || step.status === 'SKIPPED') && (
                <button
                  onClick={() => void retry(step.type)}
                  disabled={retrying !== null}
                  className="shrink-0 rounded-lg border border-ink-300 px-3 py-1 text-xs font-medium text-ink-700 hover:bg-ink-100 disabled:opacity-50"
                >
                  {retrying === step.type ? 'Executando...' : 'Tentar de novo'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
