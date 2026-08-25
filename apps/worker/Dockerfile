# Imagem oficial do Playwright: ja traz Chromium e todas as libs de sistema
# que ele precisa. A versao TEM que bater com a do package.json.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

# ffmpeg para extrair audio e frames. E o motivo de o worker nao caber na Vercel.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*

# yt-dlp resolve o link do Instagram sem login. Versao travada: tem que bater
# com `ingest.ytdlpVersion` no packages/config e com o workflow.
RUN pip3 install --no-cache-dir --break-system-packages "yt-dlp==2026.8.19"

WORKDIR /app

ENV NODE_ENV=production \
    MOLDE_IN_CONTAINER=1 \
    MOLDE_DATA_DIR=/data

# Manifestos primeiro: enquanto as dependencias nao mudam, esta camada e cache.
COPY package.json package-lock.json* ./
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY apps/worker/package.json ./apps/worker/

# Só o worker e o que ele usa. Sem Next, sem React.
RUN npm ci --workspace @molde/worker --include-workspace-root \
  || npm install --workspace @molde/worker --include-workspace-root

COPY packages ./packages
COPY apps/worker ./apps/worker

# O storageState e os logs vivem aqui, num volume montado do host.
VOLUME ["/data"]

CMD ["npm", "run", "start", "-w", "@molde/worker"]
