# syntax=docker/dockerfile:1

# --- Build stage ---
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

# --- Runtime stage (nginx, unprivileged) ---
# nginx-unprivileged runs entirely as uid 101 with temp paths under /tmp and pid
# at /tmp/nginx.pid, so it needs NO root and NO capabilities — it never chowns.
# This is what lets the compose service run with `cap_drop: ALL` + `read_only`.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
USER root
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/app.conf
COPY --from=build /app/dist /usr/share/nginx/html
USER 101
# Unprivileged nginx cannot bind <1024 without CAP_NET_BIND_SERVICE; listen on 8080.
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
