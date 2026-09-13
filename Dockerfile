# syntax=docker/dockerfile:1

# Multi-stage build producing a Next.js standalone server.
# The final image carries only the built output and its runtime deps.

FROM node:22-alpine AS deps
WORKDIR /app
# libc6-compat is needed by sharp's prebuilt binaries on Alpine.
#
# python3/make/g++ are for better-sqlite3, which reads the shorts pipeline's
# database. Its prebuilt binaries are glibc-only, so on Alpine (musl) it
# compiles from source — without a toolchain here, `npm ci` fails outright.
RUN apk add --no-cache libc6-compat python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Bind to all interfaces so the container is reachable on the LAN.
ENV HOSTNAME=0.0.0.0

RUN apk add --no-cache libc6-compat \
  && addgroup -g 1001 -S nodejs \
  && adduser -S nextjs -u 1001

# `output: "standalone"` emits a self-contained server plus a minimal
# node_modules tree.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Growth history lives here; mount a volume so it survives redeploys.
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
VOLUME ["/app/data"]

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
