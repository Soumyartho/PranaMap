# PranaMap web app: production build served by nginx, which also proxies /api to the API container.
# Build from the repository root (the app imports ../shared):
#   docker build -f frontend/Dockerfile -t pranamap-web .
FROM node:22-alpine AS build
WORKDIR /srv/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY shared /srv/shared
COPY frontend ./
RUN npx vite build && node scripts/bundle-budget.mjs

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /srv/frontend/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
