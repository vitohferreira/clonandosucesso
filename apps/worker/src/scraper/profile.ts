import { collection } from '@molde/config';
import { BlockedError, ItemSkipped } from '@molde/shared';
import type { Logger } from '../logger';
import { conferirBloqueio, type Sessao } from './browser';
import { conferirPagina } from './guard';
import { pausaDeNavegacao, pausaEntreAcoes, rolarAosPoucos, mexerOMouse } from './human';
import {
  extrairComentarios,
  extrairMidias,
  extrairPerfil,
  type MidiaColetada,
  type PerfilColetado,
} from './parse';
import { contarNavegacao } from './limits';
import { DOM, URLS, shortcodeDaUrl } from './selectors';

/**
 * A coleta propriamente dita.
 *
 * Somente leitura: nao existe neste arquivo nenhum caminho que siga, curta,
 * comente ou interaja de qualquer forma. So navegar e ler.
 */

/** Tenta uma lista de seletores em ordem; devolve o texto do primeiro que existir. */
async function primeiroTexto(sessao: Sessao, candidatos: readonly string[]): Promise<string | null> {
  for (const seletor of candidatos) {
    try {
      const elemento = sessao.page.locator(seletor).first();
      if ((await elemento.count()) > 0) {
        const texto = (await elemento.innerText({ timeout: 3_000 })).trim();
        if (texto) return texto;
      }
    } catch {
      // Seletor que nao casa e esperado: e para isso que existe a lista.
    }
  }
  return null;
}

export async function visitarPerfil(
  sessao: Sessao,
  handle: string,
  log: Logger,
  jobId: string,
): Promise<PerfilColetado> {
  await contarNavegacao(log, jobId, `perfil:${handle}`);

  await sessao.page.goto(URLS.profile(handle), { waitUntil: 'domcontentloaded' });
  await pausaDeNavegacao();

  await conferirPagina(sessao.page, handle);
  conferirBloqueio(sessao);

  // Perfil privado: a ferramenta nao coleta, por decisao de projeto.
  const avisoPrivado = await primeiroTexto(sessao, DOM.perfilPrivado);
  if (avisoPrivado && /privad|private/i.test(avisoPrivado)) {
    throw new BlockedError('private_profile', `@${handle} e privado.`);
  }

  const perfil = extrairPerfil(sessao.cargas, handle);

  if (!perfil) {
    // O JSON nao veio no formato esperado. Caimos para o DOM, que da menos
    // campo mas prova que a pagina existe.
    const nome = await primeiroTexto(sessao, DOM.nomeCompleto);
    if (!nome) {
      throw new ItemSkipped(
        `perfil:${handle}`,
        'Nao consegui ler o perfil nem pelo JSON nem pelo DOM. Confira os seletores em scraper/selectors.ts.',
      );
    }

    log.warn('perfil lido pelo DOM — o formato do JSON deve ter mudado', { handle });
    return {
      handle,
      fullName: nome,
      bio: await primeiroTexto(sessao, DOM.bio),
      externalUrl: null,
      category: null,
      isVerified: null,
      isPrivate: false,
      avatarUrl: null,
      followers: null,
      following: null,
      postsCount: null,
    };
  }

  if (perfil.isPrivate) {
    throw new BlockedError('private_profile', `@${handle} e privado.`);
  }

  log.info('perfil lido', {
    handle: perfil.handle,
    seguidores: perfil.followers,
    posts: perfil.postsCount,
  });

  return perfil;
}

/**
 * Percorre a grade rolando aos poucos, ate juntar o suficiente.
 *
 * O grosso do dado vem do JSON que a propria pagina busca ao rolar — por isso
 * rolar a grade custa muito pouco em teto e nao exige abrir post nenhum.
 */
export async function coletarGrade(
  sessao: Sessao,
  log: Logger,
  maximo = collection.maxPostsPerProfile,
): Promise<MidiaColetada[]> {
  let colhidos: MidiaColetada[] = [];

  await rolarAosPoucos(sessao.page, async () => {
    conferirBloqueio(sessao);
    colhidos = extrairMidias(sessao.cargas);

    // Rede de seguranca: se o JSON falhar, ao menos os shortcodes saem do DOM.
    if (colhidos.length === 0) {
      const links = await lerLinksDaGrade(sessao);
      colhidos = links.map((shortcode) => ({
        shortcode,
        type: 'unknown' as const,
        url: URLS.post(shortcode),
        thumbnailUrl: null,
        caption: null,
        likeCount: null,
        commentCount: null,
        viewCount: null,
        videoDurationSeconds: null,
        carouselCount: null,
        isPinned: false,
        postedAt: null,
        videoUrl: null,
      }));
      if (colhidos.length > 0) {
        log.warn('grade lida pelo DOM — o formato do JSON deve ter mudado');
      }
    }

    return { suficiente: colhidos.length >= maximo, total: colhidos.length };
  });

  log.info('grade coletada', { posts: colhidos.length });
  return colhidos.slice(0, maximo);
}

async function lerLinksDaGrade(sessao: Sessao): Promise<string[]> {
  const codigos = new Set<string>();

  for (const seletor of DOM.linksDaGrade) {
    try {
      const hrefs = await sessao.page.locator(seletor).evaluateAll((nos) =>
        nos.map((n) => (n as { getAttribute(nome: string): string | null }).getAttribute('href') ?? ''),
      );
      for (const href of hrefs) {
        const codigo = shortcodeDaUrl(href);
        if (codigo) codigos.add(codigo);
      }
    } catch {
      // Proximo candidato.
    }
  }

  return [...codigos];
}

/**
 * Abre um post para pegar o que a grade nao deu.
 *
 * Cada abertura consome teto diario, entao so vale a pena quando falta dado que
 * importa — quem decide isso e o handler, nao esta funcao.
 */
export async function visitarPost(
  sessao: Sessao,
  shortcode: string,
  log: Logger,
  jobId: string,
  opcoes: { lerComentarios?: boolean } = {},
): Promise<{ midia: MidiaColetada | null; comentarios: Array<{ text: string; likeCount: number | null }> }> {
  await contarNavegacao(log, jobId, `post:${shortcode}`);

  const antes = sessao.cargas.length;
  await mexerOMouse(sessao.page);
  await sessao.page.goto(URLS.post(shortcode), { waitUntil: 'domcontentloaded' });
  await pausaDeNavegacao();

  await conferirPagina(sessao.page, shortcode);
  conferirBloqueio(sessao);

  // So o que chegou depois desta navegacao interessa para este post.
  const novas = sessao.cargas.slice(antes);
  const midia = extrairMidias(novas).find((m) => m.shortcode === shortcode) ?? null;

  let comentarios: Array<{ text: string; likeCount: number | null }> = [];
  if (opcoes.lerComentarios) {
    await pausaEntreAcoes();
    comentarios = extrairComentarios(sessao.cargas.slice(antes), collection.maxCommentsPerPost);
  }

  if (!midia) {
    log.warn('post aberto mas sem dado legivel', { shortcode });
  }

  return { midia, comentarios };
}

/** Destaques (stories fixados): titulo e ordem. */
export async function coletarDestaques(
  sessao: Sessao,
  log: Logger,
): Promise<Array<{ title: string; position: number }>> {
  for (const seletor of DOM.destaques) {
    try {
      const textos = await sessao.page.locator(seletor).allInnerTexts();
      const titulos = textos
        .map((t) => t.trim().split('\n')[0]?.trim() ?? '')
        .filter((t) => t.length > 0 && t.length < 60);

      if (titulos.length > 0) {
        return titulos.map((title, i) => ({ title, position: i }));
      }
    } catch {
      // Proximo candidato.
    }
  }

  log.debug('nenhum destaque encontrado');
  return [];
}

/** Perfis que o proprio Instagram sugere na pagina — fonte da Fase 4. */
export async function coletarSugestoes(sessao: Sessao): Promise<string[]> {
  const handles = new Set<string>();

  for (const seletor of DOM.sugestoes) {
    try {
      const hrefs = await sessao.page.locator(seletor).evaluateAll((nos) =>
        nos.map((n) => (n as { getAttribute(nome: string): string | null }).getAttribute('href') ?? ''),
      );
      for (const href of hrefs) {
        const limpo = href.replace(/^\//, '').replace(/\/$/, '');
        if (limpo && /^[a-z0-9._]{1,30}$/i.test(limpo)) handles.add(limpo.toLowerCase());
      }
    } catch {
      // Proximo candidato.
    }
  }

  return [...handles];
}
