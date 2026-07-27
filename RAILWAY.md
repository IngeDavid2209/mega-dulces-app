# Despliegue en Railway

Esta app (Angular + un servidor Express) corre como **un solo servicio** en Railway.
La base de datos sigue siendo **Firebase** (no se migra nada de datos).

El servidor (`server.js`) hace dos cosas:
1. Sirve la app de Angular compilada.
2. Atiende las rutas `/api/*` (asistente de voz, notificaciones push y limpieza de Cloudinary).

La configuracion de build/arranque ya esta en `nixpacks.toml`, asi que Railway lo
detecta automaticamente. No hay que tocar comandos.

---

## Pasos para desplegar (lo hace quien tiene la cuenta de Railway)

1. Entra a **railway.app** e inicia sesion.
2. **New Project -> Deploy from GitHub repo** y elige este repositorio.
   - Railway leera `nixpacks.toml`:
     - install: `npm install --include=dev`
     - build:   `npm run build`
     - start:   `node server.js`
3. Ve a la pestania **Variables** del servicio y agrega TODAS las variables de la
   tabla de abajo.
4. En **Settings -> Networking**, pulsa **Generate Domain** para obtener la URL
   publica (algo como `mega-dulces-task.up.railway.app`).
5. Espera a que termine el primer deploy y abre esa URL. Listo.

> El puerto lo asigna Railway solo (variable `PORT`). No hay que configurarlo.

---

## Variables de entorno (pestania "Variables")

| Variable                   | Para que sirve                         | De donde sacarla |
|----------------------------|----------------------------------------|------------------|
| `ANTHROPIC_API_KEY`        | Asistente de voz (IA de Claude)        | platform.claude.com -> API Keys (crear una nueva) |
| `FIREBASE_SERVICE_ACCOUNT` | Validar sesion + notificaciones push   | El MISMO JSON que ya esta en Vercel (Settings -> Environment Variables -> revelar y copiar) |
| `CLOUDINARY_CLOUD_NAME`    | Limpieza de fotos                      | Es `duherjgyg` (el mismo que usa la app para subir) |
| `CLOUDINARY_API_KEY`       | Limpieza de fotos                      | console.cloudinary.com -> Settings -> API Keys. OJO: NO estan en Vercel, hay que sacarlas del panel de Cloudinary |
| `CLOUDINARY_API_SECRET`    | Limpieza de fotos                      | Igual que la API Key (boton de revelar). Sin estas tres, el boton "Borrar fotos" del Cierre Mensual falla |
| `ASISTENTE_MODELO`         | (Opcional) modelo de IA a usar         | Dejar vacio = `claude-opus-4-8`. Poner `claude-haiku-4-5` para abaratar ~5x. |
| `DATABASE_URL`             | Conexion a Postgres (migracion en curso) | La da el servicio Postgres de Railway (ver abajo). Si no existe, la app sigue funcionando con Firebase. |

> `FIREBASE_SERVICE_ACCOUNT` es un JSON largo en una sola variable: pega el
> contenido completo (incluyendo las llaves `{ }`) tal cual.

---

## Base de datos Postgres (migracion por fases, en curso)

Estamos migrando de Firestore a Postgres **por fases**; ambas conviven. Mientras
`DATABASE_URL` no exista, la app sigue 100% en Firebase (nada se rompe).

**Para crear el Postgres (lo hace el dueno de la cuenta de Railway):**
1. En el proyecto de Railway (el mismo donde vive el servicio **MDTask**):
   **New -> Database -> Add PostgreSQL**. (O por CLI: `railway add --database postgres`.)
2. En el servicio **MDTask** -> pestana **Variables** -> agregar una variable de
   referencia: `DATABASE_URL = ${{Postgres.DATABASE_URL}}`
   (asi MDTask usa la conexion **interna** del proyecto, sin costo de salida ni SSL).
3. Redeploy de MDTask. Verificar en el navegador:
   `https://mdtask-production.up.railway.app/api/db-health`
   - Antes de configurar: `{ "configured": false }`
   - Ya conectado: `{ "ok": true, "configured": true, "ahora": ... }`

> Recomendado: activar **backups automaticos** del Postgres desde el dia 1.

---

## Despues del primer deploy

- Probar el asistente de voz en **Chrome (Android)**: entrar a "Mi Agenda",
  tocar el boton del microfono y dictar una tarea.
- Cuando la URL de Railway este confirmada, hay que cambiar el enlace que va en
  los correos a empleados (hoy apunta a `https://md-chlist.vercel.app/`).
  Avisar al desarrollador con la URL nueva para actualizarlo.
- Mantener Vercel prendido hasta confirmar que Railway funciona bien; luego se
  puede apagar.
