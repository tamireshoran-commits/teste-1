'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';

export interface FieldSpec {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'number' | 'date' | 'select';
  placeholder?: string;
  required?: boolean;
  defaultValue?: string | number;
  options?: Array<{ value: string; label: string }>;
  help?: string;
}

/**
 * Formulário genérico do painel.
 *
 * Um componente em vez de oito quase iguais: os formulários de estratégia,
 * plano, produto e conta só diferem nos campos e no endpoint. A conversão de
 * tipo acontece aqui (número vira número, lista vira array) para que a
 * validação Zod do servidor receba o formato que espera.
 */
export function JsonForm({
  endpoint,
  fields,
  submitLabel,
  successMessage,
  method = 'POST',
  listFields = [],
  children,
}: {
  endpoint: string;
  fields: FieldSpec[];
  submitLabel: string;
  successMessage?: string;
  method?: 'POST' | 'PUT' | 'PATCH';
  /** Campos cujo valor é uma lista separada por ";". */
  listFields?: string[];
  children?: ReactNode;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<
    { kind: 'ok' | 'error'; text: string } | null
  >(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    const formData = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {};

    for (const field of fields) {
      const raw = formData.get(field.name);
      if (raw === null || raw === '') continue;

      const value = String(raw);

      if (listFields.includes(field.name)) {
        payload[field.name] = value
          .split(';')
          .map((item) => item.trim())
          .filter((item) => item !== '');
      } else if (field.type === 'number') {
        payload[field.name] = Number(value);
      } else {
        payload[field.name] = value;
      }
    }

    try {
      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body = (await response.json().catch(() => null)) as {
        error?: string;
        details?: unknown;
      } | null;

      if (!response.ok) {
        setMessage({
          kind: 'error',
          text: body?.error ?? `Falha (${response.status})`,
        });
        return;
      }

      setMessage({
        kind: 'ok',
        text: successMessage ?? 'Enviado. O agente está processando na fila.',
      });

      event.currentTarget.reset();
      router.refresh();
    } catch {
      setMessage({ kind: 'error', text: 'Falha de rede.' });
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      {fields.map((field) => (
        <div key={field.name}>
          <label
            htmlFor={field.name}
            className="block text-sm font-medium text-ink-700"
          >
            {field.label}
          </label>

          {field.type === 'textarea' ? (
            <textarea
              id={field.name}
              name={field.name}
              rows={4}
              required={field.required}
              placeholder={field.placeholder}
              defaultValue={field.defaultValue}
              className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
            />
          ) : field.type === 'select' ? (
            <select
              id={field.name}
              name={field.name}
              defaultValue={field.defaultValue}
              className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
            >
              {(field.options ?? []).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={field.name}
              name={field.name}
              type={field.type ?? 'text'}
              required={field.required}
              placeholder={field.placeholder}
              defaultValue={field.defaultValue}
              className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
            />
          )}

          {field.help !== undefined && (
            <p className="mt-1 text-xs text-ink-500">{field.help}</p>
          )}
        </div>
      ))}

      {children}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {pending ? 'Enviando…' : submitLabel}
        </button>

        {message !== null && (
          <span
            className={`text-sm ${
              message.kind === 'ok' ? 'text-score-good' : 'text-score-bad'
            }`}
          >
            {message.text}
          </span>
        )}
      </div>
    </form>
  );
}
