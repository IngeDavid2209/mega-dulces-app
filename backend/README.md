# Mega Dulces Backend

Backend Node.js + Express + Prisma + PostgreSQL para Mega Dulces Task.
Reemplaza Firestore (datos) y Firebase Auth (autenticacion). FCM se mantiene
en Firebase (no se toca).

## Stack

- Node.js 20+
- TypeScript
- Express (servidor HTTP)
- Prisma (ORM)
- PostgreSQL (DB)
- bcryptjs (hash de contrasenas) — en Fase 2
- jsonwebtoken (JWT) — en Fase 2
- zod (validacion) — en Fase 3
- firebase-admin (solo para script de migracion Firestore → Postgres) — en Fase 4

## Estructura

```
backend/
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── prisma/
│   ├── schema.prisma         # Modelo de datos (Fase 1)
│   └── migrations/           # Migraciones SQL (se generan con prisma migrate)
├── src/
│   ├── index.ts              # Entry point (listener Express)
│   ├── server.ts             # Configuracion de la app + health endpoint
│   ├── services/
│   │   └── prisma.ts         # Cliente Prisma singleton
│   ├── routes/               # (Fase 2 y 3)
│   ├── controllers/          # (Fase 2 y 3)
│   ├── middleware/           # auth + rolesGuard (Fase 2)
│   └── utils/
└── scripts/
    ├── seed-admin.ts         # Crear primer admin (Fase 2)
    └── migrate-firestore.ts  # Migrar datos Firestore → Postgres (Fase 4)
```

## Setup inicial (primera vez)

### 1. Levantar PostgreSQL

Opciones en orden de preferencia:

**Opcion A — Docker (recomendado en local):**
```bash
docker run --name mega-postgres \
  -e POSTGRES_USER=mega \
  -e POSTGRES_PASSWORD=mega \
  -e POSTGRES_DB=mega_dulces \
  -p 5432:5432 \
  -d postgres:16
```

**Opcion B — Postgres gestionado (free tier):**
- [Supabase](https://supabase.com) — 500MB free, incluye realtime.
- [Neon](https://neon.tech) — 0.5GB free, serverless.
- [Railway](https://railway.app) — $5 free credits/mes.

Crea un proyecto, copia el DATABASE_URL al `.env`.

### 2. Configurar variables de entorno

```bash
cd backend
cp .env.example .env
# editar .env con tus valores reales
```

Genera un JWT_SECRET fuerte:
```bash
# Linux/Mac:
openssl rand -base64 48
# Windows PowerShell:
[Convert]::ToBase64String((1..36 | %{ Get-Random -Maximum 256 }))
```

### 3. Instalar dependencias

```bash
cd backend
npm install
```

Esto tambien dispara `prisma generate` que crea el cliente tipado.

### 4. Aplicar migraciones a la base de datos

```bash
npm run prisma:migrate -- --name init
```

Esto crea todas las tablas definidas en `schema.prisma`. La primera vez se
genera la carpeta `prisma/migrations/` con el SQL.

### 5. Levantar el servidor en desarrollo

```bash
npm run dev
```

Deberias ver:
```
[mega-dulces-backend] escuchando en http://localhost:3000
[mega-dulces-backend] env=development
[mega-dulces-backend] health: http://localhost:3000/health
```

## Probar lo construido en Fase 1

### Health check

```bash
curl http://localhost:3000/health
```

Respuesta esperada (si Postgres esta conectado):
```json
{
  "ok": true,
  "service": "mega-dulces-backend",
  "db": "connected",
  "env": "development",
  "timestamp": "2026-06-10T..."
}
```

Si la DB no esta conectada:
```json
{
  "ok": false,
  "service": "mega-dulces-backend",
  "db": "unreachable",
  "error": "..."
}
```

### Verificar tablas en Postgres

```bash
npm run prisma:studio
```

Abre http://localhost:5555 con un explorador visual de la DB. Deberias ver las
11 tablas vacias:
- `usuarios`
- `checklists`
- `areas`
- `rutinas_catalogo`
- `asignaciones_rutinas`
- `moldes_checklists`
- `tareas_equipo`
- `tareas_unicas`
- `notificaciones`
- `descansos_semanales`

### Probar un endpoint 404

```bash
curl http://localhost:3000/api/no-existe
# {"error":"Not found","path":"/api/no-existe"}
```

## Migrar datos desde Firestore (Fase 4)

Script idempotente que lee TODAS las colecciones de Firestore con
firebase-admin y las inserta en Postgres. Se puede re-ejecutar las veces que
quieras: usa upsert por `docIdFirebase` y nunca duplica.

### Pre-requisitos

1. **Backend en marcha** (`npm run dev` debe responder en /health).
2. **Schema aplicado** en Postgres (`npm run prisma:migrate`).
3. **Service account de Firebase Admin**: descargar el JSON desde
   Firebase Console → Project Settings → Service accounts → "Generate new
   private key". El archivo descargado NO se commitea (esta en `.gitignore`).

### Configurar credencial

Tienes dos formas. Cualquiera funciona:

**A. JSON inline en `.env`** (recomendado en CI/servidor remoto):

```bash
# en backend/.env
FIREBASE_SERVICE_ACCOUNT='{"type":"service_account","project_id":"...", ...}'
```

Pega el JSON COMPLETO en una sola linea entre comillas simples para escapar
las comillas dobles internas.

**B. Archivo separado** (recomendado en local):

```bash
# Pon el archivo descargado en: backend/service-account.json
# en backend/.env:
GOOGLE_APPLICATION_CREDENTIALS="./service-account.json"
```

### Ejecutar la migracion

```bash
cd backend
npm run migrate:firestore
```

Salida esperada:

```
============================================================
  MIGRACION FIRESTORE → POSTGRESQL
============================================================
[firebase] inicializado correctamente

--- Etapa 1: identidad ---
  usuarios                      52 leidos |    52 insertados |     0 actualizados |     0 saltados |   0 errores  (3 sin password — pedir reset)

--- Etapa 2: catalogos ---
  areas (+ areas_operativas)    18 leidos |    18 insertados |     0 actualizados |     0 saltados |   0 errores
  rutinas_catalogo              42 leidos |    42 insertados |     0 actualizados |     0 saltados |   0 errores

--- Etapa 3: configuracion ---
  asignaciones_rutinas          88 leidos |    88 insertados |     0 actualizados |     0 saltados |   0 errores
  moldes_checklists             15 leidos |    15 insertados |     0 actualizados |     0 saltados |   0 errores
  tareas_equipo                  6 leidos |     6 insertados |     0 actualizados |     0 saltados |   0 errores

--- Etapa 4: operacion ---
  checklists                  1244 leidos |  1244 insertados |     0 actualizados |     0 saltados |   0 errores
  notificaciones               320 leidos |   320 insertados |     0 actualizados |     0 saltados |   0 errores
  descansos_semanales           48 leidos |    48 insertados |     0 actualizados |     0 saltados |   0 errores

--- Etapa 5: subcollections ---
  tareas_unicas (sub)          120 leidos |   120 insertados |     0 actualizados |     0 saltados |   0 errores

============================================================
  RESUMEN
============================================================
  TOTAL: 1953 leidos | 1953 insertados | 0 actualizados | 0 saltados | 0 errores
  Tiempo total: 23.4s
============================================================
```

### Que hace exactamente

| Orden | Coleccion Firestore | Tabla Postgres | Nota |
|---|---|---|---|
| 1 | `usuarios` + `users` | `usuarios` | Si hay password en plano, se hashea con bcrypt. |
| 2 | `areas` + `areas_operativas` | `areas` | Consolida por `nombre` (dedup). |
| 3 | `catalogo_rutinas` | `rutinas_catalogo` | — |
| 4 | `asignaciones_rutinas` | `asignaciones_rutinas` | Resuelve FK a rutina mapeando docIds. |
| 5 | `moldes_checklists` | `moldes_checklists` | — |
| 6 | `tareas_equipo` | `tareas_equipo` | — |
| 7 | `checklists` | `checklists` | Resuelve FK a usuario (createdByUid) por nombre. |
| 8 | `notificaciones` | `notificaciones` | — |
| 9 | `descansos_semanales` | `descansos_semanales` | Upsert por `(empleado, semanaIso)`. |
| 10 | `usuarios/{uid}/tareas_unicas` (sub) | `tareas_unicas` | Itera por usuario y lee la subcoleccion. |

### NO se migra (intencional)

- `usuarios_tokens` (tokens FCM) — queda en Firestore, FCM se mantiene.
- `indice_login` — reemplazado por el UNIQUE en `Usuario.usuario`.

### Si algo falla

El script reporta errores por linea pero continua con el resto. Al final
indica cuantos errores hubo y termina con exit code 2. Puedes:

1. Revisar los mensajes de error en consola.
2. Corregir lo que aplique (ej. campo invalido en algun doc).
3. Re-ejecutar `npm run migrate:firestore` — solo procesara lo que no se inserto.

## Proximas fases

- **Fase 5**: plan de adaptacion del frontend Angular (NO ejecutar sin
  aprobar primero).

## Notas

- El archivo `.env` NUNCA se commitea. Esta en `.gitignore`.
- El service account JSON de Firebase tampoco. Se usa solo en Fase 4.
- FCM y `firebase-messaging-sw.js` siguen funcionando con Firebase. Este
  backend no los toca.
