# ─────────────────────────────────────────────────────────────────────────────
# Yorki — Production Dockerfile
# Build dependencies stay out of the runtime image to keep deployments small.
# ─────────────────────────────────────────────────────────────────────────────

FROM node:24-alpine AS base

RUN apk add --no-cache libc6-compat sqlite

WORKDIR /app

FROM base AS dependencies

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts && npm rebuild better-sqlite3

FROM dependencies AS build

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN NODE_OPTIONS=--max-old-space-size=2048 npm run build
RUN npm prune --omit=dev

FROM base AS runner

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    mkdir -p /app/data /app/public/uploads

COPY --from=build --chown=nextjs:nodejs /app/package.json ./
COPY --from=build --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nextjs:nodejs /app/.next ./.next
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:3000/task/login || exit 1

CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
