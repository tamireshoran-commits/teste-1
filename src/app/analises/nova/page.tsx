import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { NewAnalysisForm } from './NewAnalysisForm';

export default async function NewAnalysisPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/analises" className="text-sm text-brand-500 hover:underline">
        ← Minhas análises
      </Link>

      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-ink-900">
        Nova análise
      </h1>
      <p className="mt-2 mb-8 text-ink-500">
        Envie o que tiver. Cada bloco é opcional, e o diagnóstico informa o que
        ficou de fora por falta de dado.
      </p>

      <NewAnalysisForm />
    </main>
  );
}
