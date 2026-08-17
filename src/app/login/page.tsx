'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useState } from 'react';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const formData = new FormData(event.currentTarget);

    const result = await signIn('credentials', {
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      redirect: false,
    });

    setPending(false);

    if (result?.error) {
      // Mensagem genérica de propósito: não revelamos se o e-mail existe.
      setError('E-mail ou senha inválidos.');
      return;
    }

    router.push('/');
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold text-ink-900">Entrar</h1>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <Field label="E-mail" name="email" type="email" autoComplete="email" />
        <Field
          label="Senha"
          name="password"
          type="password"
          autoComplete="current-password"
        />

        {error && (
          <p role="alert" className="text-sm text-score-bad">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {pending ? 'Entrando...' : 'Entrar'}
        </button>
      </form>

      <p className="mt-6 text-sm text-ink-500">
        Não tem conta?{' '}
        <Link href="/register" className="text-brand-500 hover:underline">
          Criar conta
        </Link>
      </p>
    </main>
  );
}

function Field({
  label,
  name,
  type,
  autoComplete,
}: {
  label: string;
  name: string;
  type: string;
  autoComplete: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink-700">{label}</span>
      <input
        name={name}
        type={type}
        required
        autoComplete={autoComplete}
        className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
      />
    </label>
  );
}
