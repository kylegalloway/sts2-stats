# ─── Stage 1: install all dependencies ───────────────────────────────────────
FROM node:22-bookworm-slim AS deps

# build-essential + python3 are required by better-sqlite3 (native addon)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY package.json package-lock.json ./
COPY packages/server/package.json ./packages/server/
COPY packages/client/package.json ./packages/client/

RUN npm ci

# ─── Stage 2: build client (React → static files) ────────────────────────────
FROM deps AS client-build

COPY packages/client/ ./packages/client/
COPY tsconfig.json ./

RUN npm run build -w packages/client

# ─── Stage 3: build server (TypeScript → JS) ─────────────────────────────────
FROM deps AS server-build

COPY packages/server/ ./packages/server/
COPY tsconfig.json ./

RUN npm run build -w packages/server

# ─── Stage 4: production image ───────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package manifests and install production deps only
COPY package.json package-lock.json ./
COPY packages/server/package.json ./packages/server/
COPY packages/client/package.json ./packages/client/

RUN npm ci --omit=dev

# Copy compiled server and built client assets
COPY --from=server-build /build/packages/server/dist ./packages/server/dist
COPY --from=client-build /build/packages/client/dist ./packages/client/dist

# Persistent data lives here — mount a named volume
VOLUME ["/data"]

# Mount your STS2 history directory here, e.g.:
#   -v "$HOME/Library/Application Support/SlayTheSpire2/steam/.../profile1/saves/history":/saves:ro
VOLUME ["/saves"]

ENV PORT=3001
ENV HOSTNAME=0.0.0.0
ENV DB_PATH=/data/sts2.db
ENV STS2_HISTORY_DIR=/saves
ENV STATIC_DIR=/app/packages/client/dist
# Allow requests from any origin when running in a container.
# Override to restrict to a specific URL, e.g. http://myserver:3001
ENV CLIENT_ORIGIN=*

EXPOSE 3001

CMD ["node", "packages/server/dist/index.js"]
