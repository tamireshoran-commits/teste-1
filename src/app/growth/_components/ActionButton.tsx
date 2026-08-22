'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

/**
 * Botão que chama a API e recarrega os dados do servidor.
 *
 * O painel é feito de Server Components: depois da ação, `router.refresh()`
 * refaz a consulta no servidor em vez de o cliente manter uma cópia do estado.
 * É o que garante que "aprovado" na tela signifique aprovado no banco.
 */
export function ActionButton({
  endpoint,
  body,
  method = 'POST',
  children,
  variant = 'primary',
  confirmMessage,
  onDone,
}: {
  endpoint: string;
  body?: unknown;
  method?: 'POST' | 'PATCH' | 'PUT';
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
  confirmMessage?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (confirmMessage !== undefined && !window.confirm(confirmMessage)) return;

    setPending(true);
    setError(null);

    try {
      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;

        setError(payload?.error ?? `Falha (${response.status})`);
        return;
      }

      onDone?.();
      router.refresh();
    } catch {
      setError('Falha de rede.');
    } finally {
      setPending(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void run()}
        disabled={pending}
        className={`${VARIANTS[variant]} rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50`}
      >
        {pending ? 'Enviando…' : children}
      </button>
      {error !== null && (
        <span className="text-xs text-score-bad">{error}</span>
      )}
    </span>
  );
}

const VARIANTS = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600',
  secondary: 'border border-ink-300 text-ink-700 hover:bg-ink-100',
  danger: 'border border-score-bad text-score-bad hover:bg-red-50',
} as const;
