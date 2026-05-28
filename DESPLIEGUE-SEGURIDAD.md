# 🔒 Despliegue de Seguridad — Fase 2 (Firestore Rules)

Estas reglas cierran el acceso anónimo a la base de datos. **El orden de los pasos
importa**: si publicas las reglas antes de preparar el índice de login, nadie podrá
entrar. Sigue esta secuencia con calma.

---

## ⚠️ Antes de empezar
1. Ten a la mano un **usuario administrador real** (correo + contraseña) que funcione
   en Firebase Auth. Ya quitamos el backdoor `admin/123456`, así que este es tu único
   acceso de admin.
2. Confirma que ese admin puede iniciar sesión en la versión actual de la app.

---

## Paso 1 — Desplegar el código (ya hecho con el push)
El código nuevo:
- Login resuelve el correo desde `indice_login` (ya no descarga toda la base).
- Al guardar usuarios se mantiene `indice_login` automáticamente.
- Botón **"Sincronizar índice login"** en la pantalla de Usuarios.

Espera a que Vercel termine el deploy.

## Paso 2 — Generar el índice de login (con las reglas TODAVÍA abiertas)
1. Entra como **administrador**.
2. Ve a **Usuarios**.
3. Pulsa **"Sincronizar índice login"** una vez.
4. Confirma que diga "Listos: N" (N = número de usuarios).

> Esto crea la colección `indice_login` que el login necesitará cuando las reglas
> estén activas. **Hazlo ANTES del Paso 4.**

## Paso 3 — Probar las reglas en el SIMULADOR (sin publicar)
1. Firebase Console → **Firestore Database → Reglas**.
2. Pega el contenido de [`firestore.rules`](./firestore.rules) en el editor.
3. **NO publiques todavía.** Usa el botón **"Simulador de reglas"** (Rules Playground):
   - Simula un `get` a `usuarios/{algún-uid-real}` autenticado como ese uid → debe **permitir**.
   - Simula un `get` a `usuarios` **sin autenticar** → debe **denegar**.
   - Simula un `create` en `usuarios` autenticado como un admin → debe **permitir**.
   - Simula un `create` en `usuarios` autenticado como un trabajador → debe **denegar**.

> 🔑 **Clave:** `esAdmin()` busca el doc del usuario por su **UID** (`usuarios/{uid}`).
> Si tu doc de admin NO tiene el UID como ID (usuarios antiguos), el admin no será
> reconocido y no podrá escribir. Verifica en Firestore que el ID del documento de
> tu admin sea su UID de Authentication. Si no, créalo de nuevo desde la app o
> avísame y lo resolvemos antes de publicar.

## Paso 4 — Publicar las reglas
1. Cuando el simulador dé los resultados esperados, pulsa **"Publicar"**.
2. Inmediatamente prueba en la app:
   - Cierra sesión y vuelve a entrar con tu **usuario** (no correo) → debe funcionar.
   - Entra como un **trabajador** → debe ver y completar sus checklists.
   - Como **admin** → crea/edita un usuario de prueba → debe funcionar.

## Paso 5 — Rollback (si algo falla)
Si algo deja de funcionar tras publicar, vuelve temporalmente a reglas abiertas
mientras lo revisamos:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if true; }
  }
}
```

Publica eso, recupera la operación, y me avisas para diagnosticar.

---

## Fase 3 (pendiente, opcional pero recomendada)
- Borrar el campo `password` de los documentos de usuarios existentes (ya no se usa).
- Migrar el rol a **Custom Claims** de Firebase Auth para no depender de `get()` en
  cada regla (más robusto y rápido).
