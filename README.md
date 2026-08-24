# Molde

Engenharia reversa de conteúdo do Instagram. Não é analytics e não é ferramenta
de crescimento: serve para destrinchar o conteúdo de outros perfis e entender a
estrutura por trás do que funciona.

Usuário único. Sem multi-tenant, sem billing, sem onboarding.

## Os dois módulos

**Módulo A — Análise de perfil.** Você informa um `@` e recebe um dossiê:
formatos, cadência, duração cruzada com performance, detecção de outliers,
roteiro dos vídeos que explodiram, ganchos isolados e classificados, destaques,
dor da audiência lida nos comentários, e uma síntese do porquê aquele perfil
funciona.

**Módulo B — Extração de roteiro.** Funciona sozinho, sem depender do Módulo A.
Você manda um vídeo e recebe o roteiro anotado: fala com timestamp, texto na
tela, descrição de cena, ritmo de corte e marcação de b-roll. No formato que
você usaria para briefar um editor.

## Arquitetura

```
apps/web       Next.js (App Router) — frontend e API. Deploy na Vercel.
apps/worker    Node + Playwright + ffmpeg, containerizado. Roda na SUA máquina.
packages/config  Todos os números que governam comportamento, em um arquivo só.
packages/shared  Tipos de domínio e schemas zod. Contrato entre web e worker.
packages/db      Cliente Supabase e as queries.
supabase/migrations  O schema.
```

A fila é a tabela `jobs` no Postgres, com polling do worker. Sem Redis, sem
broker, sem cron. A concorrência é resolvida pelo `claim_job` no banco, com
`FOR UPDATE SKIP LOCKED`.

**O worker roda na sua máquina, não na nuvem.** Isso é deliberado: você loga no
Instagram do seu IP residencial, e passar a navegar com a mesma sessão a partir
de um IP de datacenter é o padrão que mais dispara checkpoint. O `Dockerfile`
está pronto para subir num Fly com volume persistente se um dia você quiser, mas
não é o caminho recomendado.

## Setup

Precisa de: Node 20+, Docker, uma conta no Supabase.

### 1. Dependências

```bash
npm install
```

### 2. Supabase

Crie um projeto no [Supabase](https://supabase.com). Depois, em
**Project Settings → API Keys**, copie a URL do projeto e a **chave secreta**
(`sb_secret_...`). Se o projeto só mostrar as chaves antigas, use a aba
**Legacy API Keys → service_role**: o código aceita as duas.

Aplique as migrations. Com a [CLI do Supabase](https://supabase.com/docs/guides/cli):

```bash
supabase link --project-ref SEU_PROJECT_REF
npm run db:push
```

Ou, se preferir sem CLI: abra o SQL Editor do painel e rode os quatro arquivos
de `supabase/migrations/` **na ordem**.

### 3. Variáveis de ambiente

```bash
cp .env.example .env
node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"  # SESSION_SECRET
```

Preencha `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `APP_PASSWORD` e `SESSION_SECRET`.
As chaves de Groq e Anthropic só são usadas a partir da Fase 1.

> **Projeto gratuito pausa sozinho.** O plano free do Supabase suspende o projeto
> depois de 7 dias sem atividade no banco. Os dados ficam guardados, mas você
> precisa retomar na mão pelo painel. Rodar o worker de vez em quando já conta
> como atividade.

### 4. Suba a web

```bash
npm run dev:web    # http://localhost:3000
```

### 5. Suba o worker

Modo direto, sem container (mais simples para desenvolver):

```bash
npm run dev:worker
```

Ou no Docker, que é como ele vai rodar de verdade:

```bash
export MOLDE_UID=$(id -u) MOLDE_GID=$(id -g)   # Linux; no macOS pode pular
docker compose up --build
```

### 6. Prove a espinha dorsal

Abra `http://localhost:3000`, entre com a senha, clique em **enfileirar ping**.

O job precisa sair de `na fila` → `rodando` (com a barra de progresso andando) →
`concluído`, na tela, sem você recarregar nada. Só depois disso vale começar a
Fase 1. Se essa base não estiver provada, todo bug futuro vira dúvida sobre se o
problema é o pipeline ou é a fila.

## Login no Instagram (a partir da Fase 2)

```bash
npm run login
```

**Este comando roda no host, nunca dentro do Docker.** Ele abre um Chromium com
janela para você logar na mão — Playwright headed em container precisaria de
servidor gráfico, e o ponto é justamente que o login aconteça do seu navegador,
no seu IP, do jeito que você sempre entra.

A sessão vai para `apps/worker/data/session/instagram.json`, com permissão 600.
O `docker-compose.yml` monta `apps/worker/data` como volume, então o container
enxerga essa sessão sem que ela nunca entre na imagem.

Na primeira vez você precisa dos browsers do Playwright no host:

```bash
npx playwright install chromium
```

O worker **nunca** faz login programático e **nunca** armazena sua senha. Se a
sessão expirar, o job falha com mensagem clara pedindo para você rodar
`npm run login` de novo — ele não reloga sozinho.

> **Sobre a conta.** Automação de navegador viola os Termos do Instagram, e as
> regras de operação abaixo reduzem o risco de bloqueio mas não zeram. Se for
> usar uma conta secundária, use uma que **já exista há tempo e tenha uso humano
> normal** — conta recém-criada que só navega perfis é mais suspeita, não menos.

## Regras de operação do scraper

Não são negociáveis e estão implementadas na infraestrutura, não na boa vontade
de quem escreve o handler:

- Espera aleatória entre ações, nunca valor fixo (`packages/config`)
- Scroll incremental com pausas, nunca `scrollTo` direto para o fim
- Teto diário de perfis, posts abertos, vídeos baixados e navegações
- **Circuit breaker**: checkpoint, captcha, rate limit, sessão expirada ou
  redirecionamento inesperado param tudo na hora. O job vira `blocked`, com o
  motivo, e **não** é reprocessado sozinho. Quem decide retomar é você.
- Sessão única e persistente. Nunca relogar automaticamente.
- Nunca acessar perfil privado. Nunca seguir, curtir, comentar ou interagir.
  Somente leitura.
- Toda ação logada em `apps/worker/data/logs/molde-AAAA-MM-DD.jsonl`

### Três desfechos ruins, três tratamentos

A distinção mais importante do sistema:

| Situação                                                  | Estado           | O que acontece                                                                              |
| --------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------- |
| Sinal do Instagram (checkpoint, captcha, sessão expirada) | `blocked`        | Para tudo. Terminal. Nunca repete sozinho.                                                  |
| Teto diário nosso                                         | volta a `queued` | Reagendado para depois da virada do dia. **Não é falha.** O que já foi coletado fica salvo. |
| Erro de verdade                                           | `failed`         | Registra o stack.                                                                           |

Um post que não carregou não é nenhum dos três: é registrado, pulado, e o job
segue. O worker nunca morre por causa de um post.

### Gravação incremental

O scraping não é transacional. Cada post é gravado assim que coletado, via
`upsert_post`, com chave `shortcode`. Se o worker morrer no post 80 de 100, os
80 estão salvos. E uma passada pelo grid nunca apaga dado que uma passada
anterior, com o post aberto, já tinha gravado — a função só sobrescreve os
campos que a coleta atual de fato observou.

## Detecção de outlier

A peça central da ferramenta, e o lugar onde é fácil se enganar.

A mediana **não é global**: é a mediana móvel dos 15 posts vizinhos no tempo. Um
post de dois anos atrás com 3x a mediana global pode ser apenas um perfil que
tinha um décimo dos seguidores. Post com menos de 14 dias é marcado como
`provisional` e fica fora do cálculo da baseline, porque ainda está acumulando.

Cada métrica registra em qual base foi medida (`metric_basis`): `likes_comments`,
`views` ou `comments_only`. Perfil que esconde curtidas nunca entra na mesma
mediana de quem mostra. Tudo em `post_metrics` é derivado de `posts` e pode ser
recalculado sem voltar ao Instagram.

Os números (janela, tiers, janela de provisório) estão em `packages/config`.

## Custo

`video_analyses.cost_usd`, `profile_analyses.cost_usd` e `jobs.cost_usd` guardam
o custo estimado de API por job, junto do detalhamento de tokens em `usage`. Os
preços de referência estão em `packages/config`.

## Fases

- **Fase 0 — Scaffold.** ✅ Monorepo, schema, fila funcionando de ponta a ponta.
- **Fase 1 — Módulo B**, com upload de arquivo. Upload vai direto do browser
  para o Supabase Storage por signed URL (o body de uma API route na Vercel morre
  em ~4,5 MB). Pipeline: ffmpeg extrai áudio e frames por detecção de cena →
  Groq transcreve → Claude estrutura → tela de resultado.
- **Fase 2 — Login e coleta.** Script de login, sessão persistida, scraper de
  perfil coletando dados básicos e grid. Sem IA ainda: primeiro provar que a
  coleta é estável e discreta.
- **Fase 3 — Outliers.** Mediana móvel, detecção, e o pipeline da Fase 1 ligado
  nos vídeos outliers. Síntese do perfil e biblioteca de ganchos.
- **Fase 4 — Destaques, comentários e perfis semelhantes.** Aqui entram os
  embeddings, com a escolha do modelo feita na hora, e não meses antes.

## Comandos

```bash
npm run dev:web        # Next em localhost:3000
npm run dev:worker     # worker com reload
npm run login          # login no Instagram (HOST, nunca no Docker)
npm run typecheck      # tsc em todos os workspaces
npm run format         # prettier
npm run db:push        # aplica migrations
docker compose up      # worker containerizado
```

## Gerar tipos do banco

`packages/shared/src/domain.ts` é escrito à mão, espelhando as migrations. Para
conferir contra o schema real:

```bash
supabase gen types typescript --linked > /tmp/db-types.ts
```
