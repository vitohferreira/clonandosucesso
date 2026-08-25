/**
 * TUDO que sabe a forma do Instagram mora neste arquivo.
 *
 * Quando o Instagram mudar — e ele vai —, conserta-se aqui e em lugar nenhum
 * mais. Nenhum outro arquivo do projeto pode conter seletor de DOM, caminho de
 * JSON ou URL do Instagram.
 *
 * ESTRATEGIA, em ordem de preferencia:
 *
 * 1. Interceptar o JSON que a propria pagina busca. E de longe o mais estavel:
 *    a classe CSS muda toda semana, a chave do payload quase nunca. E nao gera
 *    requisicao nova — so escutamos o que ja ia carregar.
 * 2. Cair para o DOM quando o JSON nao vier no formato esperado.
 *
 * Por isso as buscas de JSON aqui procuram por FORMA (tem `edge_media_to_caption`?
 * tem `shortcode`?) em vez de caminho fixo: assim uma reorganizacao do payload
 * nao quebra a coleta.
 */

export const URLS = {
  base: 'https://www.instagram.com',
  profile: (handle: string) => `https://www.instagram.com/${handle}/`,
  post: (shortcode: string) => `https://www.instagram.com/p/${shortcode}/`,
  reel: (shortcode: string) => `https://www.instagram.com/reel/${shortcode}/`,
  login: 'https://www.instagram.com/accounts/login/',
} as const;

/**
 * Padroes de URL que carregam dados. O worker escuta as respostas que batem
 * com um destes e guarda o corpo para garimpar depois.
 */
export const RESPOSTAS_DE_DADOS = [
  /\/api\/v1\/users\/web_profile_info/,
  /\/api\/v1\/feed\/user\//,
  /\/api\/v1\/media\/[0-9_]+\/info/,
  /\/api\/v1\/media\/[0-9_]+\/comments/,
  /\/graphql\/query/,
  /\/api\/graphql/,
] as const;

/**
 * Sinais de que fomos barrados. Qualquer um destes para o worker na hora.
 *
 * A ordem importa: o mais especifico primeiro, para o motivo registrado ser o
 * util e nao o generico.
 */
export const SINAIS_DE_BLOQUEIO: Array<{
  motivo:
    | 'checkpoint'
    | 'captcha'
    | 'rate_limit'
    | 'login_required'
    | 'account_disabled'
    | 'not_found';
  urls?: RegExp[];
  textos?: RegExp[];
}> = [
  {
    motivo: 'checkpoint',
    urls: [/\/challenge\//, /\/checkpoint\//],
    textos: [
      /confirme que .*(voc[eê]|é você)/i,
      /confirm it'?s you/i,
      /suspicious login/i,
      /atividade suspeita/i,
      /help us confirm/i,
    ],
  },
  {
    motivo: 'captcha',
    textos: [/captcha/i, /verifica[çc][ãa]o de seguran[çc]a/i, /security check/i],
  },
  {
    motivo: 'account_disabled',
    urls: [/\/accounts\/disabled/, /\/accounts\/suspended/],
    textos: [/conta (foi )?desativada/i, /account has been disabled/i],
  },
  {
    motivo: 'rate_limit',
    textos: [
      /please wait a few minutes/i,
      /aguarde alguns minutos/i,
      /try again later/i,
      /tente novamente mais tarde/i,
      /limite de a[çc][õo]es/i,
    ],
  },
  {
    motivo: 'login_required',
    urls: [/\/accounts\/login/],
    textos: [/fa[çc]a login para continuar/i, /log in to continue/i, /entrar no instagram/i],
  },
  {
    motivo: 'not_found',
    textos: [
      /p[áa]gina n[ãa]o dispon[íi]vel/i,
      /sorry, this page isn'?t available/i,
      /usu[áa]rio n[ãa]o encontrado/i,
    ],
  },
];

/**
 * Seletores de DOM, usados so quando o JSON falha.
 *
 * Cada campo e uma LISTA de candidatos, tentados em ordem. O Instagram nao tem
 * classe estavel, entao preferimos ancorar em atributo semantico (role, href,
 * aria) que sobrevive mais que classe gerada.
 */
export const DOM = {
  /** Marca de que a pagina do perfil carregou de fato. */
  perfilCarregado: ['header section', 'main header', 'header'],

  /** Contadores no cabecalho: publicacoes, seguidores, seguindo. */
  contadoresPerfil: [
    'header section ul li',
    'header ul li',
    'section main header li',
  ],

  /** Elementos que carregam o numero exato no title/aria (o texto e abreviado). */
  numeroExato: ['span[title]', 'span > span[title]', 'a > span > span'],

  /** Nome exibido. */
  nomeCompleto: ['header section h1', 'header h1', 'header h2'],

  /** Bio. */
  bio: ['header section > div > span', 'header section h1 + div', 'header section div span'],

  /** Link externo da bio. */
  linkExterno: ['header a[href^="https://l.instagram.com"]', 'header a[target="_blank"]'],

  /** Selo de verificado. */
  verificado: ['header svg[aria-label*="erifica"]', 'header svg[aria-label*="erified"]'],

  /** Aviso de perfil privado. */
  perfilPrivado: [
    'h2:has-text("Esta conta é privada")',
    'h2:has-text("This account is private")',
    'article h2',
  ],

  /** Links dos posts na grade. */
  linksDaGrade: ['main a[href*="/p/"]', 'main a[href*="/reel/"]', 'article a[href*="/p/"]'],

  /** Marcador visual de que o item da grade e um video/reel. */
  marcadorReel: ['svg[aria-label*="eel"]', 'svg[aria-label*="Clip"]', 'video'],

  /** Destaques (stories fixados). */
  destaques: [
    'header + div ul li button',
    'div[role="menuitem"]',
    'header ~ div li',
  ],

  /** Perfis sugeridos pelo proprio Instagram. */
  sugestoes: [
    'div:has-text("Sugestões para você") a[href^="/"]',
    'div:has-text("Suggested for you") a[href^="/"]',
  ],

  /** Na pagina do post: legenda, contadores, comentarios. */
  post: {
    container: ['article', 'main article', 'div[role="dialog"] article'],
    legenda: ['article h1', 'article ul li h1', 'article span[dir="auto"]'],
    curtidas: ['section a[href$="/liked_by/"] span', 'section span span'],
    comentarios: ['ul ul li span[dir="auto"]', 'article ul li div span'],
    dataPublicacao: ['time[datetime]'],
    video: ['article video'],
  },
} as const;

/**
 * Garimpa um valor dentro de um JSON de forma tolerante: procura em profundidade
 * o primeiro objeto que tenha TODAS as chaves indicadas.
 *
 * E o que torna a coleta resistente a reorganizacao do payload — o Instagram
 * muda onde o objeto fica com muito mais frequencia do que muda o nome das
 * chaves dentro dele.
 */
export function acharPorForma(
  raiz: unknown,
  chaves: string[],
  limiteProfundidade = 12,
): Record<string, unknown> | null {
  const fila: Array<{ no: unknown; nivel: number }> = [{ no: raiz, nivel: 0 }];

  while (fila.length > 0) {
    const atual = fila.shift();
    if (!atual || atual.nivel > limiteProfundidade) continue;
    const { no, nivel } = atual;

    if (Array.isArray(no)) {
      for (const item of no) fila.push({ no: item, nivel: nivel + 1 });
      continue;
    }

    if (no && typeof no === 'object') {
      const obj = no as Record<string, unknown>;
      if (chaves.every((c) => c in obj)) return obj;
      for (const valor of Object.values(obj)) fila.push({ no: valor, nivel: nivel + 1 });
    }
  }

  return null;
}

/** Coleta TODOS os objetos que batem com a forma, nao so o primeiro. */
export function acharTodosPorForma(
  raiz: unknown,
  chaves: string[],
  limiteProfundidade = 12,
): Array<Record<string, unknown>> {
  const achados: Array<Record<string, unknown>> = [];
  const fila: Array<{ no: unknown; nivel: number }> = [{ no: raiz, nivel: 0 }];

  while (fila.length > 0) {
    const atual = fila.shift();
    if (!atual || atual.nivel > limiteProfundidade) continue;
    const { no, nivel } = atual;

    if (Array.isArray(no)) {
      for (const item of no) fila.push({ no: item, nivel: nivel + 1 });
      continue;
    }

    if (no && typeof no === 'object') {
      const obj = no as Record<string, unknown>;
      if (chaves.every((c) => c in obj)) achados.push(obj);
      for (const valor of Object.values(obj)) fila.push({ no: valor, nivel: nivel + 1 });
    }
  }

  return achados;
}

/** Formas conhecidas, por nome, para quem le o codigo entender o que se procura. */
export const FORMAS = {
  /** O objeto do perfil. */
  perfil: ['username', 'edge_followed_by'],
  perfilAlternativo: ['username', 'follower_count'],
  /** Um item de midia na grade ou no feed. */
  midia: ['shortcode'],
  midiaAlternativa: ['code', 'taken_at'],
  /** Um comentario. */
  comentario: ['text', 'created_at'],
} as const;

/** Extrai o shortcode de uma URL de post ou reel. */
export function shortcodeDaUrl(url: string): string | null {
  return url.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
}
