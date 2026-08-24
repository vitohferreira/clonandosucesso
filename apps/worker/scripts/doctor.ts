/**
 * Diagnostico do setup. Roda com `npm run doctor` na raiz.
 *
 * Existe para transformar "nao funciona" numa lista de o que exatamente falta.
 * Se algo quebrar, a saida daqui e o que voce cola numa conversa pedindo ajuda.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { repoRoot } from '../src/env';

const TABELAS = [
  'jobs', 'profiles', 'profile_snapshots', 'posts', 'post_metrics',
  'video_analyses', 'hooks', 'highlights', 'post_comments', 'profile_analyses',
  'similar_profiles', 'rate_limit_counters', 'scrape_events', 'settings',
];

const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m: string, dica?: string) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  if (dica) console.log(`      \x1b[90m${dica}\x1b[0m`);
};

let falhas = 0;
function checa(condicao: boolean, sim: string, nao: string, dica?: string) {
  if (condicao) ok(sim);
  else { bad(nao, dica); falhas++; }
}

console.log('\n\x1b[1mMolde — diagnostico\x1b[0m\n');

// ---------- ambiente local
console.log('\x1b[90mAmbiente\x1b[0m');
const major = Number(process.versions.node.split('.')[0]);
checa(major >= 20, `Node ${process.versions.node}`, `Node ${process.versions.node} e antigo demais`,
  'Instale o Node 20 ou maior em nodejs.org');

const envPath = resolve(repoRoot, '.env');
checa(existsSync(envPath), '.env existe', '.env nao existe',
  'Rode `npm run setup` na raiz, ou copie .env.example para .env');

// ---------- variaveis
console.log('\n\x1b[90mVariaveis\x1b[0m');
const url = process.env.SUPABASE_URL;
const chave = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

checa(!!url && url.startsWith('http'), `SUPABASE_URL = ${url ?? '(vazio)'}`,
  'SUPABASE_URL vazio ou invalido',
  'Painel do Supabase > Project Settings > API Keys > Project URL');

checa(!!chave, chave ? `chave secreta presente (${chave.slice(0, 11)}...)` : '', 'chave secreta ausente',
  'Preencha SUPABASE_SECRET_KEY (sb_secret_...) ou SUPABASE_SERVICE_ROLE_KEY (legada)');

if (chave?.startsWith('sb_publishable_')) {
  bad('essa e a chave PUBLICA, nao a secreta',
    'A publishable nao ignora RLS e nao serve aqui. Pegue a Secret key (sb_secret_...).');
  falhas++;
}

checa(!!process.env.APP_PASSWORD, 'APP_PASSWORD definido', 'APP_PASSWORD vazio',
  'E a senha que voce vai digitar para entrar no app');

const segredo = process.env.SESSION_SECRET ?? '';
checa(segredo.length >= 32, 'SESSION_SECRET definido', 'SESSION_SECRET vazio ou curto demais',
  'Gere com: node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"');

// ---------- banco
if (url && chave) {
  console.log('\n\x1b[90mBanco\x1b[0m');
  const db = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });

  const primeira = await db.from('jobs').select('id').limit(1);

  if (primeira.error) {
    const msg = primeira.error.message;
    if (/fetch failed|ENOTFOUND|getaddrinfo/i.test(msg)) {
      bad('nao alcancei o Supabase', `A URL esta certa? O projeto pode estar pausado. (${msg})`);
    } else if (/JWT|api key|Invalid/i.test(msg)) {
      bad('o Supabase recusou a chave', 'Confira se copiou a chave SECRETA inteira, sem espaco sobrando');
    } else if (/does not exist|schema cache|relation/i.test(msg)) {
      bad('conectei, mas as tabelas nao existem',
        'Falta aplicar o schema: rode `npm run db:bundle` e cole o arquivo gerado no SQL Editor');
    } else {
      bad(`erro do banco: ${msg}`);
    }
    falhas++;
  } else {
    ok('conexao com o Supabase');

    const faltando: string[] = [];
    for (const t of TABELAS) {
      const r = await db.from(t).select('*').limit(0);
      if (r.error) faltando.push(t);
    }
    checa(faltando.length === 0, `as ${TABELAS.length} tabelas existem`,
      `faltam tabelas: ${faltando.join(', ')}`,
      'Rode `npm run db:bundle` e cole o arquivo gerado no SQL Editor do Supabase');

    // Funcao read-only, so para provar que as migrations de funcao rodaram.
    const fn = await db.rpc('posts_needing_detail', {
      p_profile_id: '00000000-0000-0000-0000-000000000000',
      p_refetch_after_days: 30,
      p_limit: 1,
    });
    checa(!fn.error, 'as funcoes da fila existem',
      'as funcoes nao existem (o schema foi aplicado pela metade?)',
      'Cole o arquivo do `npm run db:bundle` INTEIRO, do comeco ao fim');

    const fila = await db.from('jobs').select('status').limit(200);
    if (!fila.error) {
      const total = fila.data?.length ?? 0;
      console.log(`      \x1b[90m${total} job(s) na tabela\x1b[0m`);
    }
  }
}

console.log();
if (falhas === 0) {
  console.log('\x1b[32mTudo pronto.\x1b[0m Suba os dois terminais:\n');
  console.log('  npm run dev:web      (deixa aberto)');
  console.log('  npm run dev:worker   (outro terminal)\n');
  console.log('Depois abra http://localhost:3000 e clique em "enfileirar ping".\n');
} else {
  console.log(`\x1b[31m${falhas} problema(s).\x1b[0m Resolva de cima para baixo — o primeiro costuma causar os outros.\n`);
  // Sai com 0 de proposito: isto e um relatorio para humano, e o bloco de erro
  // que o npm imprime num exit != 0 faz parecer que o diagnostico quebrou.
}
