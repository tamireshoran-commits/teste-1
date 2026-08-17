import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ScoreCard, ScoreDial } from '@/components/ScoreDial';
import { buildPhotoSetInsights } from '@/server/core/analysis/photos/insights';
import { auth } from '@/server/auth';
import { NotFoundError } from '@/server/core/shared/errors';
import type {
  Finding,
  Opportunity,
  PhotoAnalysisResult,
  ScoreResult,
} from '@/server/core/types';
import { analysisService } from '@/server/services/AnalysisService';
import { StepList } from './StepList';

const IMPACT_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const { id } = await params;

  const analysis = await analysisService
    .getForUser(id, session.user.id)
    .catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    });

  // Colunas Json chegam tipadas como JsonValue; o formato gravado é conhecido
  // (foi este código que gravou), então a conversão passa por unknown.
  const pricingProblems = (analysis.pricingAnalysis?.problems ??
    []) as unknown as Finding[];
  const pricingOpportunities = (analysis.pricingAnalysis?.opportunities ??
    []) as unknown as Opportunity[];

  const listingProblems = analysis.listingAnalyses.flatMap((l) =>
    ((l.scoreBreakdown as unknown as ScoreResult | null)?.components ?? [])
      .filter((c) => c.available && (c.score ?? 100) < 50)
      .map<Finding>((c) => ({
        code: `${l.platform}_${c.key}`,
        title: `${l.platform === 'AIRBNB' ? 'Airbnb' : 'Booking'}: ${c.label}`,
        detail: c.reason,
        severity: (c.score ?? 100) < 30 ? 'HIGH' : 'MEDIUM',
      })),
  );

  const photoResults: PhotoAnalysisResult[] = analysis.photos
    .filter((p) => p.result?.status === 'DONE' && p.result.score !== null)
    .map((p) => ({
      photoId: p.id,
      roomType: p.result!.roomType ?? 'outro',
      visualQuality: p.result!.visualQuality ?? 0,
      lighting: p.result!.lighting ?? 0,
      composition: p.result!.composition ?? 0,
      professionalism: p.result!.professionalism ?? 0,
      valuePerception: p.result!.valuePerception ?? 0,
      clarity: p.result!.clarity ?? 0,
      strengths: (p.result!.strengths ?? []) as string[],
      problems: (p.result!.problems ?? []) as string[],
      recommendations: (p.result!.recommendations ?? []) as string[],
      score: p.result!.score!,
      provider: p.result!.provider ?? '',
      model: p.result!.model ?? '',
      fromCache: p.result!.fromCache,
    }));

  const insights =
    photoResults.length > 0 ? buildPhotoSetInsights(photoResults) : null;

  const allProblems = [...pricingProblems, ...listingProblems].sort(
    (a, b) => IMPACT_ORDER[a.severity] - IMPACT_ORDER[b.severity],
  );

  const fixFirst = allProblems.filter((p) => p.severity === 'HIGH').slice(0, 5);
  const improvements = allProblems.filter((p) => p.severity !== 'HIGH');

  const strengths = [
    ...analysis.listingAnalyses.flatMap((l) => (l.strengths ?? []) as string[]),
    ...(insights?.bestPhotoId
      ? [
          `Melhor foto: ${
            analysis.photos.find((p) => p.id === insights.bestPhotoId)
              ?.originalName ?? '—'
          }`,
        ]
      : []),
  ].slice(0, 8);

  const hasMock = analysis.listings.some((l) => l.isMock);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/analises" className="text-sm text-brand-500 hover:underline">
        ← Minhas análises
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
            {analysis.property.name}
          </h1>
          <p className="mt-1 text-ink-500">
            Análise de Competitividade
            {analysis.property.city && ` · ${analysis.property.city}`}
          </p>
        </div>

        <ScoreDial score={analysis.overallScore} label="Score geral" />
      </header>

      {hasMock && (
        <p className="mt-4 rounded-lg border border-score-mid/40 bg-score-mid/10 px-4 py-3 text-sm text-score-mid">
          ⚠️ Esta análise usa <strong>dados de exemplo</strong> para os anúncios.
          Os números não representam um imóvel real.
        </p>
      )}

      <StepList analysisId={analysis.id} initialSteps={analysis.steps} />

      <section className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ScoreCard label="Airbnb" score={analysis.airbnbScore}
          note="Anúncio não informado" />
        <ScoreCard label="Booking.com" score={analysis.bookingScore}
          note="Anúncio não informado" />
        <ScoreCard label="Pricing" score={analysis.pricingScore}
          note="CSV não enviado" />
        <ScoreCard label="Fotos" score={analysis.photoScore}
          note="Fotos não enviadas" />
        <ScoreCard label="Conteúdo" score={analysis.contentScore}
          note="Requer um anúncio" />
        <ScoreCard label="Reputação" score={analysis.reputationScore}
          note="Requer um anúncio" />
      </section>

      <Block
        title="🔴 Corrija primeiro"
        empty="Nenhum problema de alta severidade foi encontrado."
        items={fixFirst.map((p) => ({
          title: p.title,
          detail: p.detail,
        }))}
      />

      <Block
        title="🟡 Melhorias recomendadas"
        empty="Nada de severidade média ou baixa pendente."
        items={[
          ...improvements.map((p) => ({ title: p.title, detail: p.detail })),
          ...pricingOpportunities.map((o) => ({
            title: o.title,
            detail: `${o.detail} (${o.framing})`,
          })),
        ].slice(0, 8)}
      />

      <Block
        title="🟢 Pontos fortes"
        empty="Ainda não há pontos fortes identificados."
        items={strengths.map((s) => ({ title: s }))}
        tone="good"
      />

      {analysis.pricingAnalysis && (
        <section className="mt-8 rounded-xl border border-ink-100 bg-white p-5">
          <h2 className="text-base font-semibold text-ink-900">
            Resumo de pricing
          </h2>
          <p className="mt-2 text-sm text-ink-700">
            {
              (analysis.pricingAnalysis.metrics as { summary?: string })
                .summary ?? ''
            }
          </p>
          <ul className="mt-3 space-y-1 text-sm text-ink-500">
            {(
              (analysis.pricingAnalysis
                .scoreBreakdown as unknown as ScoreResult).components ?? []
            ).map((c) => (
              <li key={c.key}>
                {c.available ? '✓' : '—'} <strong>{c.label}:</strong>{' '}
                {c.score ?? 'n/d'} — {c.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      {photoResults.length > 0 && insights && (
        <section className="mt-8 rounded-xl border border-ink-100 bg-white p-5">
          <h2 className="text-base font-semibold text-ink-900">
            Fotos ({photoResults.length} analisadas)
          </h2>

          {insights.missingRooms.length > 0 && (
            <p className="mt-2 text-sm text-ink-700">
              Sem foto de: <strong>{insights.missingRooms.join(', ')}</strong>.
            </p>
          )}

          <ul className="mt-3 divide-y divide-ink-100 text-sm">
            {analysis.photos
              .filter((p) => p.result?.score !== null)
              .map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2">
                  <span className="text-ink-700">
                    #{p.position + 1} {p.originalName}
                    <span className="ml-2 text-ink-500">
                      {p.result?.roomType}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">
                    {p.result?.score ?? '—'}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}

      <footer className="mt-8 text-xs text-ink-500">
        Custo estimado desta análise: US${' '}
        {analysis.estimatedCostUsd.toFixed(4)}
        {analysis.estimatedCostUsd === 0 &&
          ' (preços não configurados; os tokens foram registrados)'}
      </footer>
    </main>
  );
}

function Block({
  title,
  items,
  empty,
  tone = 'default',
}: {
  title: string;
  items: Array<{ title: string; detail?: string }>;
  empty: string;
  tone?: 'default' | 'good';
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-ink-900">{title}</h2>

      {items.length === 0 ? (
        <p className="mt-2 text-sm text-ink-500">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item, i) => (
            <li
              key={`${item.title}-${i}`}
              className="rounded-xl border border-ink-100 bg-white p-4"
            >
              <p
                className={`font-medium ${
                  tone === 'good' ? 'text-score-good' : 'text-ink-900'
                }`}
              >
                {item.title}
              </p>
              {item.detail && (
                <p className="mt-1 text-sm text-ink-500">{item.detail}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
