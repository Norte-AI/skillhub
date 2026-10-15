FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
RUN npm ci --omit=dev && mkdir -p /var/lib/skillhub/data /var/lib/skillhub/git && chown -R node:node /var/lib/skillhub
USER node
ENV NODE_ENV=production SKILLHUB_HOST=0.0.0.0 PORT=4317 SKILLHUB_DATA_DIR=/var/lib/skillhub/data SKILLHUB_GIT_ROOT=/var/lib/skillhub/git
EXPOSE 4317
CMD ["node", "apps/server/src/index.mjs"]
