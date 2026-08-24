'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LogoMark } from '@/components/Logo';

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const response = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    setLoading(false);

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? 'não consegui entrar');
      return;
    }

    router.push('/');
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-[19rem]">
        <LogoMark size={30} />
        <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight">Molde</h1>
        <p className="mt-1.5 text-[13px] text-ink-faint">
          Engenharia reversa de conteúdo
        </p>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="senha"
          autoFocus
          autoComplete="current-password"
          className="mt-8 w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px] outline-none transition-colors placeholder:text-ink-faint focus:border-line-bright"
        />

        {error && <p className="mt-3 text-[13px] text-bad">{error}</p>}

        <button
          type="submit"
          disabled={loading || !password}
          className="mt-3 w-full rounded-xl bg-ink px-3.5 py-2.5 text-[14px] font-medium text-void transition-opacity hover:opacity-90 disabled:opacity-30"
        >
          {loading ? 'entrando…' : 'entrar'}
        </button>
      </form>
    </main>
  );
}
