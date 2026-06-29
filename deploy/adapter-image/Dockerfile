# Reproducible claude-harness adapter image — Adapter-Modernization Pilot P1a.
#
# Provenance pin: idea-398 -> Design v1.0 (66a8f721) §8/§9. Director-direct.
#
# Determinism controls (Design §8):
#   - source-bake @ GIT_SHA: build context is a clean `git archive <SHA>` (tracked
#     files only -> dirty-free AND cred-free by construction), workspace @apnex/*:"*"
#     refs resolve IN-TREE (no publish-path caret enters the image).
#   - npm ci: external deps (only @modelcontextprotocol/sdk) integrity-pinned by
#     the committed package-lock.json. No node-gyp/native modules (binding.gyp=0).
#   - digest-pinned base image (below).
#   - SOURCE_DATE_EPOCH: pins the ONE nondeterministic input — write-build-info.js
#     buildTime=new Date() -> overwritten deterministically (see RUN below) -> and,
#     on buildkit >=0.11 with rewrite-timestamp, normalizes layer mtimes + the image
#     config `created` field so same SHA -> same image digest.
#
# Cred-free (pillar-2): the image bakes NO secrets — context is tracked-files-only,
# .dockerignore excludes cred/secret/env paths, and runtime creds are mount-injected
# (Design §5), never baked.

ARG NODE_BASE=node:22-bookworm-slim@sha256:813a7480f28fdadac1f7f5c824bcdad435b5bc1322a5968bbbdef8d058f9dff4

# ── builder stage ───────────────────────────────────────────────────────
FROM ${NODE_BASE} AS builder
ARG SOURCE_DATE_EPOCH
ARG GIT_SHA=unknown
ARG GIT_BRANCH=main
ARG REPRO_CONTROLS=on
ENV CI=1
WORKDIR /build

# Baked source = the submitted context (clean git-archive of GIT_SHA).
COPY . .

# Neutralize the workspace prepare-cascade: packages/repo-event-bridge +
# packages/storage-provider declare "prepare":"npm run build", which npm ci runs in
# PACKAGE (not dependency) order -> repo-event-bridge builds before its dep
# storage-provider -> TS2307. Neither is in the adapter's dependency closure (we build
# the adapter packages explicitly + in dep-order below), so stripping prepare is a
# deterministic build-time control that does NOT alter any shipped adapter code.
RUN node -e "for (const p of ['packages/repo-event-bridge/package.json','packages/storage-provider/package.json']) { const j=require('./'+p); if (j.scripts) delete j.scripts.prepare; require('fs').writeFileSync(p, JSON.stringify(j,null,2)+'\n'); console.error('[prep-strip] '+p); }"

# Deterministic external-dep install. --ignore-scripts so no lifecycle hook runs
# nondeterministically at install; --no-audit/--no-fund for hermeticity.
RUN npm ci --ignore-scripts --no-audit --no-fund

# Build the adapter workspaces in dependency order (tsc). The `build` script's
# `prebuild` hook (write-build-info.js) stamps dist/build-info.json with
# buildTime=now (git unavailable in-container -> commitSha=unknown); we overwrite
# it deterministically below when controls are ON.
RUN npm run build --workspace=@apnex/message-router --if-present \
 && npm run build --workspace=@apnex/cognitive-layer --if-present \
 && npm run build --workspace=@apnex/network-adapter --if-present \
 && npm run build --workspace=@apnex/claude-plugin --if-present

# DETERMINISTIC provenance stamp (controls ON): pin commitSha=GIT_SHA, dirty=false,
# buildTime=SOURCE_DATE_EPOCH across every dist/build-info.json. Controls OFF (the
# non-vacuity mutation): SKIP this -> the prebuild's buildTime=now survives -> the
# image content diverges build-to-build -> the digest-equality test goes RED,
# proving the SOURCE_DATE_EPOCH control is load-bearing (not a vacuous green).
COPY _p1a-stamp.cjs /tmp/stamp.cjs
RUN if [ "$REPRO_CONTROLS" = "on" ]; then \
      node /tmp/stamp.cjs "$GIT_SHA" "$SOURCE_DATE_EPOCH" "$GIT_BRANCH"; \
    else \
      echo "[stamp] REPRO_CONTROLS=off -> skipping deterministic stamp (non-vacuity mutation)"; \
    fi

# ── runtime stage ───────────────────────────────────────────────────────
FROM ${NODE_BASE} AS runtime
ARG SOURCE_DATE_EPOCH
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.title="apnex-claude-adapter"
ENV NODE_ENV=production
WORKDIR /app

# The built adapter + its resolved deps (workspace symlinks + @modelcontextprotocol/sdk).
COPY --from=builder /build/package.json /build/package-lock.json ./
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/packages ./packages
COPY --from=builder /build/adapters ./adapters

# Normalize app-tree mtimes to SOURCE_DATE_EPOCH (belt-and-suspenders alongside
# buildkit rewrite-timestamp; also makes a content/rootfs digest deterministic if
# the image-digest path is ever degraded).
RUN find /app -exec touch -h -d "@${SOURCE_DATE_EPOCH}" {} +

# Non-root (house style).
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin appuser \
 && chown -R appuser:appuser /app
USER appuser

# P1a proves the build is reproducible + provenance-guaranteed. The PID-1 supervisor
# + claude CLI + tmux (Design §2 EMBEDDED) are P1e's concern; this entrypoint runs
# the stdio MCP kernel-shim directly as the minimal real artifact.
ENTRYPOINT ["node", "adapters/claude-plugin/dist/shim.js"]
