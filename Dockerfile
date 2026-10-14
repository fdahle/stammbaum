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
CMD ["node", "dist-server/main.js"]
