/**
 * Junta as migrations num arquivo so, para voce colar de uma vez no SQL Editor
 * do Supabase. Colar em quatro pedacos e a forma mais facil de aplicar o schema
 * pela metade e depois nao entender por que a fila nao funciona.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from '../src/env';

const dir = resolve(repoRoot, 'supabase', 'migrations');
const saida = resolve(repoRoot, 'supabase', 'schema-completo.sql');

const arquivos = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

const partes = arquivos.map((nome) => {
  const conteudo = readFileSync(resolve(dir, nome), 'utf8');
  return `-- ${'='.repeat(74)}\n-- ${nome}\n-- ${'='.repeat(74)}\n\n${conteudo}`;
});

const cabecalho = `-- Molde — schema completo, gerado por \`npm run db:bundle\`.
--
-- Cole ESTE ARQUIVO INTEIRO no SQL Editor do Supabase e clique em Run.
-- Sao ${arquivos.length} migrations na ordem correta. Nao rode em pedacos.
--
-- Gerado em ${new Date().toISOString()}

`;

mkdirSync(resolve(repoRoot, 'supabase'), { recursive: true });
writeFileSync(saida, cabecalho + partes.join('\n\n'), 'utf8');

const linhas = (cabecalho + partes.join('\n\n')).split('\n').length;
console.log(`\nSchema completo gerado (${arquivos.length} migrations, ${linhas} linhas):\n`);
console.log(`  ${saida}\n`);
console.log('Abra esse arquivo, copie TUDO, e cole no SQL Editor do Supabase:');
console.log('  Painel > SQL Editor > New query > colar > Run\n');
