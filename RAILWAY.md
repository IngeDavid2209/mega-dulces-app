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
| `CLOUDINARY_CLOUD_NAME`    | Limpieza de fotos                      | El mismo valor que esta en Vercel (`duherjgyg`) |
| `CLOUDINARY_API_KEY`       | Limpieza de fotos                      | El mismo valor que esta en Vercel |
| `CLOUDINARY_API_SECRET`    | Limpieza de fotos                      | El mismo valor que esta en Vercel |
| `ASISTENTE_MODELO`         | (Opcional) modelo de IA a usar         | Dejar vacio = `claude-opus-4-8`. Poner `claude-haiku-4-5` para abaratar ~5x. |

> `FIREBASE_SERVICE_ACCOUNT` es un JSON largo en una sola variable: pega el
> contenido completo (incluyendo las llaves `{ }`) tal cual.

---

## Despues del primer deploy

- Probar el asistente de voz en **Chrome (Android)**: entrar a "Mi Agenda",
  tocar el boton del microfono y dictar una tarea.
- Cuando la URL de Railway este confirmada, hay que cambiar el enlace que va en
  los correos a empleados (hoy apunta a `https://md-chlist.vercel.app/`).
  Avisar al desarrollador con la URL nueva para actualizarlo.
- Mantener Vercel prendido hasta confirmar que Railway funciona bien; luego se
  puede apagar.
