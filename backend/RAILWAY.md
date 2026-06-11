# Despliegue en Railway — backend Mega Dulces

Guia para deployar el backend Node + Express + Prisma + Postgres en Railway.

---

## Datos del repo

- **URL**: https://github.com/IngeDavid2209/mega-dulces-app
- **Rama**: `feature/backend-migration`
- **Carpeta del backend**: `/backend` (subdirectorio del monorepo)
- **Dockerfile**: `/backend/Dockerfile` (build multi-stage Node 20-alpine)
- **Health check**: `GET /health` → `{ ok: true, db: "connected" }`

---

## Pasos en Railway

### 1. Crear proyecto y vincular repo

1. **Dashboard Railway** → **"New Project"** → **"Deploy from GitHub repo"**.
2. Seleccionar `IngeDavid2209/mega-dulces-app`.
3. **Branch**: cambiar a `feature/backend-migration`.
4. **Root Directory**: configurar a `backend` (en Settings → Source).
5. Railway detectara el Dockerfile automaticamente.

### 2. Agregar Postgres

1. En el mismo proyecto, click en **"+ New"** → **"Database"** → **"Add PostgreSQL"**.
2. Railway crea la instancia y expone variables como `DATABASE_URL`, `PGHOST`, etc.
3. En el servicio del backend, ir a **Variables**.
4. Agregar referencia: `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (Railway autocompleta al escribir `${{` ).

### 3. Variables de entorno del backend

En **Variables** del servicio del backend, agregar:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (referencia, ver paso 2) |
| `JWT_SECRET` | Cadena aleatoria larga. Generar con `openssl rand -base64 48` |
| `JWT_EXPIRES_IN` | `7d` |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | URL del frontend, ej. `https://mega-dulces-app.vercel.app` (separadas por coma si hay varias) |
| `SERVICE_SECRET` | Cadena aleatoria larga. `openssl rand -hex 32` |
| `FIREBASE_SERVICE_ACCOUNT` | (Opcional, solo para correr migracion de datos) JSON del service account en una linea |

**Importante**: NO definir `PORT` manualmente. Railway lo inyecta y Express ya lo lee
desde `process.env.PORT`.

### 4. Configurar dominio publico

1. Servicio del backend → **Settings** → **Networking** → **Generate Domain**.
2. Anotar la URL generada (ej. `mega-dulces-backend.up.railway.app`).
3. Esa URL es la que se le pasa al frontend (sera `BACKEND_URL` en Vercel).

### 5. Deploy

Railway despliega automaticamente cada vez que hay push a la rama. El Dockerfile:
1. Instala deps.
2. Compila TypeScript.
3. Aplica las migraciones Prisma al arrancar (`prisma migrate deploy`).
4. Levanta el server.

Tarda 2-5 min la primera vez. Despues solo el push correspondiente.

### 6. Verificar

```bash
curl https://TU-DOMINIO.up.railway.app/health
# → { "ok": true, "service": "mega-dulces-backend", "db": "connected", ... }
```

Si la DB se conecta y `/health` responde OK, el backend esta vivo.

---

## Migracion inicial de datos (one-shot)

Una vez que el backend este vivo y las tablas creadas (las crea Prisma migrate
en el primer arranque), hay que copiar los datos de Firestore a Postgres.

**Opcion A — desde Railway (recomendado)**

1. Servicio del backend → **Settings** → **Source** → temporalmente cambiar el
   **Start Command** a:
   ```
   npx prisma migrate deploy && npm run migrate:firestore
   ```
2. Configurar `FIREBASE_SERVICE_ACCOUNT` con el JSON del service account de
   Firebase (Project Settings → Service Accounts → Generate new private key).
3. Hacer redeploy. El servicio corre el script y termina.
4. **REVERTIR** el Start Command al original: `npx prisma migrate deploy && node dist/src/index.js`.
5. Redeploy.

**Opcion B — desde local**

```bash
git clone https://github.com/IngeDavid2209/mega-dulces-app
cd mega-dulces-app
git checkout feature/backend-migration
cd backend
npm install
echo "DATABASE_URL=postgresql://... (la URL EXTERNA de Railway)" >> .env
echo 'FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}' >> .env
npm run migrate:firestore
```

La URL EXTERNA de Railway se obtiene del panel de Postgres → **Connect** →
**Public Network**.

---

## Estructura del backend

```
backend/
├── Dockerfile              ← multi-stage build Node 20-alpine
├── .dockerignore
├── package.json            ← scripts: build, start, prisma:migrate:prod, etc.
├── package-lock.json       ← committed para build reproducible
├── tsconfig.json
├── prisma/
│   └── schema.prisma       ← 11 modelos (Usuario, Checklist, Area, ...)
├── src/
│   ├── index.ts            ← entry point
│   ├── server.ts           ← Express + middleware + routes
│   ├── controllers/        ← logica por entidad
│   ├── routes/             ← REST endpoints
│   ├── middleware/         ← auth (JWT), roles, service-secret
│   ├── services/prisma.ts  ← cliente Prisma singleton
│   └── utils/              ← jwt, password (bcrypt), errors, sanitize
└── scripts/
    ├── seed-admin.ts       ← crear primer admin
    └── migrate-firestore.ts ← migracion one-shot Firestore → Postgres
```

Documentacion completa: `backend/API.md`, `backend/README.md`, `DEPLOY.md` (raiz).

---

## Comandos utiles (debug local)

```bash
cd backend
npm install
cp .env.example .env       # configurar DATABASE_URL y JWT_SECRET
npm run prisma:migrate -- --name init   # primera vez
npm run dev                # arranca con tsx watch
curl http://localhost:3000/health
```

---

## Costos esperados (Railway)

- Backend web service: ~$3-7 USD/mes con uso moderado.
- Postgres: ~$3-5 USD/mes con DB pequena (<1 GB).
- Total estimado: **$6-12 USD/mes** con el plan de pago. El trial cubre los
  primeros meses de prueba.
