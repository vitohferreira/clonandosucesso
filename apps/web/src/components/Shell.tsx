'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Logo } from './Logo';

// A biblioteca de ganchos esta congelada nesta etapa: a página continua no
// repositório, só não tem porta de entrada. Religar é devolver a linha.
const NAV = [
  { href: '/perfis', label: 'Perfis' },
  { href: '/videos', label: 'Vídeos' },
  { href: '/', label: 'Fila' },
];

/** Moldura comum das telas: marca, navegação e sair. */
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function sair() {
    await fetch('/api/auth', { method: 'DELETE' });
    router.push('/login');
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-void/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-3.5">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <Logo />
          </Link>

          <nav className="flex items-center gap-1">
            {NAV.map((item) => {
              const ativo =
                item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    ativo
                      ? 'bg-raised text-ink'
                      : 'text-ink-faint hover:bg-surface hover:text-ink-dim'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <button
            onClick={sair}
            className="ml-auto text-[12px] text-ink-faint transition-colors hover:text-ink-dim"
          >
            sair
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-10">{children}</div>
    </div>
  );
}

/** Cabeçalho de seção, com o título e um resumo curto. */
export function PageHead({
  titulo,
  descricao,
  acao,
}: {
  titulo: string;
  descricao?: string;
  acao?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{titulo}</h1>
        {descricao && <p className="mt-1.5 max-w-xl text-[13px] text-ink-faint">{descricao}</p>}
      </div>
      {acao}
    </div>
  );
}
