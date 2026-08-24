import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import type { NextConfig } from 'next';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

// O Next so leria .env de dentro de apps/web. Como o worker usa o .env da raiz,
// carregamos ele aqui tambem para existir UM arquivo de segredos no projeto.
// Variavel de ambiente real continua vencendo (dotenv nao sobrescreve), entao
// na Vercel quem manda e o painel.
loadDotenv({ path: `${repoRoot}.env` });

const nextConfig: NextConfig = {
  // Os pacotes do monorepo sao consumidos como TypeScript direto da fonte.
  transpilePackages: ['@molde/config', '@molde/db', '@molde/shared'],
  // Sem isto a Vercel nao acha os arquivos dos workspaces na hora de empacotar.
  outputFileTracingRoot: repoRoot,
};

export default nextConfig;
