# Builds the app and its small server. The family is not part of the image:
# docker-compose.yml mounts the data/ folder, which the server reads and
# writes live — an edit in the app lands in data/family.md straight away.

FROM node:22 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# off: country names without flags, and no flag font in the image.
ARG STAMMBAUM_FLAGS=on
RUN STAMMBAUM_FLAGS=$STAMMBAUM_FLAGS npm run build

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
ENV NODE_ENV=production \
    DATA_DIR=/data \
    HOST=0.0.0.0 \
    PORT=8080
EXPOSE 8080
USER node
# Up is up: /healthz answers without the proxy's secret and says nothing about the family.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist-server/main.js"]
