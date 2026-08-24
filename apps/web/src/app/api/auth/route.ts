import { NextResponse } from 'next/server';
import { COOKIE_NAME, createSessionToken, passwordMatches, sessionCookieOptions } from '@/lib/auth';

export const runtime = 'nodejs';

/** Troca a senha por um cookie de sessao assinado. */
export async function POST(request: Request) {
  const appPassword = process.env.APP_PASSWORD;
  const secret = process.env.SESSION_SECRET;

  if (!appPassword || !secret) {
    return NextResponse.json(
      { error: 'APP_PASSWORD e SESSION_SECRET precisam estar configurados' },
      { status: 500 },
    );
  }

  let password = '';
  try {
    const body = (await request.json()) as { password?: unknown };
    password = typeof body.password === 'string' ? body.password : '';
  } catch {
    return NextResponse.json({ error: 'corpo invalido' }, { status: 400 });
  }

  if (!(await passwordMatches(password, appPassword, secret))) {
    // Atraso pequeno e constante: nao acelera quem estiver tentando na forca bruta.
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ error: 'senha incorreta' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, await createSessionToken(secret), sessionCookieOptions);
  return response;
}

/** Sair. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, '', { ...sessionCookieOptions, maxAge: 0 });
  return response;
}
