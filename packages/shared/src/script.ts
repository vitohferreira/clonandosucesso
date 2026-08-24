import { z } from 'zod';

/**
 * O formato do roteiro anotado — a saida do Modulo B.
 * Nao e transcricao corrida: e o que voce mandaria para um editor.
 *
 * Este schema tambem e o contrato que o Claude precisa devolver, entao ele
 * e usado tanto para validar a resposta do modelo quanto para tipar a UI.
 */
export const scriptBlockSchema = z.object({
  /** Inicio do bloco, em segundos a partir do zero do video. */
  tIn: z.number().min(0),
  tOut: z.number().min(0),
  /** Rotulo funcional do bloco: gancho, contexto, desenvolvimento, virada, cta. */
  role: z.enum(['gancho', 'contexto', 'desenvolvimento', 'virada', 'prova', 'cta', 'outro']),
  /** Fala transcrita deste bloco. Vazio quando o bloco e so imagem. */
  speech: z.string(),
  /** Texto que aparece na tela durante o bloco (legenda queimada, titulo, etc). */
  onScreenText: z.string().nullable(),
  /** O que esta em cena, descrito de forma acionavel para o editor. */
  scene: z.string(),
  /** Se este trecho e coberto por b-roll em vez do apresentador. */
  isBRoll: z.boolean(),
  /** Cortes detectados dentro deste bloco. */
  cutCount: z.number().int().min(0),
});

export type ScriptBlock = z.infer<typeof scriptBlockSchema>;

/** Classificacao do gancho. Alimenta a biblioteca pesquisavel. */
export const HOOK_KINDS = [
  'pergunta',
  'contradicao',
  'promessa',
  'numero',
  'erro_comum',
  'pov',
  'autoridade',
  'historia',
  'urgencia',
  'outro',
] as const;

export const hookKindSchema = z.enum(HOOK_KINDS);
export type HookKind = z.infer<typeof hookKindSchema>;

export const structuredScriptSchema = z.object({
  blocks: z.array(scriptBlockSchema),
  hook: z.object({
    text: z.string(),
    kind: hookKindSchema,
    onScreenText: z.string().nullable(),
    spanSeconds: z.number().min(0),
    /** Por que esse gancho segura, em uma frase. */
    rationale: z.string(),
  }),
  /** Sintese do que o video faz, em uma frase. */
  summary: z.string(),
  /** CTA identificado, se houver. */
  cta: z.string().nullable(),
});

export type StructuredScript = z.infer<typeof structuredScriptSchema>;
