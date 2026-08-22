import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { auth } from '@/server/auth';
import { workspaceService } from '@/server/growth/services/WorkspaceService';
import { MODE_LABEL } from '@/server/growth/policy/approvalPolicy';

const NAV = [
  { href: '/growth', label: 'Painel' },
  { href: '/growth/conteudo', label: 'Conteúdo' },
  { href: '/growth/conversas', label: 'Conversas' },
  { href: '/growth/vendas', label: 'Vendas' },
  { href: '/growth/configuracoes', label: 'Configurações' },
];

const MODE_TONE = {
  MANUAL: 'bg-ink-100 text-ink-700',
  SEMI_AUTOMATIC: 'bg-amber-100 text-amber-800',
  AUTONOMOUS: 'bg-emerald-100 text-emerald-800',
} as const;

export default async function GrowthLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const workspace = await workspaceService.ensureForUser(session.user.id);

  return (
    <div className="min-h-screen">
      <header className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <Link href="/growth" className="text-lg font-semibold text-ink-900">
              Growth Engine
            </Link>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${MODE_TONE[workspace.mode]}`}
              title="Modo de operação: define o que o sistema faz sem aprovação humana"
            >
              modo {MODE_LABEL[workspace.mode]}
            </span>
          </div>

          <nav className="flex flex-wrap gap-1 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-1.5 text-ink-700 hover:bg-ink-100"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
