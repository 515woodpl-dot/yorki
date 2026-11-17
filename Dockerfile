# syntax=docker/dockerfile:1
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
# The npm download cache is kept between builds, so a changed dependency only fetches what is new.
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts && npm rebuild better-sqlite3

# Production-only dependencies are installed in their own stage. Docker builds it at the same time
# as `build`, which replaces the slow `npm prune` step.
FROM base AS prod-deps
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts && npm rebuild better-sqlite3

FROM dependencies AS build

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# .next/cache is kept between builds: an unchanged page is not compiled again.
RUN --mount=type=cache,target=/app/.next/cache NODE_OPTIONS=--max-old-space-size=2048 npm run build

FROM base AS runner

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    mkdir -p /app/data /app/public/uploads

COPY --from=build --chown=nextjs:nodejs /app/package.json ./
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nextjs:nodejs /app/.next ./.next
COPY --from=build --chown=nextjs:nodejs /app/public ./public
# Required at runtime: without it `next start` forgets the /task prefix the build used,
# and the page's JavaScript silently never starts.
COPY --from=build --chown=nextjs:nodejs /app/next.config.mjs ./next.config.mjs

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
