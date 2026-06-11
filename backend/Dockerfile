# =============================================================================
# Dockerfile multi-stage para el backend Node + Express + Prisma + PostgreSQL
# =============================================================================
# Stage 1 (builder): instala TODAS las deps (incluido devDeps), genera el
# cliente Prisma y compila TypeScript a JS.
# Stage 2 (runtime): imagen final ligera con solo las deps de produccion +
# el JS compilado + cliente Prisma generado. Sin TS, sin tsx, sin tooling.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: builder
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

# Instalamos deps del sistema necesarias para Prisma (OpenSSL).
RUN apk add --no-cache openssl

# Cache de dependencias: primero copiamos solo package.json y el schema
# (el schema afecta a `prisma generate` que corre con `npm install`).
COPY package*.json ./
COPY prisma ./prisma

# Instalamos TODAS las dependencias (incluido devDeps porque necesitamos tsc).
# `npm ci` requiere package-lock.json; si no existe, falla y queda claro.
RUN npm ci

# Copiamos el codigo fuente y compilamos.
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: runtime
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache openssl

# Solo deps de produccion.
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force

# Copiamos el JS compilado y los node_modules del builder ya con prisma
# generado (asi no tenemos que volver a correr `prisma generate`).
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Railway inyecta $PORT en runtime — Express lo lee desde process.env.PORT.
# EXPOSE es solo documentacion; Railway abre el puerto que el servicio reporte.
EXPOSE 3000

# Aplica migraciones pendientes ANTES de arrancar. Si la primera vez no hay
# DB lista, fallara y reintenta — Railway lo reinicia hasta que se conecte.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/index.js"]
