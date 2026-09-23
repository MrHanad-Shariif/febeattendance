# Web image: builds the React app, then serves it with Caddy (automatic HTTPS)
# and proxies /api to the backend. Build context is the repository root.

FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Same origin as the site, so no CORS is needed and no absolute URL is baked in.
ENV VITE_API_BASE_URL=/api
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
