# Imagen para Railway (u otro hosting con Docker).
#
# La app es Angular (frontend) + un servidor Express (server.js) que sirve la app
# y las rutas /api. La base de datos sigue siendo Firebase (no se usa Postgres).
#
# Build en dos etapas:
#   1) build: instala TODO (incluye dev) y compila Angular -> dist/
#   2) run:   instala solo dependencias de produccion y arranca el servidor.

# ---------- Etapa 1: compilar Angular ----------
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --include=dev
COPY . .
RUN npm run build

# ---------- Etapa 2: imagen final ----------
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY server.js ./
COPY api ./api
# Railway inyecta el puerto en la variable PORT (server.js la usa).
EXPOSE 3000
CMD ["node", "server.js"]
