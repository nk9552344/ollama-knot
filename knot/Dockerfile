# syntax=docker/dockerfile:1.7
# =============================================================================
# Knot — MCP Studio
# Multi-stage production build of the Next.js app.
#
# Build:   docker build -t knot .
# Run:     docker run -p 3000:3000 -v $(pwd)/data:/app/data \
#            -e OLLAMA_HOST=http://host.docker.internal:11434 knot
# Compose: docker compose up --build
# =============================================================================

# ────────────────────────── Stage 1: install deps ───────────────────────────
FROM node:20-alpine AS deps
# libc6-compat: glibc compatibility shim
# python3 make g++: required to compile native addons (arm/v7 has no prebuilt binaries)
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
# Copy only manifests first so changes to source don't bust this layer.
COPY package.json package-lock.json* ./
RUN npm ci

# ──────────────────────────── Stage 2: build ────────────────────────────────
FROM node:20-alpine AS builder
# Same tools needed here in case any postinstall/build script compiles native code
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# Produces .next/standalone/server.js, .next/static/, etc.
RUN npm run build

# ──────────────────────────── Stage 3: runtime ──────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/app/data \
    OLLAMA_HOST=http://host.docker.internal:11434
# Run as a dedicated non-root user.
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 --ingroup nodejs nextjs
# Pre-create the data dir so the volume mount inherits the right owner.
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data
# Copy the standalone bundle and the static assets it doesn't include.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:'+process.env.PORT+'/', (r)=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "server.js"]