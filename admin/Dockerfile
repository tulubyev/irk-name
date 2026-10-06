# syntax=docker/dockerfile:1
# Сборка из корня репозитория: docker build -f admin/Dockerfile .
# Один образ — два сервиса: админка (server.mjs) и приём формы предложений (forms.mjs).
FROM node:22-alpine AS build
WORKDIR /app
COPY admin/package.json admin/package-lock.json admin/
RUN cd admin && npm ci
COPY admin admin
# общая схема записей и справочники сайта
COPY src/lib/person-schema.ts src/lib/taxonomy.ts src/lib/
RUN cd admin && npm run typecheck && npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/admin/dist/server.mjs /app/admin/dist/forms.mjs ./
COPY admin/hash-password.mjs ./hash-password.mjs
# Каталог предложений (том docker наследует владельца node при первом создании)
RUN mkdir -p /data/suggestions && chown node:node /data/suggestions
ENV PORT=3000 NODE_ENV=production SUGGESTIONS_DIR=/data/suggestions
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/admin/healthz || exit 1
CMD ["node", "server.mjs"]
