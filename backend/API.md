# Mega Dulces — Backend API

Base URL: `http://localhost:3000/api` (desarrollo) o la URL de Vercel/host (produccion).

## Autenticacion

Todas las rutas (excepto `POST /api/auth/login`) requieren JWT:

```
Authorization: Bearer <token>
```

El token se obtiene del `POST /api/auth/login` y dura 7 dias (configurable
via `JWT_EXPIRES_IN`). Cada request relee el usuario fresco desde la DB, por
lo que cambios de rol o permisos surten efecto sin reloguear.

## Respuestas comunes

- `200 OK`           — operacion exitosa con cuerpo.
- `201 Created`      — recurso creado, cuerpo con el objeto.
- `204 No Content`   — eliminacion exitosa, sin cuerpo.
- `400 Bad Request`  — body o query invalido. `{ error, detalle }`.
- `401 Unauthorized` — token faltante, invalido o expirado.
- `403 Forbidden`    — rol o permiso insuficiente.
- `404 Not Found`    — recurso inexistente o ruta desconocida.
- `409 Conflict`     — violacion de unique (usuario/correo duplicado, etc.).
- `500`              — error interno (consulta logs del servidor).

## Politica de visibilidad (resumen)

| Rol                | Que ve |
|--------------------|--------|
| admin global       | Todo, sin filtros. |
| admin limitado     | Solo recursos cuyo `store` este en sus `sucursales`. |
| supervisor         | (trabajador con flags de gestion) — igual que admin limitado. |
| trabajador puro    | Solo lo asignado a su nombre. |

Anti-escalada: un admin limitado NO puede crear, editar ni borrar a OTROS
administradores. Solo a si mismo o a trabajadores de sus sucursales.

---

## /api/auth

### POST /api/auth/login

Publico. Body:

```json
{ "usuario": "tania.sanchez", "password": "secreto" }
```

`usuario` puede ser el login (`tania.sanchez`) o el correo (`tania@mega.com`).

**200**:
```json
{
  "token": "eyJhbGciOi...",
  "user": { "id": "uuid", "usuario": "tania.sanchez", "nombre": "...", "rol": "admin", ... }
}
```

**401**: `{ "error": "Credenciales invalidas" }`

### POST /api/auth/register

Auth + rol admin. Body (todos los flags y campos opcionales tienen defaults):

```json
{
  "usuario": "nuevo.usuario",
  "nombre": "Nombre Apellido",
  "correo": "nuevo@megadulces.com.mx",
  "password": "minimo6chars",
  "rol": "trabajador",
  "alcance": "sucursales",
  "sucursales": ["Yurécuaro"],
  "areas": ["Cajas"],
  "puedeCrearChecklists": true
}
```

**201**: `{ "user": { ... } }`
**409**: usuario o correo duplicado.

### GET /api/auth/me

Auth. Devuelve el perfil completo del usuario actual (sin passwordHash ni raw).

**200**: `{ "user": { ... } }`

---

## /api/usuarios

| Metodo | Ruta | Auth | Permiso | Descripcion |
|---|---|---|---|---|
| GET | `/api/usuarios` | si | autenticado (filtrado por visibilidad) | Lista usuarios visibles. Query: `?rol=admin|trabajador&q=busqueda`. |
| GET | `/api/usuarios/:id` | si | autenticado | Detalle de un usuario. |
| PUT | `/api/usuarios/:id` | si | admin (no admin limitado a otro admin) | Actualizar. Si `password` viene en body, se rehashea. |
| DELETE | `/api/usuarios/:id` | si | admin (no a si mismo, no admin limitado a admin) | Borrar usuario. |

### Sub-recurso: tareas unicas

| Metodo | Ruta | Auth | Permiso |
|---|---|---|---|
| GET | `/api/usuarios/:usuarioId/tareas-unicas` | si | el dueno o cualquier admin |
| POST | `/api/usuarios/:usuarioId/tareas-unicas` | si | el dueno o cualquier admin |
| PUT | `/api/usuarios/:usuarioId/tareas-unicas/:id` | si | el dueno o cualquier admin |
| DELETE | `/api/usuarios/:usuarioId/tareas-unicas/:id` | si | el dueno o cualquier admin |

Body para crear:
```json
{
  "texto": "Tarea personal",
  "completada": false,
  "instrucciones": "opcional",
  "subtareas": [{ "texto": "...", "completada": false }]
}
```

---

## /api/checklists

### GET /api/checklists

Lista de checklists visibles, con filtros. Query:

```
?fechaDesde=YYYY-MM-DD
?fechaHasta=YYYY-MM-DD
?store=Yurecuaro
?assigned=Tania
?enviado=true|false
?archivado=true|false        (default: false)
?eliminado=true|false        (default: false)
?limit=500                   (1 a 2000, default 500)
```

**200**: `{ "checklists": [...] }`

### GET /api/checklists/ranking

Ranking semanal por sucursal. Query: `?desde=YYYY-MM-DD&hasta=YYYY-MM-DD`.

**200**:
```json
{
  "desde": "...", "hasta": "...",
  "ranking": [
    {
      "sucursal": "Padre Hidalgo",
      "promedio": 81,
      "totalChecklists": 380,
      "dias": [ { "fecha": "...", "hechos": 50, "total": 60, "porcentaje": 83 }, ... ]
    },
    ...
  ]
}
```

### GET /api/checklists/:id

Detalle de un checklist.

### POST /api/checklists

Crear un checklist. Body minimo:

```json
{
  "name": "Limpieza de pasillo 3",
  "assigned": "Tania Yazmin Sanchez",
  "store": "Yurécuaro",
  "fecha": "2026-06-10",
  "horaLimite": "20:00",
  "items": [ { "text": "Barrer", "requiresPhoto": true } ]
}
```

**Campos especiales:**
- `mantenimiento`: sub-objeto opcional con orden de mantenimiento.
- `catalogoRutinaId`, `asignacionId`, `moldeId`: referencias para cascada.

### PUT /api/checklists/:id

Actualizar. Mismos campos que crear (todos opcionales).

### PATCH /api/checklists/:id/soft-delete

Admin. Body:
```json
{ "cascada": true }
```

Marca `eliminado=true` en este checklist y en todos sus hermanos con misma
firma `(name, assigned, store, fecha)`. Si `cascada=false` solo marca el actual.
Tambien borra el molde V1 y desactiva la asignacion V2 si aplica.

**200**: `{ "checklistsAfectados": 3 }`

### DELETE /api/checklists/:id

Admin global. Hard-delete del checklist puntual.

### POST /api/checklists/archivar-mes

Admin global. Body:
```json
{ "mes": "2026-06" }
```

Marca `archivado=true, archivadoEn, archivadoPor, archivadoMes` en todos los
checklists del mes que aun no esten archivados.

**200**: `{ "mes": "2026-06", "archivados": 1244 }`

### POST /api/checklists/marcar-fotos-borradas

Admin global. Body:
```json
{
  "ids": ["uuid1", "uuid2", ...],
  "fotosBorradasCount": 42
}
```

Despues de limpiar Cloudinary, marca los checklists con `fotosBorradas=true`.
Max 500 ids por request.

**200**: `{ "marcados": N }`

---

## /api/areas

CRUD simple. Reglas Firestore: read auth, write admin.

| Metodo | Ruta | Auth | Permiso |
|---|---|---|---|
| GET | `/api/areas` | si | autenticado |
| GET | `/api/areas/:id` | si | autenticado |
| POST | `/api/areas` | si | admin |
| PUT | `/api/areas/:id` | si | admin |
| DELETE | `/api/areas/:id` | si | admin |

Body crear/editar:
```json
{ "nombre": "Cajas", "descripcion": "opt", "activa": true, "bloqueada": false }
```

---

## /api/rutinas-catalogo

Catalogo de rutinas (Robot V2).

| Metodo | Ruta | Permiso |
|---|---|---|
| GET | `/api/rutinas-catalogo` | autenticado |
| GET | `/api/rutinas-catalogo/:id` | autenticado |
| POST | `/api/rutinas-catalogo` | puedeCrearRutinas |
| PUT | `/api/rutinas-catalogo/:id` | puedeCrearRutinas |
| POST | `/api/rutinas-catalogo/:id/duplicar` | puedeCrearRutinas |
| POST | `/api/rutinas-catalogo/:id/archivar` | puedeCrearRutinas |
| POST | `/api/rutinas-catalogo/:id/restaurar` | puedeCrearRutinas |
| DELETE | `/api/rutinas-catalogo/:id` | admin global |

**Cascada de archivado/eliminacion**: marca `eliminado=true` en los checklists
pendientes (no enviado/eliminado/archivado) cuyo `catalogoRutinaId === :id`.

Respuesta de archivar:
```json
{ "rutina": { ... }, "checklistsCancelados": 12 }
```

---

## /api/asignaciones-rutinas

Asignaciones de rutinas (Robot V2). Conecta rutinas del catalogo con
personas/sucursales con regla de frecuencia.

| Metodo | Ruta | Permiso |
|---|---|---|
| GET | `/api/asignaciones-rutinas` | autenticado. Query: `?activa=true&store=Yurecuaro` |
| GET | `/api/asignaciones-rutinas/:id` | autenticado |
| POST | `/api/asignaciones-rutinas` | puedeCrearRutinas |
| PUT | `/api/asignaciones-rutinas/:id` | puedeCrearRutinas |
| DELETE | `/api/asignaciones-rutinas/:id` | puedeCrearRutinas |

---

## /api/moldes-checklists

Robot V1 (legacy). Misma estructura que rutinas-catalogo pero sin cascada.

| Metodo | Ruta | Permiso |
|---|---|---|
| GET | `/api/moldes-checklists` | autenticado |
| GET | `/api/moldes-checklists/:id` | autenticado |
| POST | `/api/moldes-checklists` | puedeCrearRutinas |
| PUT | `/api/moldes-checklists/:id` | puedeCrearRutinas |
| DELETE | `/api/moldes-checklists/:id` | puedeCrearRutinas |

---

## /api/tareas-equipo

Proyectos colaborativos con fases.

| Metodo | Ruta | Permiso |
|---|---|---|
| GET | `/api/tareas-equipo` | autenticado (filtrado por visibilidad) |
| GET | `/api/tareas-equipo/:id` | autenticado |
| POST | `/api/tareas-equipo` | puedeCrearTareasUnicas |
| PUT | `/api/tareas-equipo/:id` | puedeCrearTareasUnicas |
| POST | `/api/tareas-equipo/:id/cerrar` | puedeCrearTareasUnicas |
| DELETE | `/api/tareas-equipo/:id` | admin |

Visibilidad: admin global ve todas. Admin limitado solo las de sus sucursales.
Trabajador solo donde es jefeEquipo o integrante.

---

## /api/notificaciones

Notificaciones in-app por usuario.

| Metodo | Ruta | Permiso |
|---|---|---|
| GET | `/api/notificaciones` | autenticado. Query: `?leido=true|false&all=true` |
| POST | `/api/notificaciones` | autenticado |
| PATCH | `/api/notificaciones/:id/leida` | autenticado |
| DELETE | `/api/notificaciones/:id` | autenticado |

Solo el destinatario las ve por defecto. `?all=true` solo aplica si eres
admin global (util para soporte).

Body para crear:
```json
{
  "empleado": "Nombre Destinatario",
  "titulo": "Te asignaron una tarea nueva",
  "mensaje": "Cuerpo del mensaje"
}
```

---

## /api/descansos

Dia de descanso por empleado por semana ISO (formato `YYYY-Wnn`).

| Metodo | Ruta | Permiso |
|---|---|---|
| GET | `/api/descansos` | autenticado. Query: `?empleado=...&semana=2026-W23` |
| PUT | `/api/descansos` | admin. Upsert por `(empleado, semanaIso)`. |
| DELETE | `/api/descansos/:id` | admin |

Body upsert:
```json
{ "empleado": "Tania", "semanaIso": "2026-W23", "diaDescanso": "Martes" }
```

---

## Notas finales

- `firebase-messaging-sw.js` y los tokens FCM **siguen en Firebase**, no se
  tocan en este backend.
- La coleccion `usuarios_tokens` de Firestore se mantiene asi.
- La coleccion `indice_login` no se migra: el login del backend acepta tanto
  el `usuario` como el `correo` gracias al unique en `Usuario.usuario`.

## Probar con curl

Ejemplos completos en [README.md](README.md). Resumen rapido:

```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"usuario":"admin","password":"cambiar123"}'

# Listar checklists de hoy
TOKEN="eyJhbGc..."
curl "http://localhost:3000/api/checklists?fechaDesde=2026-06-10&fechaHasta=2026-06-10" \
  -H "Authorization: Bearer $TOKEN"

# Crear un area
curl -X POST http://localhost:3000/api/areas \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"nombre":"Bodega Refrigerados"}'

# Archivar un mes completo
curl -X POST http://localhost:3000/api/checklists/archivar-mes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"mes":"2026-05"}'
```
