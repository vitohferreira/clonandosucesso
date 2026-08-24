import { dailyCaps as defaultCaps, type DailyCaps } from '@molde/config';
import { serviceClient } from './client';

/**
 * A fonte da verdade da configuracao e packages/config. A tabela `settings`
 * existe so para sobrescrever numero sem precisar de redeploy do worker.
 */
export async function getSetting<T>(key: string): Promise<T | null> {
  const res = await serviceClient().from('settings').select('value').eq('key', key).maybeSingle();
  if (res.error) throw new Error(`getSetting(${key}): ${res.error.message}`);
  return (res.data?.value ?? null) as T | null;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const res = await serviceClient().from('settings').upsert({ key, value }, { onConflict: 'key' });
  if (res.error) throw new Error(`setSetting(${key}): ${res.error.message}`);
}

/**
 * Tetos diarios em vigor: os do arquivo de config, sobrescritos pela chave
 * `daily_caps` da tabela settings quando ela existir.
 */
export async function getDailyCaps(): Promise<DailyCaps> {
  const override = await getSetting<Partial<DailyCaps>>('daily_caps');
  if (!override) return defaultCaps;

  // Merge raso: so aceita numero positivo, para um valor errado no banco nao
  // liberar o teto sem querer.
  const merged: Record<string, number> = { ...defaultCaps };
  for (const [key, value] of Object.entries(override)) {
    if (key in defaultCaps && typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      merged[key] = Math.floor(value);
    }
  }
  return merged as unknown as DailyCaps;
}
