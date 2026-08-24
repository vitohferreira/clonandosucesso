import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_NAME, verifySessionToken } from '@/lib/auth';

/**
 * Proxy (era "middleware" ate o Next 15). Roda antes de toda requisicao.
 *
 * Nada e publico. Sem cookie valido, pagina redireciona para /login e API
 * responde 401 — e nao um redirect, que o fetch do cliente interpretaria errado.
 */
export async function proxy(request: NextRequest) {
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return new NextResponse(
      'SESSION_SECRET nao configurado. Copie .env.example para .env na raiz.',
      { status: 500 },
    );
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (await verifySessionToken(token, secret)) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'nao autenticado' }, { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    /*
     * Tudo, menos:
     *   /login       — a propria tela de senha
     *   /api/auth    — o endpoint que valida a senha
     *   assets do Next e favicon
     */
    '/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)',
  ],
};
