'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Step = 'imovel' | 'dados' | 'executando';

interface UploadState {
  csv: { name: string; rows: number; warnings: number } | null;
  photos: { accepted: number; rejected: number } | null;
  airbnb: boolean;
  booking: boolean;
}

/**
 * Wizard de criação de análise.
 *
 * A análise é criada no primeiro passo e os dados são anexados um a um, para
 * que um upload que falhe não perca o que já foi enviado.
 */
export function NewAnalysisForm() {
  const router = useRouter();

  const [step, setStep] = useState<Step>('imovel');
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadState>({
    csv: null,
    photos: null,
    airbnb: false,
    booking: false,
  });

  async function call<T>(
    url: string,
    init: RequestInit,
    label: string,
  ): Promise<T | null> {
    setBusy(label);
    setError(null);

    try {
      const response = await fetch(url, init);
      const body = (await response.json().catch(() => null)) as
        | (T & { error?: string })
        | null;

      if (!response.ok) {
        setError(body?.error ?? 'Não foi possível concluir a operação.');
        return null;
      }

      return body as T;
    } catch {
      setError('Falha de rede. Verifique a conexão e tente novamente.');
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function createAnalysis(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const result = await call<{ id: string }>(
      '/api/analyses',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(form.get('name') ?? ''),
          city: String(form.get('city') ?? '') || undefined,
          propertyType: String(form.get('propertyType') ?? '') || undefined,
          bedrooms: String(form.get('bedrooms') ?? '') || undefined,
        }),
      },
      'criando',
    );

    if (result) {
      setAnalysisId(result.id);
      setStep('dados');
    }
  }

  async function uploadCsv(file: File) {
    const body = new FormData();
    body.append('file', file);

    const result = await call<{ rowCount: number; warnings: unknown[] }>(
      `/api/analyses/${analysisId}/pricing`,
      { method: 'POST', body },
      'csv',
    );

    if (result) {
      setUploads((u) => ({
        ...u,
        csv: {
          name: file.name,
          rows: result.rowCount,
          warnings: result.warnings.length,
        },
      }));
    }
  }

  async function uploadPhotos(files: FileList) {
    const body = new FormData();
    for (const file of files) body.append('files', file);

    const result = await call<{ accepted: number; rejected: unknown[] }>(
      `/api/analyses/${analysisId}/photos`,
      { method: 'POST', body },
      'fotos',
    );

    if (result) {
      setUploads((u) => ({
        ...u,
        photos: { accepted: result.accepted, rejected: result.rejected.length },
      }));
    }
  }

  async function useMockListing(platform: 'AIRBNB' | 'BOOKING') {
    const result = await call(
      `/api/analyses/${analysisId}/listing`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, useMock: true }),
      },
      platform,
    );

    if (result) {
      setUploads((u) => ({
        ...u,
        [platform === 'AIRBNB' ? 'airbnb' : 'booking']: true,
      }));
    }
  }

  async function runAnalysis() {
    setStep('executando');

    const result = await call(
      `/api/analyses/${analysisId}/run`,
      { method: 'POST' },
      'executando',
    );

    if (result) {
      router.push(`/analises/${analysisId}`);
      router.refresh();
    } else {
      setStep('dados');
    }
  }

  const hasAnyData =
    uploads.csv !== null ||
    uploads.photos !== null ||
    uploads.airbnb ||
    uploads.booking;

  return (
    <div className="space-y-6">
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-score-bad/30 bg-score-bad/5 px-4 py-3 text-sm text-score-bad"
        >
          {error}
        </p>
      )}

      {step === 'imovel' && (
        <form onSubmit={createAnalysis} className="space-y-4">
          <Card title="1. Sobre o imóvel">
            <Field name="name" label="Nome do imóvel" required
              placeholder="Ex.: Apartamento Beira-Mar 2 quartos" />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field name="city" label="Cidade" placeholder="Florianópolis" />
              <Field name="propertyType" label="Tipo" placeholder="Apartamento" />
              <Field name="bedrooms" label="Quartos" type="number" placeholder="2" />
            </div>
          </Card>

          <button
            type="submit"
            disabled={busy !== null}
            className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {busy === 'criando' ? 'Criando...' : 'Continuar'}
          </button>
        </form>
      )}

      {step === 'dados' && (
        <div className="space-y-4">
          <Card title="2. Dados de pricing (opcional)">
            <p className="text-sm text-ink-500">
              CSV exportado do PriceLabs. O parser aceita ponto e vírgula,
              vírgula decimal e cabeçalhos em português ou inglês.
            </p>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy !== null}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadCsv(file);
              }}
              className="mt-3 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-ink-100 file:px-4 file:py-2 file:text-sm file:font-medium"
            />
            {uploads.csv && (
              <Done>
                {uploads.csv.name} — {uploads.csv.rows} dias importados
                {uploads.csv.warnings > 0 && `, ${uploads.csv.warnings} aviso(s)`}
              </Done>
            )}
          </Card>

          <Card title="3. Fotos do anúncio (opcional)">
            <p className="text-sm text-ink-500">
              A ordem dos arquivos é a ordem no anúncio: a primeira é a capa.
              As imagens são analisadas e <strong>não são armazenadas</strong>.
            </p>
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={busy !== null}
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length > 0) void uploadPhotos(files);
              }}
              className="mt-3 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-ink-100 file:px-4 file:py-2 file:text-sm file:font-medium"
            />
            {uploads.photos && (
              <Done>
                {uploads.photos.accepted} foto(s) aceita(s)
                {uploads.photos.rejected > 0 &&
                  `, ${uploads.photos.rejected} recusada(s)`}
              </Done>
            )}
          </Card>

          <Card title="4. Anúncios (opcional)">
            <p className="text-sm text-ink-500">
              Não fazemos coleta automatizada — os Termos de Serviço das
              plataformas proíbem. Para esta demonstração, use os dados de
              exemplo; o formulário de preenchimento manual entra em seguida.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <MockButton
                label="Usar exemplo do Airbnb"
                done={uploads.airbnb}
                busy={busy === 'AIRBNB'}
                onClick={() => void useMockListing('AIRBNB')}
              />
              <MockButton
                label="Usar exemplo do Booking.com"
                done={uploads.booking}
                busy={busy === 'BOOKING'}
                onClick={() => void useMockListing('BOOKING')}
              />
            </div>
          </Card>

          <div className="flex items-center gap-3">
            <button
              onClick={() => void runAnalysis()}
              disabled={busy !== null || !hasAnyData}
              className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              Executar análise
            </button>
            {!hasAnyData && (
              <span className="text-sm text-ink-500">
                Envie ao menos um tipo de dado para continuar.
              </span>
            )}
          </div>
        </div>
      )}

      {step === 'executando' && (
        <Card title="Analisando...">
          <p className="text-sm text-ink-500">
            Processando pricing, fotos e anúncios. Isso leva alguns segundos.
          </p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-ink-100">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-brand-500" />
          </div>
        </Card>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-ink-100 bg-white p-5">
      <h2 className="mb-3 text-base font-semibold text-ink-900">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({
  name,
  label,
  type = 'text',
  required,
  placeholder,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink-700">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
      />
    </label>
  );
}

function Done({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 rounded-lg bg-score-good/10 px-3 py-2 text-sm text-score-good">
      ✓ {children}
    </p>
  );
}

function MockButton({
  label,
  done,
  busy,
  onClick,
}: {
  label: string;
  done: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy || done}
      className="rounded-lg border border-ink-300 px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100 disabled:opacity-60"
    >
      {done ? '✓ ' : ''}
      {busy ? 'Carregando...' : label}
    </button>
  );
}
