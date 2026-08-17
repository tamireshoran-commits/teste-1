'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useState } from 'react';

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');

    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: String(formData.get('name') ?? ''),
        email,
        password,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: string; issues?: Array<{ message: string }> }
        | null;

      setPending(false);
      setError(
        body?.issues?.[0]?.message ?? body?.error ?? 'Não foi possível criar a conta.',
      );
      return;
    }

    await signIn('credentials', { email, password, redirect: false });
    setPending(false);
    router.push('/');
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold text-ink-900">Criar conta</h1>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <Field label="Nome" name="name" type="text" autoComplete="name" />
        <Field label="E-mail" name="email" type="email" autoComplete="email" />
        <Field
          label="Senha"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          hint="Mínimo de 8 caracteres."
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
          {pending ? 'Criando...' : 'Criar conta'}
        </button>
      </form>

      <p className="mt-6 text-sm text-ink-500">
        Já tem conta?{' '}
        <Link href="/login" className="text-brand-500 hover:underline">
          Entrar
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
  minLength,
  hint,
}: {
  label: string;
  name: string;
  type: string;
  autoComplete: string;
  minLength?: number;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink-700">{label}</span>
      <input
        name={name}
        type={type}
        required
        autoComplete={autoComplete}
        {...(minLength !== undefined ? { minLength } : {})}
        className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
      />
      {hint && <span className="mt-1 block text-xs text-ink-500">{hint}</span>}
    </label>
  );
}
