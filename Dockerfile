# ─────────────────────────────────────────────────────────────────────────────
# Yorki — Production Dockerfile
# Single runtime image that builds once and runs with `next start`
# ─────────────────────────────────────────────────────────────────────────────

FROM node:24-alpine

RUN apk add --no-cache libc6-compat python3 make g++ sqlite

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts && npm rebuild better-sqlite3

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN NODE_OPTIONS=--max-old-space-size=2048 npm run build

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    mkdir -p /app/data /app/public/uploads && \
    chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:3000/task/login || exit 1

CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
