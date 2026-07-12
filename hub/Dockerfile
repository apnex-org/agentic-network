# hub/Dockerfile — built from the REPO ROOT context (idea-186 npm workspaces;
# cleanslate0 hub_rebase). `hub` is a root workspace; @apnex/storage-provider +
# @apnex/repo-event-bridge resolve via workspace symlinks and are built
# topologically in the builder.
#
# bug-38 re-litigation: the old build used `npm install` (not `npm ci`) because
# the transient tarball-swap rewrote deps to `file:./<tarball>` refs that the
# committed lockfile could not strictly validate — so host-side lockfile regen
# was fragile (host-vs-container npm/node drift). With hub in the npm workspace,
# `npm ci` runs against the committed ROOT lockfile, validated IN-CONTAINER —
# the lockfile is the single source of truth, no host regen, drift dissolved.
# Sovereign packages are staged via workspace resolution, not `npm pack`.
FROM node:22-slim AS builder
WORKDIR /repo

# 1. Manifests + lockfile first (layer-cache friendly). Scoped install: only
#    hub's workspace subtree (hub + its @apnex/* deps), not the whole monorepo.
COPY package.json package-lock.json ./
COPY hub/package.json ./hub/
COPY packages/storage-provider/package.json ./packages/storage-provider/
COPY packages/repo-event-bridge/package.json ./packages/repo-event-bridge/
RUN npm ci --workspace=hub --include-workspace-root --ignore-scripts --no-audit --no-fund

# 2. Source for the 3 build targets, then explicit TOPOLOGICAL build (deps first).
#    (Replaces the retired `prepare` cascade, which auto-built these on install.)
COPY packages/storage-provider ./packages/storage-provider
COPY packages/repo-event-bridge ./packages/repo-event-bridge
COPY hub ./hub
RUN npm run build --workspace=@apnex/storage-provider \
                  --workspace=@apnex/repo-event-bridge \
                  --workspace=hub

# 3. Drop dev deps for a lean runtime tree (keeps prod deps + workspace symlinks).
RUN npm prune --omit=dev --workspace=hub --include-workspace-root --ignore-scripts

# ── Production stage ──────────────────────────────────────────────────
FROM node:22-slim
WORKDIR /repo

# Pruned install (workspace symlinks + prod deps) + the built workspace dirs.
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/package.json ./package.json
COPY --from=builder /repo/packages/storage-provider ./packages/storage-provider
COPY --from=builder /repo/packages/repo-event-bridge ./packages/repo-event-bridge
COPY --from=builder /repo/hub ./hub

# C3-R1 M-Roll-Signal (idea-340) deploy-truth stamp: scripts/local/build-hub.sh
# generates hub/build-info.json into the context; hub/dist/index.js reads
# ../build-info.json (= /repo/hub/build-info.json) at boot and reports it on
# /health so CI can confirm the image rolled. (COPYed as part of `hub` above.)

# Cloud Run uses PORT env var (defaults to 8080)
ENV PORT=8080
EXPOSE 8080

# Run as non-root user
RUN adduser --disabled-password --gecos "" appuser && chown -R appuser:appuser /repo
USER appuser

CMD ["node", "hub/dist/index.js"]
