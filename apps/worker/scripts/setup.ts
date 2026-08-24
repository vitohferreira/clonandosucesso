/**
 * Setup guiado. Roda com `npm run setup` na raiz.
 *
 * Faz tudo que da para fazer sem browser: cria o .env, gera o SESSION_SECRET,
 * pergunta as duas coisas que so voce tem (URL e chave do Supabase) e depois
 * confere se ficou tudo de pe.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { repoRoot } from '../src/env';

const envPath = resolve(repoRoot, '.env');
const exemploPath = resolve(repoRoot, '.env.example');

/** Troca o valor de uma chave preservando comentarios e o resto do arquivo. */
function definir(conteudo: string, chave: string, valor: string): string {
  const linha = `${chave}=${valor}`;
  const regex = new RegExp(`^${chave}=.*$`, 'm');
  return regex.test(conteudo) ? conteudo.replace(regex, linha) : `${conteudo}\n${linha}\n`;
}

function ler(conteudo: string, chave: string): string {
  return conteudo.match(new RegExp(`^${chave}=(.*)$`, 'm'))?.[1]?.trim() ?? '';
}

console.log('\n\x1b[1mMolde — setup\x1b[0m');
console.log('\x1b[90mVou preencher o .env com voce. Enter mantem o valor atual.\x1b[0m\n');

if (!existsSync(envPath)) {
  copyFileSync(exemploPath, envPath);
  console.log('  .env criado a partir do .env.example\n');
}

let conteudo = readFileSync(envPath, 'utf8');

/** Grava a cada resposta: se algo interromper no meio, nada do que voce ja
 *  digitou se perde. */
function gravar() {
  writeFileSync(envPath, conteudo, 'utf8');
}

// Interativo usa readline. Com entrada canalizada (teste, script) o readline
// descarta as linhas que chegam antes da pergunta seguinte, entao nesse caso
// lemos o stdin inteiro de uma vez e servimos linha a linha.
const interativo = process.stdin.isTTY === true;
const rl = interativo ? createInterface({ input: process.stdin, output: process.stdout }) : null;

let enfileiradas: string[] = [];
if (!interativo) {
  const pedacos: Buffer[] = [];
  for await (const pedaco of process.stdin) pedacos.push(pedaco as Buffer);
  enfileiradas = Buffer.concat(pedacos).toString('utf8').split('\n');
}

async function pergunta(rotulo: string): Promise<string> {
  if (rl) return (await rl.question(rotulo)).trim();
  const valor = (enfileiradas.shift() ?? '').trim();
  console.log(`${rotulo}${valor}`);
  return valor;
}

// --- SUPABASE_URL
const urlAtual = ler(conteudo, 'SUPABASE_URL');
const urlPadrao = urlAtual.includes('xxxxxxxxxxxx') ? '' : urlAtual;
console.log('\x1b[90mPainel do Supabase > Project Settings > API Keys\x1b[0m');
const url = (await pergunta(`  URL do projeto${urlPadrao ? ` [${urlPadrao}]` : ''}: `)) || urlPadrao;
if (url) {
  conteudo = definir(conteudo, 'SUPABASE_URL', url);
  gravar();
}

// --- chave secreta
const chaveAtual = ler(conteudo, 'SUPABASE_SECRET_KEY') || ler(conteudo, 'SUPABASE_SERVICE_ROLE_KEY');
const resumo = chaveAtual ? `${chaveAtual.slice(0, 11)}...` : '';
console.log('\n\x1b[90mA chave SECRETA (sb_secret_...), nao a publishable/anon.\x1b[0m');
const chave = (await pergunta(`  Chave secreta${resumo ? ` [${resumo}]` : ''}: `)) || chaveAtual;
if (chave) {
  // A chave nova e a legada moram em variaveis diferentes; grava na certa.
  const legada = chave.startsWith('eyJ');
  conteudo = definir(conteudo, legada ? 'SUPABASE_SERVICE_ROLE_KEY' : 'SUPABASE_SECRET_KEY', chave);
  gravar();
  if (legada) console.log('  \x1b[90m(formato legado detectado, gravei em SUPABASE_SERVICE_ROLE_KEY)\x1b[0m');
}

// --- senha do app
const senhaAtual = ler(conteudo, 'APP_PASSWORD');
console.log('\n\x1b[90mA senha que voce vai digitar para entrar no Molde. Voce escolhe.\x1b[0m');
const senha = (await pergunta(`  Senha do app${senhaAtual ? ' [mantida]' : ''}: `)) || senhaAtual;
if (senha) {
  conteudo = definir(conteudo, 'APP_PASSWORD', senha);
  gravar();
}

// --- segredo do cookie, gerado sozinho
if (ler(conteudo, 'SESSION_SECRET').length < 32) {
  conteudo = definir(conteudo, 'SESSION_SECRET', randomUUID() + randomUUID());
  gravar();
  console.log('\n  SESSION_SECRET gerado automaticamente');
}

rl?.close();
console.log(`\n  .env gravado em ${envPath}\n`);
console.log('\x1b[90m─────────────────────────────────────────\x1b[0m');
console.log('Agora conferindo se o banco responde...\n');

// Reimporta o diagnostico ja com o .env novo em process.env.
for (const linha of conteudo.split('\n')) {
  const m = linha.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m?.[1] && m[2]) process.env[m[1]] = m[2].trim();
}
await import('./doctor');
