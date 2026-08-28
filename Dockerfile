# ---- Build-Stufe ----
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci
COPY . .
RUN npm run build

# ---- Runtime-Stufe ----
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci --omit=dev
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
# Unraid-User-Scripts: werden beim Start nach /data kopiert
COPY Kodi_movie-db_sync.py Kodi_movie-db_enrich.py Kodi_movie-db_poster.py Kodi_movie-db_actors.py /app/scripts/
ENV DB_PATH=/data/filmdatenbank.db
ENV PORT=3000
VOLUME /data
EXPOSE 3000
# Server löst client/dist relativ zu process.cwd() auf (../client/dist).
WORKDIR /app/server
CMD ["node", "dist/index.js"]
