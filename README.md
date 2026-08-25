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
Você manda um vídeo — **arquivo do computador ou link de um reel** — e recebe o
roteiro anotado: fala com timestamp, texto na tela, descrição de cena, ritmo de
corte e marcação de b-roll. No formato que você usaria para briefar um editor.

> Pelo link, a busca é por **perfil**, não por post: a API oficial não permite
> pedir uma mídia solta. Quando o link não traz o `@` (formato
> `instagram.com/reel/CODIGO`), a tela pergunta qual é o perfil.

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

Precisa de: Node 20+ e uma conta no Supabase. (Docker só para rodar o worker
containerizado — para desenvolver, `npm run dev:worker` basta.)

### 1. Dependências

```bash
npm install
```

### 2. Crie o projeto no Supabase

Em [supabase.com](https://supabase.com): **New project**, região **South America
(São Paulo)**, defina uma database password e guarde ela. Leva uns 2 minutos.

### 3. Aplique o schema

```bash
npm run db:bundle
```

Isso gera `supabase/schema-completo.sql` com as quatro migrations na ordem certa.
Abra o arquivo, copie tudo, e cole no **SQL Editor** do Supabase → **Run**.

Colar em pedaços é a forma mais fácil de aplicar o schema pela metade e depois
não entender por que a fila não funciona. Cole o arquivo inteiro, de uma vez.

### 4. Configure

```bash
npm run setup
```

Pergunta as duas coisas que só você tem (a URL do projeto e a **chave secreta**,
em **Project Settings → API Keys**), gera o `SESSION_SECRET` sozinho, escreve o
`.env` e no final roda o diagnóstico.

Se o projeto só mostrar as chaves antigas, use **Legacy API Keys → service_role**:
o script detecta o formato e grava na variável certa.

Para conferir o estado do setup a qualquer momento:

```bash
npm run doctor
```

### 5. Suba a web

```bash
npm run dev:web    # http://localhost:3000
```

### 6. Suba o worker

Modo direto, sem container (mais simples para desenvolver):

```bash
npm run dev:worker
```

Ou no Docker, que é como ele vai rodar de verdade:

```bash
export MOLDE_UID=$(id -u) MOLDE_GID=$(id -g)   # Linux; no macOS pode pular
docker compose up --build
```

### 7. Prove a espinha dorsal

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

## Rodando sem máquina local

O worker também roda dentro do GitHub Actions, sob demanda — útil quando você não
quer (ou não pode) manter um terminal aberto.

**Ligando sozinho (recomendado).** Configure `GITHUB_TOKEN` e `GITHUB_REPO` nas
variáveis de ambiente da Vercel e o worker passa a ligar sozinho toda vez que um
trabalho entra na fila. O token é um *fine-grained token* com permissão
**Actions: Read and write** no repositório.

Sem isso, todo trabalho fica parado esperando — e a tela avisa quando é o caso,
em vez de dizer só "na fila".

**Na mão:** Actions → **Worker** → **Run workflow** → escolha por quantos
minutos. Ele processa o que estiver na fila e encerra sozinho.

**Secrets necessários** (Settings → Secrets and variables → Actions):
`SUPABASE_URL` e `SUPABASE_SECRET_KEY`. A partir da Fase 1, também `GROQ_API_KEY`
e `ANTHROPIC_API_KEY`.

**Para enfileirar um job sem a interface**, pelo SQL Editor do Supabase:

```sql
insert into jobs (type, payload)
values ('ping', '{"message":"teste","sleepMs":8000}'::jsonb);

select status, result from jobs order by created_at desc limit 1;
```

> **Isto vale só até a Fase 2.** O scraping do Instagram não pode rodar no GitHub:
> a sessão é do seu IP residencial, e navegar com ela a partir de um datacenter é
> o padrão que mais dispara checkpoint. Naquela fase o worker volta para a sua
> máquina, e o `npm run login` continua sendo obrigatoriamente local.

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

## Provedor de análise

A transcrição é sempre Groq (Whisper). A **estruturação do roteiro** é trocável:
`models.analysis` em `packages/config` escolhe entre os provedores declarados em
`analysisProviders`, e o pipeline não percebe a diferença.

| Provedor | Modelo | Por vídeo | Observação |
|---|---|---|---|
| `groq` (ativo) | `llama-4-scout` | **grátis** | Usa a mesma chave da transcrição — nenhuma conta a mais. Aceita poucas imagens por requisição (5), então a análise visual é mais rasa. |
| `deepseek` | `deepseek-v4-flash-vision-exp` | ~US$ 0,012 | Sem `json_schema` — o formato é validado na aplicação. Comprime cada imagem para 384 tokens. |
| `anthropic` | `claude-sonnet-5` | ~US$ 0,07 | Formato garantido pelo modelo, melhor leitura de texto na tela. |

Cada provedor declara quantas imagens aceita (`maxImages`), e a amostragem de
quadros se ajusta sozinha — trocar de provedor não exige mexer em mais nada.

Trocar é uma palavra em `packages/config/src/index.ts`, mais a chave do provedor
no `.env` (ou nos secrets do GitHub).

## Como a coleta funciona

Existem **duas fontes**, e `collection.source` em `packages/config` escolhe qual.
O handler do Módulo A não sabe qual está ativa.

### `graph` — API oficial (padrão)

Business Discovery do Instagram Graph API. **Risco zero para a sua conta**, e roda
em qualquer lugar — inclusive dentro do GitHub Actions, o que dispensa manter
máquina ligada.

| Entrega | Não entrega |
|---|---|
| Perfil, seguidores, bio, link | Texto dos comentários (só a contagem) |
| Curtidas e comentários por post | Destaques fixados |
| Tipo de mídia e timestamp | Perfis sugeridos |
| **O arquivo do vídeo** (`media_url`) | Perfil pessoal ou privado |

Ou seja: **a detecção de outlier e a extração de roteiro funcionam inteiras.**
O que se perde é periférico.

Uma nota sobre os números: as curtidas aqui são métrica **orgânica**, enquanto o
app mostra orgânico + impulsionado. Como a diferença é consistente entre os
posts, a detecção de outlier continua valendo — mas o número absoluto pode ser
menor do que o que você vê na tela.

### `scraper` — navegador com a sua sessão

Alcança o que a API não alcança, mas **exige rodar numa máquina sua** (a sessão é
do seu IP residencial) e carrega risco de bloqueio. Não é o padrão.

Ele lê o JSON que a própria página já busca, em vez de raspar o DOM ofuscado: a
classe CSS muda toda semana, a chave do payload quase nunca. O DOM é o plano B.
Tudo que conhece a forma do Instagram vive em `apps/worker/src/scraper/selectors.ts` —
quando quebrar, conserta-se ali e em lugar nenhum mais.

### Em comum

A ordem das etapas é economia: primeiro o barato (perfil e listagem), depois o
caro (abrir post, baixar vídeo) e só nos outliers. Se o teto estourar no meio, o
que ficou salvo já é a parte mais valiosa — e a gravação é incremental, post a
post.

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
- **Fase 1 — Módulo B.** ✅ Upload de arquivo → roteiro anotado.
- **Fase 2 — Login e coleta.** ✅ Sessão persistida, coleta de perfil e grid.
- **Fase 3 — Outliers e dossiê.** ✅ Mediana móvel, detecção, pipeline da Fase 1
  ligado nos vídeos que explodiram, síntese e biblioteca de ganchos.
- **Fase 4 — Destaques, comentários e perfis semelhantes.** Aqui entram os
  embeddings, com a escolha do modelo feita na hora, e não meses antes.

## Comandos

```bash
npm run setup          # configura o .env e diagnostica o setup
npm run doctor         # confere o setup a qualquer momento
npm run db:bundle      # gera supabase/schema-completo.sql para colar no painel
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
