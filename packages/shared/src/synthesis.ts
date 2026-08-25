import { z } from 'zod';

/**
 * A sintese do perfil — a saida final do Modulo A.
 *
 * O objetivo declarado da ferramenta: "esse perfil funciona porque X, Y, Z".
 * Tudo aqui precisa vir amarrado a evidencia do que foi coletado, e nao a
 * opiniao geral sobre redes sociais.
 */
export const profileSynthesisSchema = z.object({
  /** Padroes narrativos que se repetem nos posts que funcionaram. */
  narrativePatterns: z.array(
    z.object({
      pattern: z.string(),
      evidence: z.string(),
    }),
  ),
  /** Tipos de chamada para acao usados, e com que frequencia. */
  ctaPatterns: z.array(
    z.object({
      cta: z.string(),
      frequency: z.string(),
    }),
  ),
  /** O que o perfil tenta e nao funciona — tao util quanto o que funciona. */
  whatFails: z.array(
    z.object({
      attempt: z.string(),
      why: z.string(),
    }),
  ),
  /** A dor real da audiencia, lida nos comentarios. */
  audiencePain: z.array(
    z.object({
      pain: z.string(),
      evidence: z.string(),
    }),
  ),
  /** A formula de gancho que este perfil usa, em uma frase acionavel. */
  hookFormula: z.string(),
  /** A sintese em texto corrido, em markdown. */
  synthesisMd: z.string(),
});

export type ProfileSynthesis = z.infer<typeof profileSynthesisSchema>;
