import { outliers } from '@molde/config';
import type { MetricBasis, PostType } from './domain';

/**
 * Deteccao de outlier — a peca central da ferramenta.
 *
 * Duas decisoes moldam tudo aqui:
 *
 * 1. A mediana NAO e global. E a mediana movel dos posts vizinhos no tempo. Um
 *    post de dois anos atras com 3x a mediana global pode ser apenas um perfil
 *    que tinha um decimo dos seguidores.
 *
 * 2. Post so e comparado com post da MESMA base de medicao. Perfil que esconde
 *    curtidas nao pode entrar na mesma mediana de quem mostra: seriam grandezas
 *    diferentes somadas na mesma conta.
 *
 * Tudo aqui e funcao pura sobre os dados ja coletados, entao recalcular nao
 * custa nada e nunca exige voltar ao Instagram.
 */

export interface MetricInput {
  postId: string;
  postedAt: string | null;
  likeCount: number | null;
  commentCount: number | null;
  viewCount: number | null;
  isPinned: boolean;
  type: PostType;
}

export interface ComputedMetric {
  postId: string;
  basis: MetricBasis;
  engagementRaw: number;
  engagementRate: number | null;
  baselineMedian: number;
  windowKind: 'rolling' | 'global';
  windowSize: number;
  multiple: number;
  isOutlier: boolean;
  /** 2, 3 ou 5 para alta; -1 para muito abaixo; null para o post mediano. */
  outlierTier: number | null;
  provisional: boolean;
}

export function median(valores: number[]): number {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 0
    ? ((ordenados[meio - 1] ?? 0) + (ordenados[meio] ?? 0)) / 2
    : (ordenados[meio] ?? 0);
}

/**
 * Em que base este post pode ser medido.
 *
 * Preferimos curtidas+comentarios porque e a unica base comparavel entre reel,
 * carrossel e estatico. Views so entram quando as curtidas estao escondidas —
 * e mesmo assim so se comparam com outros posts na mesma situacao.
 */
export function basisOf(post: MetricInput): MetricBasis | null {
  if (post.likeCount != null) return 'likes_comments';
  if (post.viewCount != null) return 'views';
  if (post.commentCount != null) return 'comments_only';
  return null;
}

export function engagementOf(post: MetricInput, basis: MetricBasis): number {
  switch (basis) {
    case 'likes_comments':
      return (post.likeCount ?? 0) + (post.commentCount ?? 0);
    case 'views':
      return post.viewCount ?? 0;
    case 'comments_only':
      return post.commentCount ?? 0;
  }
}

/** Post recente ainda esta acumulando: nao serve de referencia para os outros. */
export function isProvisional(postedAt: string | null, agora = new Date()): boolean {
  if (!postedAt) return false;
  const dias = (agora.getTime() - new Date(postedAt).getTime()) / 86_400_000;
  return dias < outliers.provisionalAfterDays;
}

function tierOf(multiple: number): number | null {
  if (multiple <= outliers.underperformerRatio) return -1;
  // Do maior para o menor: 5x tambem e 3x e 2x, e o rotulo que vale e o maior.
  for (const tier of [...outliers.tiers].sort((a, b) => b - a)) {
    if (multiple >= tier) return tier;
  }
  return null;
}

/**
 * Calcula a metrica de cada post do perfil.
 *
 * `followers` vem do snapshot mais proximo e serve so para a taxa de
 * engajamento; a deteccao de outlier nao depende dele.
 */
export function computeMetrics(
  posts: MetricInput[],
  options: { followers?: number | null; now?: Date } = {},
): ComputedMetric[] {
  const agora = options.now ?? new Date();
  const seguidores = options.followers ?? null;

  // Cada base e um universo separado. Nada atravessa de um para o outro.
  const porBase = new Map<MetricBasis, MetricInput[]>();
  for (const post of posts) {
    const base = basisOf(post);
    if (!base) continue; // Sem dado nenhum: nao da para medir, e tudo bem.
    const grupo = porBase.get(base) ?? [];
    grupo.push(post);
    porBase.set(base, grupo);
  }

  const resultado: ComputedMetric[] = [];

  for (const [base, grupo] of porBase) {
    // Ordem cronologica: e ela que define quem sao os "vizinhos no tempo".
    const cronologico = [...grupo].sort((a, b) => {
      const ta = a.postedAt ? new Date(a.postedAt).getTime() : 0;
      const tb = b.postedAt ? new Date(b.postedAt).getTime() : 0;
      return ta - tb;
    });

    const engajamentos = cronologico.map((p) => engagementOf(p, base));
    const provisorios = cronologico.map((p) => isProvisional(p.postedAt, agora));

    /** Um post entra na baseline dos outros? */
    const elegivel = (indice: number): boolean => {
      if (provisorios[indice]) return false;
      if (outliers.excludePinnedFromBaseline && cronologico[indice]?.isPinned) return false;
      return true;
    };

    // Mediana global do grupo, usada quando a janela movel nao tem gente suficiente.
    const globais = engajamentos.filter((_, i) => elegivel(i));
    const medianaGlobal = median(globais);

    for (let i = 0; i < cronologico.length; i++) {
      const post = cronologico[i];
      if (!post) continue;

      const engajamento = engajamentos[i] ?? 0;

      // Janela movel centrada no post, EXCLUINDO ele proprio: um post nao pode
      // inflar a propria referencia.
      const raio = Math.floor(outliers.rollingWindow / 2);
      const vizinhos: number[] = [];
      for (
        let j = Math.max(0, i - raio);
        j <= Math.min(cronologico.length - 1, i + raio);
        j++
      ) {
        if (j === i) continue;
        if (!elegivel(j)) continue;
        vizinhos.push(engajamentos[j] ?? 0);
      }

      const usaJanela = vizinhos.length >= outliers.minWindowSize;
      const baseline = usaJanela ? median(vizinhos) : medianaGlobal;
      const windowKind: 'rolling' | 'global' = usaJanela ? 'rolling' : 'global';
      const windowSize = usaJanela ? vizinhos.length : globais.length;

      // Sem baseline nao ha o que comparar: o post fica registrado com multiplo 0.
      const multiple = baseline > 0 ? Number((engajamento / baseline).toFixed(3)) : 0;
      let tier = baseline > 0 ? tierOf(multiple) : null;

      // Post provisorio que ficou abaixo nao "fracassou": ele so nao teve tempo
      // de acumular. Marcar como underperformer seria mentira. Ja o contrario
      // vale: se ele JA passou a mediana com poucos dias, isso e sinal de verdade.
      if ((provisorios[i] ?? false) && tier === -1) tier = null;

      resultado.push({
        postId: post.postId,
        basis: base,
        engagementRaw: engajamento,
        engagementRate:
          seguidores && seguidores > 0
            ? Number((engajamento / seguidores).toFixed(6))
            : null,
        baselineMedian: Number(baseline.toFixed(2)),
        windowKind,
        windowSize,
        multiple,
        // Outlier e o que se destaca em qualquer direcao; o sinal do tier diz qual.
        isOutlier: tier !== null,
        outlierTier: tier,
        provisional: provisorios[i] ?? false,
      });
    }
  }

  return resultado;
}

/** Os outliers de alta, do maior multiplo para o menor. */
export function topOutliers(metricas: ComputedMetric[], limite: number): ComputedMetric[] {
  return metricas
    .filter((m) => m.outlierTier !== null && m.outlierTier > 0 && !m.provisional)
    .sort((a, b) => b.multiple - a.multiple)
    .slice(0, limite);
}
