FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
# azure-deploy.sh --image requires the revision label to equal the clean deploy checkout's HEAD.
ARG SOURCE_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/CarlosSardo/touchline" \
      org.opencontainers.image.revision="${SOURCE_REVISION}"
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/shared ./shared
COPY --from=build --chown=node:node /app/tsconfig*.json ./
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3001
CMD ["npm", "start"]