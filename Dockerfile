# Multi-arch (linux/arm64 for the Raspberry Pi, linux/amd64). The UI/type-check stage runs on the build
# platform because its output is architecture-independent; only the production dependencies install per target.
FROM --platform=$BUILDPLATFORM node:24-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --include=dev --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-trixie-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund

FROM node:24-trixie-slim AS runtime
ARG SOURCE_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/CarlosSardo/touchline" \
      org.opencontainers.image.description="Touchline football sporting-director simulation (PostgreSQL)" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.revision="${SOURCE_REVISION}"
# The heap cap leaves room for PostgreSQL on an 8 GB Pi; override NODE_OPTIONS (compose: TOUCHLINE_NODE_OPTIONS) if needed.
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3001 \
    NODE_OPTIONS=--max-old-space-size=1536
WORKDIR /app
# Code stays root-owned and read-only for the unprivileged runtime user; temporary save files go to /tmp.
COPY package.json package-lock.json tsconfig*.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY server ./server
COPY shared ./shared
COPY scripts ./scripts
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.API_PORT}/api/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Operator scripts run in the same image: docker compose exec app npm run db:migrate
CMD ["node", "--import", "tsx", "server/index.ts"]
