FROM node:22-slim AS builder

WORKDIR /app

COPY package*.json ./
COPY ois-storage-provider-*.tgz ./
COPY ois-repo-event-bridge-*.tgz ./
# `npm install` (NOT `npm ci`) for the build path while the transient
# tarball-swap codification is in place (mission-50 T5; bug-38; task-386
# extension). The committed lockfile is resolved against
# `file:../packages/<pkg>` refs for local dev; build-hub.sh's transient
# swap rewrites those refs to `file:./<tarball>`, which doesn't match
# the committed lockfile, so strict `npm ci` validation cannot pass
# against the swap-modified package.json. Container-side `npm install`
# resolves the dep tree against its own toolchain (node:22 / npm 10.x).
# Reverts to `npm ci` when idea-186 (npm workspaces) lands and the
# file: refs resolve natively. See deploy/README.md §"Cloud Build
# tarball staging" for the full rationale.
RUN npm install --ignore-scripts --no-audit --no-fund

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Production stage ──────────────────────────────────────────────────
FROM node:22-slim

WORKDIR /app

COPY package*.json ./
COPY ois-storage-provider-*.tgz ./
COPY ois-repo-event-bridge-*.tgz ./
# `npm install` per builder-stage rationale above (mission-50 T5; bug-38;
# task-386 extension).
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund

COPY --from=builder /app/dist ./dist

# Cloud Run uses PORT env var (defaults to 8080)
ENV PORT=8080
EXPOSE 8080

# Run as non-root user
RUN adduser --disabled-password --gecos "" appuser && chown -R appuser:appuser /app
USER appuser

CMD ["node", "dist/index.js"]
