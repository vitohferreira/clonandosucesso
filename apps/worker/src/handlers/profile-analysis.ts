import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collection } from '@molde/config';
import {
  addSnapshot,
  consume,
  ensureCapacity,
  listPosts,
  propagarPerformanceParaGanchos,
  saveComments,
  saveHighlights,
  saveMetrics,
  saveProfileAnalysis,
  saveSimilarProfiles,
  upsertPost,
  upsertProfile,
} from '@molde/db';
import {
  computeMetrics,
  profileAnalysisPayloadSchema,
  topOutliers,
  type ComputedMetric,
  type Post,
} from '@molde/shared';
import { sintetizarPerfil, type PostDestacado } from '../ai';
import { cadencia, distribuicaoDeFormato, faixasDeDuracao } from '../analysis/aggregate';
import { analisarVideoLocal, comPastaDeTrabalho } from '../media/pipeline';
import { abrirSessao, conferirBloqueio } from '../scraper/browser';
import { pausaEntreAcoes } from '../scraper/human';
import {
  coletarDestaques,
  coletarGrade,
  coletarSugestoes,
  visitarPerfil,
  visitarPost,
} from '../scraper/profile';
import type { Handler } from './index';

/**
 * Modulo A — de um @ a um dossie.
 *
 * A ordem das etapas nao e arbitraria, e economia de teto: primeiro o que e
 * barato (perfil e grade, que vem do JSON que a pagina ja busca), e so depois o
 * que custa (abrir post, baixar video). Assim, se o teto estourar no meio, o
 * que ficou salvo ja e a parte mais valiosa.
 *
 * Nada aqui e transacional: cada post e gravado assim que coletado. Se o worker
 * morrer no post 80 de 100, os 80 estao no banco.
 */

const TOTAL_ETAPAS = 7;

function paraMetrica(post: Post) {
  return {
    postId: post.id,
    postedAt: post.posted_at,
    likeCount: post.like_count,
    commentCount: post.comment_count,
    viewCount: post.view_count,
    isPinned: post.is_pinned,
    type: post.type,
  };
}

function paraDestacado(post: Post, m: ComputedMetric): PostDestacado {
  return {
    shortcode: post.shortcode,
    tipo: post.type,
    multiplo: m.multiple,
    tier: m.outlierTier,
    base: m.basis,
    engajamento: m.engagementRaw,
    publicadoEm: post.posted_at,
    duracaoSegundos: post.video_duration_s,
    legenda: post.caption,
  };
}

export const profileAnalysis: Handler = async ({ job, log, progress, signal }) => {
  const payload = profileAnalysisPayloadSchema.parse(job.payload);
  const handle = payload.handle;

  // Confere o teto ANTES de abrir navegador: se nao cabe hoje, nem comecamos.
  await ensureCapacity('profiles_analyzed', 1);

  const sessao = await abrirSessao(log);
  let custoTotal = 0;
  let postsAbertos = 0;
  let videosAnalisados = 0;
  const comentariosDosOutliers: string[] = [];

  try {
    /* ------------------------------------------------------------ 1. perfil */
    await progress('abrindo o perfil', { current: 1, total: TOTAL_ETAPAS, message: `@${handle}` });
    const coletado = await visitarPerfil(sessao, handle, log, job.id);

    const perfil = await upsertProfile({
      handle: coletado.handle,
      full_name: coletado.fullName,
      bio: coletado.bio,
      external_url: coletado.externalUrl,
      category: coletado.category,
      is_verified: coletado.isVerified,
      is_private: coletado.isPrivate,
    });

    await addSnapshot(perfil.id, {
      followers: coletado.followers,
      following: coletado.following,
      postsCount: coletado.postsCount,
    });

    /* ------------------------------------------------------------- 2. grade */
    await progress('percorrendo a grade', { current: 2, total: TOTAL_ETAPAS });
    const grade = await coletarGrade(sessao, log);

    // Gravacao incremental: cada post entra no banco assim que e lido.
    for (const midia of grade) {
      await upsertPost({
        profile_id: perfil.id,
        shortcode: midia.shortcode,
        type: midia.type,
        url: midia.url,
        caption: midia.caption ?? undefined,
        like_count: midia.likeCount ?? undefined,
        comment_count: midia.commentCount ?? undefined,
        view_count: midia.viewCount ?? undefined,
        video_duration_s: midia.videoDurationSeconds ?? undefined,
        carousel_count: midia.carouselCount ?? undefined,
        is_pinned: midia.isPinned,
        posted_at: midia.postedAt ?? undefined,
        raw: { grade: true },
      });
    }
    log.info('grade gravada', { posts: grade.length });

    /* -------------------------------------------- 3. destaques e sugestoes */
    await progress('lendo destaques', { current: 3, total: TOTAL_ETAPAS });
    const destaques = await coletarDestaques(sessao, log);
    await saveHighlights(perfil.id, destaques);

    const sugeridos = await coletarSugestoes(sessao);
    await saveSimilarProfiles(perfil.id, sugeridos, 'instagram_suggested');

    /* ---------------------------------------------------------- 4. metricas */
    if (signal.aborted) throw new Error('Worker encerrando antes do calculo');
    await progress('calculando os outliers', { current: 4, total: TOTAL_ETAPAS });

    const posts = await listPosts(perfil.id);
    const metricas = computeMetrics(posts.map(paraMetrica), {
      followers: coletado.followers,
    });
    await saveMetrics(metricas);

    const porId = new Map(metricas.map((m) => [m.postId, m]));
    const postPorId = new Map(posts.map((p) => [p.id, p]));

    const melhores = topOutliers(metricas, collection.maxOutlierVideosPerProfile);
    log.info('outliers encontrados', {
      total: metricas.filter((m) => m.outlierTier !== null && m.outlierTier > 0).length,
      paraAnalisar: melhores.length,
    });

    /* --------------------------------------- 5. os outliers, um por um */
    const destacados: PostDestacado[] = [];

    for (const [indice, metrica] of melhores.entries()) {
      if (signal.aborted) break;

      const post = postPorId.get(metrica.postId);
      if (!post) continue;

      await progress('abrindo os que explodiram', {
        current: 5,
        total: TOTAL_ETAPAS,
        message: `${indice + 1}/${melhores.length} — ${post.shortcode}`,
      });

      const destacado = paraDestacado(post, metrica);

      try {
        // Abrir post custa teto: por isso so os outliers sao abertos.
        await ensureCapacity('posts_opened', 1);
        const { midia, comentarios } = await visitarPost(sessao, post.shortcode, log, job.id, {
          lerComentarios: true,
        });
        await consume('posts_opened', 1);
        postsAbertos++;

        if (midia) {
          await upsertPost({
            profile_id: perfil.id,
            shortcode: midia.shortcode,
            type: midia.type,
            caption: midia.caption ?? undefined,
            like_count: midia.likeCount ?? undefined,
            comment_count: midia.commentCount ?? undefined,
            view_count: midia.viewCount ?? undefined,
            video_duration_s: midia.videoDurationSeconds ?? undefined,
            detail_fetched: true,
            raw: { detalhe: true },
          });
        }

        if (comentarios.length > 0) {
          await saveComments(post.id, comentarios);
          comentariosDosOutliers.push(...comentarios.map((c) => c.text));
        }

        // Video que explodiu recebe o pipeline completo de roteiro.
        const ehVideo = post.type === 'reel' || post.type === 'video';
        if (ehVideo && midia?.videoUrl) {
          await ensureCapacity('videos_downloaded', 1);

          const saida = await comPastaDeTrabalho(job.id, post.shortcode, async (pasta) => {
            const caminho = join(pasta, 'fonte.mp4');
            const resposta = await sessao.context.request.get(midia.videoUrl as string);
            if (!resposta.ok()) {
              throw new Error(`CDN recusou o video (HTTP ${resposta.status()})`);
            }
            await writeFile(caminho, await resposta.body());

            return analisarVideoLocal({
              videoLocal: caminho,
              pastaDeTrabalho: pasta,
              jobId: job.id,
              postId: post.id,
              source: 'instagram',
              sourceUrl: post.url,
              log: log.child({ shortcode: post.shortcode }),
            });
          });

          await consume('videos_downloaded', 1);
          videosAnalisados++;
          custoTotal += saida.custoUsd;

          const roteiro = saida.analise.script as {
            hook?: { text?: string; kind?: string };
            summary?: string;
          } | null;

          destacado.gancho = roteiro?.hook?.text ?? null;
          destacado.tipoDeGancho = roteiro?.hook?.kind ?? null;
          destacado.resumoDoRoteiro = roteiro?.summary ?? null;
        }
      } catch (erro) {
        // Teto e bloqueio sobem: os dois tem tratamento proprio no loop do worker.
        if (
          (erro as Error).name === 'RateLimitReachedError' ||
          (erro as Error).name === 'BlockedError'
        ) {
          throw erro;
        }
        // Um post que nao carregou nao derruba a analise do perfil.
        log.warn('outlier pulado', {
          shortcode: post.shortcode,
          erro: (erro as Error).message,
        });
      }

      destacados.push(destacado);
      conferirBloqueio(sessao);
      await pausaEntreAcoes();
    }

    /* ------------------------------------------------------- 6. a sintese */
    await progress('escrevendo a sintese', { current: 6, total: TOTAL_ETAPAS });

    const formatos = distribuicaoDeFormato(posts, porId);
    const ritmo = cadencia(posts);
    const duracoes = faixasDeDuracao(posts, porId);

    const fracassos = metricas
      .filter((m) => m.outlierTier === -1)
      .sort((a, b) => a.multiple - b.multiple)
      .slice(0, 8)
      .map((m) => {
        const post = postPorId.get(m.postId);
        return post ? paraDestacado(post, m) : null;
      })
      .filter((x): x is PostDestacado => x !== null);

    const sintese = await sintetizarPerfil({
      handle: perfil.handle,
      nome: perfil.full_name,
      bio: perfil.bio,
      categoria: perfil.category,
      seguidores: coletado.followers,
      totalDePosts: coletado.postsCount,
      postsColetados: posts.length,
      distribuicaoDeFormato: formatos,
      cadencia: ritmo,
      faixasDeDuracao: duracoes,
      outliers: destacados,
      fracassos,
      destaques: destaques.map((d) => d.title),
      comentarios: comentariosDosOutliers.slice(0, 120),
    });

    custoTotal += sintese.costUsd;

    /* --------------------------------------------------------- 7. gravar */
    await progress('salvando o dossie', { current: 7, total: TOTAL_ETAPAS });

    await saveProfileAnalysis({
      profileId: perfil.id,
      jobId: job.id,
      formatDistribution: formatos,
      cadence: ritmo,
      durationBuckets: duracoes,
      narrativePatterns: sintese.synthesis.narrativePatterns,
      ctaPatterns: sintese.synthesis.ctaPatterns,
      whatFails: sintese.synthesis.whatFails,
      audiencePain: sintese.synthesis.audiencePain,
      synthesisMd: sintese.synthesis.synthesisMd,
      modelUsed: sintese.modelUsed,
      usage: { ...sintese.usage, hookFormula: sintese.synthesis.hookFormula },
      costUsd: custoTotal,
    });

    // A biblioteca de ganchos passa a saber quanto cada gancho rendeu.
    await propagarPerformanceParaGanchos(perfil.id);

    // So consome o teto de perfis quando a analise chegou ao fim.
    await consume('profiles_analyzed', 1);

    return {
      result: {
        profileId: perfil.id,
        handle: perfil.handle,
        postsCollected: posts.length,
        postsOpened: postsAbertos,
        outliersFound: melhores.length,
        videosAnalyzed: videosAnalisados,
        partial: false,
      },
      costUsd: Number(custoTotal.toFixed(6)),
    };
  } finally {
    await sessao.fechar();
  }
};
