FROM node:22-slim AS builder

WORKDIR /app

COPY package*.json ./
COPY ois-storage-provider-*.tgz ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Production stage ──────────────────────────────────────────────────
FROM node:22-slim

WORKDIR /app

COPY package*.json ./
COPY ois-storage-provider-*.tgz ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Cloud Run uses PORT env var (defaults to 8080)
ENV PORT=8080
EXPOSE 8080

# Run as non-root user
RUN adduser --disabled-password --gecos "" appuser && chown -R appuser:appuser /app
USER appuser

CMD ["node", "dist/index.js"]
