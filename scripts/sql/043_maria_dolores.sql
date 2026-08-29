-- =====================================================================
-- MARIA DOLORES · Encargada de Sucursal en Yurecuaro, y se cierra el duplicado
--
-- La 042 conto las tareas de cada una de sus dos fichas y la respuesta no
-- admite duda:
--
--     "Maria dolores berber tovar "   129 tareas, la ultima del 2026-08-28
--     "Maria Dolores Tovar Berber"      0 tareas, nunca
--
-- La primera es la que usa. La segunda es un duplicado que nunca se ocupo.
--
-- --- SE ELIGE POR LAS TAREAS, NO POR EL NOMBRE ----------------------------
-- Las dos fichas tienen las mismas palabras {maria, dolores, berber, tovar} en
-- distinto orden, asi que ninguna llave de nombre las separa. Y la buena ademas
-- TERMINA CON UN ESPACIO, que es la clase de detalle que se pierde al copiar un
-- nombre a mano de un log a un archivo SQL.
--
-- Por eso aqui no se escribe ningun nombre literal: se pregunta cual tiene
-- checklists. Eso es un hecho verificable en la propia base, no una
-- transcripcion mia, y sale bien aunque el espacio, las mayusculas o los
-- acentos esten de otra forma.
--
-- --- EL ESPACIO NO SE QUITA -----------------------------------------------
-- Da comezon, pero sus 129 checklists guardan `assigned` con ese espacio
-- incluido. Recortarlo aqui los dejaria apuntando a un nombre que ya no existe.
-- Se arregla renombrando ficha y checklists a la vez, aparte y a proposito.
--
-- --- LA NOMINA DICE CAJERA -------------------------------------------------
-- Y David dice Encargada de Sucursal. Manda David: la lista de raya es un
-- documento de nomina, no un organigrama. Con esto Yurecuaro pasa a tener
-- Encargada y empieza a recibir apertura y cierre de sucursal, que hasta hoy
-- nadie hacia ahi.
-- =====================================================================

do $$
declare
  v_viva     text;
  v_duplicada text;
  n_viva     bigint;
  n_dup      bigint;
  n_hecho    bigint;
begin
  -- La que tiene checklists, y la que no. Si no sale exactamente una de cada,
  -- no se toca nada: la situacion no seria la que este archivo describe.
  select count(*) into n_viva
    from mdtask_usuarios u
   where mdtask_tokens_nombre(u.nombre) @> array['berber','tovar']::text[]
     and mdtask_tokens_nombre(u.nombre) @> array['maria','dolores']::text[]
     and exists (select 1 from mdtask_checklists c where c.assigned = u.nombre);

  select count(*) into n_dup
    from mdtask_usuarios u
   where mdtask_tokens_nombre(u.nombre) @> array['berber','tovar']::text[]
     and mdtask_tokens_nombre(u.nombre) @> array['maria','dolores']::text[]
     and not exists (select 1 from mdtask_checklists c where c.assigned = u.nombre);

  raise notice '[043] fichas con tareas: %  ·  sin tareas: %', n_viva, n_dup;

  if n_viva <> 1 or n_dup <> 1 then
    raise notice '[043] No es 1 y 1 como se esperaba: NO se toca nada. Revisar a mano.';
    return;
  end if;

  -- ── 1. La que trabaja: Encargada de Sucursal ───────────────────────────
  update mdtask_usuarios u
     set cargo = 'Encargada de Sucursal',
         datos = coalesce(u.datos, '{}'::jsonb)
                 || jsonb_build_object('puestoId', 'encargado-sucursal',
                                       '_puestoAsignadoEn', '2026-08-29',
                                       '_puestoOrigen', 'confirmado por David (la nomina decia Cajera)')
   where mdtask_tokens_nombre(u.nombre) @> array['berber','tovar']::text[]
     and mdtask_tokens_nombre(u.nombre) @> array['maria','dolores']::text[]
     and exists (select 1 from mdtask_checklists c where c.assigned = u.nombre)
  returning u.nombre into v_viva;
  get diagnostics n_hecho = row_count;
  raise notice '[043] Encargada de Sucursal -> "%"  (% fila)', v_viva, n_hecho;

  -- ── 2. La ficha duplicada, la que nunca se uso ─────────────────────────
  -- Se desactiva, no se borra: si alguna vez colgo algo de ella, borrarla
  -- dejaria un hueco en lugar de un rastro.
  update mdtask_usuarios u
     set activo = false,
         datos = coalesce(u.datos, '{}'::jsonb)
                 || jsonb_build_object('_bajaEn', '2026-08-29',
                                       '_bajaMotivo', 'ficha duplicada sin tareas; la buena es la otra')
   where mdtask_tokens_nombre(u.nombre) @> array['berber','tovar']::text[]
     and mdtask_tokens_nombre(u.nombre) @> array['maria','dolores']::text[]
     and not exists (select 1 from mdtask_checklists c where c.assigned = u.nombre)
  returning u.nombre into v_duplicada;
  get diagnostics n_hecho = row_count;
  raise notice '[043] duplicada desactivada -> "%"  (% fila)', v_duplicada, n_hecho;
end $$;
