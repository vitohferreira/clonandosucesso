import { durationBuckets } from '@molde/config';
import { localParts, median, type ComputedMetric, type Post, type PostType } from '@molde/shared';

/**
 * As agregacoes do dossie. Funcao pura sobre o que ja esta no banco.
 *
 * Tudo que envolve data e hora usa o fuso da config, nunca UTC: "esse perfil
 * posta as 19h" calculado em UTC daria 16h e a conclusao seria errada por tres
 * horas.
 */

export interface DistribuicaoFormato {
  contagem: Record<PostType, number>;
  fracao: Record<PostType, number>;
  /** Mediana do multiplo de performance por formato: qual formato rende mais. */
  desempenhoMediano: Record<string, number>;
}

export function distribuicaoDeFormato(
  posts: Post[],
  metricas: Map<string, ComputedMetric>,
): DistribuicaoFormato {
  const contagem = { reel: 0, carousel: 0, image: 0, video: 0, unknown: 0 } as Record<
    PostType,
    number
  >;
  const multiplos = new Map<PostType, number[]>();

  for (const post of posts) {
    contagem[post.type] = (contagem[post.type] ?? 0) + 1;
    const m = metricas.get(post.id);
    if (m && !m.provisional) {
      const lista = multiplos.get(post.type) ?? [];
      lista.push(m.multiple);
      multiplos.set(post.type, lista);
    }
  }

  const total = posts.length || 1;
  const fracao = {} as Record<PostType, number>;
  for (const [tipo, n] of Object.entries(contagem)) {
    fracao[tipo as PostType] = Number((n / total).toFixed(3));
  }

  const desempenhoMediano: Record<string, number> = {};
  for (const [tipo, lista] of multiplos) {
    desempenhoMediano[tipo] = Number(median(lista).toFixed(2));
  }

  return { contagem, fracao, desempenhoMediano };
}

export interface Cadencia {
  postsPorSemana: number;
  porDiaDaSemana: Record<string, number>;
  porHora: Record<string, number>;
  intervaloMedianoDias: number;
  primeiroPost: string | null;
  ultimoPost: string | null;
}

export function cadencia(posts: Post[]): Cadencia {
  const comData = posts
    .filter((p) => p.posted_at)
    .map((p) => new Date(p.posted_at as string))
    .sort((a, b) => a.getTime() - b.getTime());

  if (comData.length === 0) {
    return {
      postsPorSemana: 0,
      porDiaDaSemana: {},
      porHora: {},
      intervaloMedianoDias: 0,
      primeiroPost: null,
      ultimoPost: null,
    };
  }

  const porDiaDaSemana: Record<string, number> = {};
  const porHora: Record<string, number> = {};

  for (const data of comData) {
    const { weekday, hour } = localParts(data);
    porDiaDaSemana[weekday] = (porDiaDaSemana[weekday] ?? 0) + 1;
    const faixa = `${String(hour).padStart(2, '0')}h`;
    porHora[faixa] = (porHora[faixa] ?? 0) + 1;
  }

  const intervalos: number[] = [];
  for (let i = 1; i < comData.length; i++) {
    const anterior = comData[i - 1];
    const atual = comData[i];
    if (anterior && atual) {
      intervalos.push((atual.getTime() - anterior.getTime()) / 86_400_000);
    }
  }

  const primeiro = comData[0] as Date;
  const ultimo = comData[comData.length - 1] as Date;
  const semanas = Math.max(
    1,
    (ultimo.getTime() - primeiro.getTime()) / (7 * 86_400_000),
  );

  return {
    postsPorSemana: Number((comData.length / semanas).toFixed(2)),
    porDiaDaSemana,
    porHora,
    intervaloMedianoDias: Number(median(intervalos).toFixed(2)),
    primeiroPost: primeiro.toISOString(),
    ultimoPost: ultimo.toISOString(),
  };
}

export interface FaixaDeDuracao {
  faixa: string;
  posts: number;
  multiploMediano: number;
  outliers: number;
}

/**
 * Duracao cruzada com performance: qual faixa de duracao rende mais neste perfil.
 * E uma das perguntas que o dossie precisa responder.
 */
export function faixasDeDuracao(
  posts: Post[],
  metricas: Map<string, ComputedMetric>,
): FaixaDeDuracao[] {
  return durationBuckets.map((faixa) => {
    const naFaixa = posts.filter(
      (p) =>
        p.video_duration_s != null &&
        p.video_duration_s >= faixa.min &&
        p.video_duration_s < faixa.max,
    );

    const multiplos: number[] = [];
    let outliersNaFaixa = 0;

    for (const post of naFaixa) {
      const m = metricas.get(post.id);
      if (!m || m.provisional) continue;
      multiplos.push(m.multiple);
      if (m.outlierTier !== null && m.outlierTier > 0) outliersNaFaixa++;
    }

    return {
      faixa: faixa.label,
      posts: naFaixa.length,
      multiploMediano: Number(median(multiplos).toFixed(2)),
      outliers: outliersNaFaixa,
    };
  });
}
