# Despliegue post-cutover (Fase 5-H)

Guia operativa para llevar a produccion la nueva arquitectura
(Angular frontend + Node/Express/Postgres backend + Firebase FCM).

Si necesitas el contexto del cambio: [backend/README.md](backend/README.md),
[backend/API.md](backend/API.md), [backend/prisma/schema.prisma](backend/prisma/schema.prisma).

---

## Orden de despliegue

**NO inviertas el orden.** El frontend con `useBackend=true` exige que el
backend este vivo y con datos migrados; al reves la app se cae.

1. Provisionar **Postgres**.
2. Desplegar el **backend** (`/backend`) y verificar `/health`.
3. Ejecutar la **migracion Prisma** (`prisma migrate deploy`).
4. Ejecutar la **migracion de datos** Firestore → Postgres una vez.
5. Verificar manualmente algunos checklists/usuarios en `/api/...`.
6. Configurar variables en Vercel para el **frontend** y para
   `api/notify-update.js`.
7. Publicar las nuevas **firestore.rules** (deny all).
8. Desplegar el **frontend** con `useBackend=true`.
9. Verificar que la PWA carga datos del backend.
10. Monitoreo 24h.

---

## 1. Provisionar Postgres

Opciones recomendadas (con free tier):

| Proveedor | Pros | Contras |
|---|---|---|
| **Supabase** | Gestionado, generoso free tier, panel visual | Free tier limita a 500 MB DB |
| **Neon** | Postgres serverless, branch para staging | Pausa instancia tras 5 min idle (cold start ~300ms) |
| **Railway** | Sencillo, $5/mes de credito | Sin free tier real largo plazo |
| **Auto-hospedado (Docker)** | Sin limites | Tu administras backups + monitoreo |

Configura `DATABASE_URL` y guardala — la vamos a usar en el backend.

---

## 2. Desplegar el backend

El backend vive en `/backend`. Lo puedes desplegar en cualquier hosting Node
(Vercel, Railway, Render, Fly.io, VPS propio).

### Variables de entorno requeridas

| Variable | Que es | Como obtener |
|---|---|---|
| `DATABASE_URL` | Conexion Postgres | Del proveedor del paso 1 |
| `JWT_SECRET` | Firma JWT (≥32 chars) | `openssl rand -base64 48` |
| `JWT_EXPIRES_IN` | Vida del JWT (default `7d`) | Opcional |
| `PORT` | Puerto Express (default 3000) | Opcional |
| `NODE_ENV` | `production` | Hardcoded en deploy |
| `CORS_ORIGINS` | URLs permitidas separadas por coma | `https://mega-dulces-app.vercel.app,https://www.mega-dulces.com` |
| `SERVICE_SECRET` | Secret servidor-a-servidor (≥32 chars) | `openssl rand -hex 32` |
| `FIREBASE_SERVICE_ACCOUNT` | Solo para script de migracion (paso 4) | JSON inline de Firebase Console |

### Comandos de deploy

```bash
cd backend
npm install                 # instala deps + corre prisma generate
npm run build               # compila TS a dist/
# levantar con npm run start (en el host)
```

Verificar:

```bash
curl https://TU-BACKEND.vercel.app/health
# → { "ok": true, "db": "connected", ... }
```

---

## 3. Migracion Prisma

Una sola vez al arrancar, y cada vez que cambie `schema.prisma`:

```bash
cd backend
npm run prisma:migrate:prod
```

Esto aplica los SQL de `prisma/migrations/` contra `DATABASE_URL`.
La primera vez crea todas las tablas. Tarda <10s.

---

## 4. Migracion de datos (one-shot)

Copia el JSON del service account de Firebase y configura
`FIREBASE_SERVICE_ACCOUNT` (o `GOOGLE_APPLICATION_CREDENTIALS`).

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
  usuarios                    XX leidos | ... | 0 errores
...

============================================================
  RESUMEN
============================================================
  TOTAL: XXXX leidos | XXXX insertados | ... | 0 errores
============================================================
```

Si `errores > 0`, revisar y re-ejecutar (es idempotente).

### Crear primer admin si quedo sin password

Si la migracion reporta "N sin password — pedir reset", crear o resetear el
admin con el seed:

```bash
SEED_USUARIO=admin SEED_NOMBRE=Admin SEED_CORREO=admin@mega.com \
SEED_PASSWORD="cambiar-en-produccion" npm run seed:admin
```

---

## 5. Verificar API

```bash
# Login
TOKEN=$(curl -s -X POST https://TU-BACKEND/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"usuario":"admin","password":"cambiar-en-produccion"}' \
  | jq -r '.token')

# Probar listados
curl -H "Authorization: Bearer $TOKEN" https://TU-BACKEND/api/usuarios
curl -H "Authorization: Bearer $TOKEN" https://TU-BACKEND/api/checklists?fechaDesde=2026-06-01
```

Si los conteos coinciden con Firestore, la migracion fue exitosa.

---

## 6. Variables en Vercel (frontend + api/)

### Para el frontend Angular

No requiere env vars en Vercel — la URL del backend esta hardcoded en
`src/environments/environment.ts`. Si tu backend NO esta en
`https://mega-dulces-backend.vercel.app`, edita ese archivo antes de hacer
el build de produccion.

### Para `api/notify-update.js` (Vercel function que envia push)

| Variable | Valor |
|---|---|
| `BACKEND_URL` | `https://TU-BACKEND` (sin slash final) |
| `SERVICE_SECRET` | Mismo valor que en el backend |
| `FIREBASE_SERVICE_ACCOUNT` | JSON del service account (se mantiene de antes) |

### Para `api/cloudinary-cleanup.js` (limpia de fotos)

Sin cambios — sigue igual.

---

## 7. Publicar nuevas firestore.rules

```bash
firebase deploy --only firestore:rules
```

Esto **cierra Firestore** para todos los clientes. Solo el script de
migracion (que usa Admin SDK) y las funciones serverless en `api/` siguen
pudiendo leer/escribir.

Si necesitas mantener `usuarios_tokens` accesible para el SW de FCM,
edita `firestore.rules` antes de deployear.

---

## 8. Deploy del frontend con cutover

```bash
git push origin main      # Vercel auto-deploya
```

El bundle de produccion ya trae `useBackend=true` por default
(`src/environments/environment.ts`). Tras el deploy, todos los clientes
pegan al backend nuevo.

---

## 9. Verificar en produccion

Abre la app y verifica en DevTools:

- **Network tab**: solo requests a `TU-BACKEND/api/...` (no a `firestore.googleapis.com`).
- **Application → Local Storage**: `md_jwt` y `md_sesion_actual` presentes tras login.
- **Console**: sin errores `permission-denied` de Firestore. Si los hay,
  significa que un componente quedo sin migrar — anota cual y abrenle issue.
- **Tareas de prueba**: crear / enviar / archivar un checklist; abrir
  Personal, Calendario, Reportes, Cierre Mensual; abrir un checklist y
  marcar items.

---

## 10. Monitoreo 24h

Vigilar:

| Indicador | Donde |
|---|---|
| Errores 5xx del backend | Logs del host (Vercel/Railway/etc.) |
| Lecturas Firestore | Firebase Console — deberian estar **en cero o muy bajas** |
| Crecimiento Postgres | Panel del proveedor (Supabase/Neon) |
| Logs `[sesion/backend]` | Consola de un browser para confirmar polling cada 2 min |
| FCM push | Probar "Notificar actualizacion" y verificar que llega |

---

## Rollback de emergencia

Si algo grave sale mal y necesitas volver a Firestore en menos de 5 minutos:

### Opcion A — Rollback solo en cliente (rapido, soft)

1. **Reabrir reglas de Firestore** temporalmente:

   ```javascript
   // firestore.rules — copiar la version anterior a Fase 5-H (del git)
   git show HEAD~1:firestore.rules > firestore.rules
   firebase deploy --only firestore:rules
   ```

2. **Forzar `useBackend=false` en clientes** sin redeploy:

   - Le pides al equipo que ejecute en DevTools Console:
     `localStorage.setItem('md_use_backend','false'); location.reload();`
   - Para forzarlo en TODOS los dispositivos sin que cada uno toque DevTools,
     **revertir el commit** que cambio el default y redeployar.

### Opcion B — Rollback completo

1. Revertir el commit del cutover (`git revert HEAD`).
2. `firebase deploy --only firestore:rules` con las reglas antiguas.
3. Vercel auto-deploya el front con `useBackend=false` por default.

Los datos en Firestore **no se borraron** durante el cutover — son los
mismos. La migracion solo COPIO a Postgres, asi que el rollback no pierde
nada nuevo (excepto lo escrito en Postgres durante el periodo backend, que
si quieres lo migras de vuelta con un script inverso o lo descartas).

---

## Diferencias backend vs Firestore

Si en algun momento se necesita decidir cual es la fuente de verdad:

| Aspecto | Firestore (legacy) | Backend Postgres (actual) |
|---|---|---|
| Origen de datos | Hasta el dia del cutover | Desde el dia del cutover |
| Auth | Firebase Auth | JWT propio (bcrypt) |
| Realtime | onSnapshot nativo | Polling 30-60s |
| Costo | Lecturas/escrituras por cuota | Hosting + Postgres |
| Backups | Firebase Console | Snapshot del proveedor Postgres |

---

## Checklist resumen

- [ ] Postgres provisionado y `DATABASE_URL` lista
- [ ] Backend desplegado, `/health` responde OK
- [ ] `prisma migrate deploy` ejecutado
- [ ] `npm run migrate:firestore` con `errores = 0`
- [ ] Login + lecturas funcionan via curl
- [ ] Env vars en Vercel (`BACKEND_URL`, `SERVICE_SECRET`) en api/notify-update.js
- [ ] `firestore.rules` actualizadas (deny all)
- [ ] Frontend desplegado con `useBackend=true`
- [ ] PWA carga datos del backend en produccion
- [ ] FCM push de "actualizacion disponible" funciona
- [ ] Lecturas Firestore en consola muestran 0
- [ ] 24h sin incidentes
