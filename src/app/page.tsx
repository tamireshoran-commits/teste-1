import Link from 'next/link';
import { auth } from '@/server/auth';

/**
 * Landing mínima da Etapa 0.
 * O dashboard completo entra na Etapa 6, quando houver scores para exibir.
 */
export default async function HomePage() {
  const session = await auth();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <div>
        <h1 className="text-4xl font-semibold tracking-tight text-ink-900">
          StayScore
        </h1>
        <p className="mt-3 text-lg text-ink-500">
          Análise de competitividade para imóveis de aluguel por temporada.
        </p>
      </div>

      <section className="rounded-xl border border-ink-100 bg-white p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Estado do MVP
        </h2>

        <ul className="mt-4 space-y-2 text-sm text-ink-700">
          <li>✅ Etapa 0 — fundação: banco, autenticação, testes e CI</li>
          <li>✅ Etapa 1 — contratos de domínio e prompts versionados</li>
          <li>✅ Etapa 2 — pricing: importação de CSV do PriceLabs e score</li>
          <li>⏳ Etapa 3 — análise de fotos com IA</li>
          <li>⏳ Etapa 4 — Airbnb e Booking (entrada manual e mock)</li>
          <li>⏳ Etapa 5 — motor de recomendações</li>
          <li>⏳ Etapa 6 — dashboard e relatório</li>
        </ul>
      </section>

      <section className="rounded-xl border border-ink-100 bg-white p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Growth Engine
        </h2>
        <p className="mt-3 text-sm text-ink-700">
          Marketing e vendas operados por agentes de IA: pesquisa de mercado,
          calendário de conteúdo, publicação no Instagram/Facebook, qualificação
          de leads e vendas por conversa — com aprovação humana no meio.
        </p>
        <Link
          href="/growth"
          className="mt-4 inline-block text-sm font-medium text-brand-500 hover:text-brand-600"
        >
          Abrir o painel →
        </Link>
      </section>

      <div className="flex gap-3">
        {session?.user ? (
          <span className="text-sm text-ink-700">
            Autenticado como <strong>{session.user.email}</strong>
          </span>
        ) : (
          <>
            <Link
              href="/login"
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
            >
              Entrar
            </Link>
            <Link
              href="/register"
              className="rounded-lg border border-ink-300 px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100"
            >
              Criar conta
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
