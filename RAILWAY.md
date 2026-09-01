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
   `https://mdtask-production-ed88.up.railway.app/api/db-health`
   - Antes de configurar: `{ "configured": false }`
   - Ya conectado: `{ "ok": true, "configured": true, "ahora": ... }`

> Recomendado: activar **backups automaticos** del Postgres desde el dia 1.

---

## Dominio de produccion (Railway es el UNICO origen)

**`https://mdtask-production-ed88.up.railway.app`**

El sufijo `-ed88` no es un typo: Railway lo genero al recrear el servicio. El
dominio viejo (`mdtask-production.up.railway.app`) ya NO existe — su edge
responde 404 `Application not found`.

### Vercel quedo retirado

Antes el front vivia en Vercel (`md-chlist.vercel.app`) y `vercel.json` reenviaba
`/api/*` a Railway. Eso se acabo, por dos razones:

  - Vercel deshabilito el deployment por falta de pago (HTTP 402,
    `X-Vercel-Error: DEPLOYMENT_DISABLED`): la app entera dejo de abrir.
  - El reenvio seguia apuntando al dominio viejo de Railway. Aunque se pagara,
    la app habria cargado sin que NINGUNA llamada a la API respondiera.

Dos piezas separadas que hay que mantener en sincronia = dos formas de caerse.
Ahora `server.js` sirve el front compilado Y las rutas `/api` desde el mismo
origen, asi que no hay nada que sincronizar. `vercel.json` y `.vercelignore` se
borraron; si algun dia se quiere volver a Vercel, estan en la historia de git.

Lo que hacia `vercel.json` (no cachear `index.html`, `ngsw.json` y los service
workers para que la PWA tome la version nueva sola) ya lo hace `server.js` — y
ademas contesta 404 a los bundles viejos que ya no existen, que es lo que evita
la pantalla en blanco despues de cada despliegue.

### Si el dominio vuelve a cambiar

Ya no hay rewrite que actualizar, pero quedan DOS lugares fuera del codigo y uno
dentro. Si se olvida alguno no truena nada visible — simplemente deja de llegar:

  1. **El webhook en Meta** (WhatsApp -> Configuration -> Callback URL):
     `https://<dominio>/api/whatsapp-webhook`. Con el dominio viejo, Meta
     entrega los mensajes a la nada y el bot deja de contestar sin ningun error
     de nuestro lado.
  2. **El enlace que va en los correos al personal.**
  3. `api/tickets-notificar.js` -> `TICKETS_URL` (default). Se puede fijar por
     variable de entorno sin tocar codigo.

---

## Despues del primer deploy

- Probar el asistente de voz en **Chrome (Android)**: entrar a "Mi Agenda",
  tocar el boton del microfono y dictar una tarea.
- El enlace que va en los correos al personal debe apuntar a
  `https://mdtask-production-ed88.up.railway.app`. El viejo
  (`https://md-chlist.vercel.app/`) esta muerto: Vercel quedo retirado.
- Confirmar en Meta que el **Callback URL** del webhook es
  `https://mdtask-production-ed88.up.railway.app/api/whatsapp-webhook`.
  Si se quedo con el dominio anterior, el bot de WhatsApp no recibe nada y no
  contesta, sin ningun error visible en los logs.

## Replicas: UNA, y por que importa (paso 0.4 del plan)

**Medido el 1/sep/2026: `numReplicas = 1`** en los 15 service instances del entorno
`production`, y el log muestra un unico `escuchando en el puerto 8080`.

Comprobar asi (no por el numero de lineas de poll en el log, que sale truncado):

    railway status --json    # buscar deploy.numReplicas

**No subir a mas de una replica.** Los cuatro polls -flotilla, tareas, bloques, pagos-
arrancan dentro de `app.listen` en `server.js`, sin marca de idempotencia por periodo.
Con dos replicas, cada aviso se manda dos veces: la gente recibe el WhatsApp duplicado
y no hay nada en la app que lo impida. El interruptor `AVISOS_APAGADOS=1` existe para
taparlo a mano, que es un parche, no una solucion.

Para poder escalar hace falta el paso 9.1 del plan: sacar los polls del servidor web a
un proceso aparte con marca de idempotencia. Hasta entonces, una replica.
