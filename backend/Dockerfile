

# syntax=docker/dockerfile:1

# --- Build stage ---
FROM node:22-slim AS build
WORKDIR /app

# Native modules (better-sqlite3, argon2) need build toolchain
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# --- Runtime stage ---
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# WireGuard + Wake-on-LAN tooling invoked by the backend
RUN apt-get update \
  && apt-get install -y --no-install-recommends wireguard-tools wakeonlan iproute2 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Data volume mount point (SQLite + rendered WG configs)
VOLUME ["/data"]
ENV DATA_DIR=/data

EXPOSE 8080
CMD ["node", "dist/index.js"]
