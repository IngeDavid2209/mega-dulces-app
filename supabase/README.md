# Migracion Firestore → Supabase

Plan paso a paso. Esta carpeta contiene todo lo necesario para mudar el backend
de Mega Dulces de Firebase Firestore a Supabase (Postgres + realtime).

## Estado

- [x] Schema disenado (`schema.sql`)
- [ ] Proyecto Supabase creado (paso manual)
- [ ] Schema ejecutado en Supabase
- [ ] Variables de entorno configuradas
- [ ] DataLayerService abstracto (Firebase y Supabase intercambiables)
- [ ] Script de migracion inicial de datos
- [ ] Pruebas en rama feature/supabase
- [ ] Cutover producccion

## Paso 1: Crear proyecto en Supabase

1. https://supabase.com → "Start your project" → "Continue with GitHub".
2. New project:
   - Name: `mega-dulces-task`
   - Database password: (guardar fuerte)
   - Region: `East US (N. Virginia)` o `South America (Sao Paulo)`
   - Pricing: Free
3. Esperar ~2 min a que aprovisione.

## Paso 2: Ejecutar el schema

1. Dentro del proyecto, ir a **SQL Editor** (sidebar izquierdo).
2. Pegar el contenido completo de `schema.sql`.
3. Click en **Run** (botón verde abajo a la derecha).
4. Verificar en **Table Editor** que aparezcan las 9 tablas:
   - usuarios, checklists, areas, rutinas_catalogo, asignaciones_rutinas,
     moldes_checklists, tareas_equipo, notificaciones, descansos_semanales.

## Paso 3: Obtener credenciales

1. Ir a **Project Settings → API**.
2. Copiar:
   - **Project URL** (algo como `https://xxxxxx.supabase.co`).
   - **anon public key** (la primera, para usar en el front).
   - **service_role key** (privada, NO en front — solo para scripts de migracion).
3. Guardar las 3 cosas para Vercel (env vars).

## Paso 4: Variables de entorno en Vercel

```
VITE_SUPABASE_URL=https://xxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=ey... (la anon publica)
SUPABASE_SERVICE_ROLE_KEY=ey... (privada, solo para api/)
```

## Paso 5: Migracion de datos

Cuando el schema este listo en Supabase, corremos `migrar-datos.ts` que:

1. Lee cada coleccion de Firestore.
2. Inserta cada doc en la tabla equivalente de Postgres.
3. Preserva el doc original en la columna `raw` para no perder nada.
4. Reporta errores y duplicados.

## Mapeo Firestore → Postgres

| Firestore Collection      | Supabase Table            |
|---------------------------|---------------------------|
| usuarios                  | usuarios                  |
| checklists                | checklists                |
| areas / areas_operativas  | areas                     |
| catalogo_rutinas          | rutinas_catalogo          |
| asignaciones_rutinas      | asignaciones_rutinas      |
| moldes_checklists         | moldes_checklists         |
| tareas_equipo             | tareas_equipo             |
| notificaciones            | notificaciones            |
| descansos_semanales       | descansos_semanales       |
