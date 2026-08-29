-- =====================================================================
-- YURECUARO · dos bajas, y el caso de Maria Dolores duplicada
-- Confirmado por David el 2026-08-29.
--
--   · Antonio Castellano Espinoza ... ya no trabaja -> se desactiva
--   · Laura Carrillo Martinez ....... ya no trabaja -> se desactiva
--   · Maria Dolores ................. sigue, y es ENCARGADA DE SUCURSAL
--
-- --- POR QUE MARIA DOLORES NO SE TOCA EN ESTA MIGRACION -------------------
-- En la app hay DOS fichas suyas, con los apellidos al reves:
--
--     "Maria dolores berber tovar"      <- el orden de la nomina
--     "Maria Dolores Tovar Berber"      <- invertido
--
-- Las dos tienen exactamente las mismas palabras {maria, dolores, berber,
-- tovar}, asi que NINGUNA llave de nombre las distingue: cualquier regla que
-- acierte con una acierta con las dos.
--
-- Y elegir mal no es un detalle. Los checklists guardan a la persona por NOMBRE
-- en `assigned`. Si se desactiva la ficha que ella viene usando y se deja la
-- otra, su historial de tareas queda colgando de una cuenta apagada y ella
-- empieza de cero. Es el tipo de error que nadie nota hasta que alguien pide el
-- historial de un mes.
--
-- Asi que esta migracion solo CUENTA las tareas de cada una y lo dice en el
-- log. Con ese numero se sabe cual es la viva, y eso se resuelve aparte.
--
-- (La nomina la trae como Cajera; David dice Encargada de Sucursal. Manda
-- David: la lista de raya es un documento de nomina, no un organigrama.)
-- =====================================================================

do $$
declare
  r record;
  n_cand bigint;
  n_hecho bigint;
begin
  -- ── Bajas ──────────────────────────────────────────────────────────────
  for r in
    select * from (values
      (array['castellano','antonio']::text[], 'Antonio Castellano Espinoza'),
      (array['carrillo','laura']::text[],     'Laura Carrillo Martinez')
    ) as t(llave, quien)
  loop
    select count(*) into n_cand
      from mdtask_usuarios u
     where u.activo is not false
       and mdtask_tokens_nombre(u.nombre) @> r.llave;

    if n_cand > 1 then
      raise notice '[042] % : % candidatos con % — NO se desactiva a nadie.', r.quien, n_cand, r.llave;
      continue;
    end if;

    update mdtask_usuarios u
       set activo = false,
           datos = coalesce(u.datos, '{}'::jsonb)
                   || jsonb_build_object('_bajaEn', '2026-08-29',
                                         '_bajaMotivo', 'ya no trabaja (confirmado por David)')
     where u.activo is not false
       and mdtask_tokens_nombre(u.nombre) @> r.llave;
    get diagnostics n_hecho = row_count;

    raise notice '[042] % (baja): % candidato(s), % desactivado(s)', r.quien, n_cand, n_hecho;
    if n_cand = 0 then
      raise notice '[042] AVISO: no se encontro a % activo.', r.quien;
    end if;
  end loop;

  -- ── Las dos Maria Dolores: cual esta viva ──────────────────────────────
  -- Solo se cuenta y se reporta. Ni un UPDATE.
  raise notice '[042] --- las dos fichas de Maria Dolores ---';
  for r in
    select u.nombre,
           coalesce(u.datos->>'puestoId', '(sin puesto)') as puesto,
           u.activo,
           (select count(*) from mdtask_checklists c where c.assigned = u.nombre) as tareas,
           (select max(c.fecha) from mdtask_checklists c where c.assigned = u.nombre) as ultima
      from mdtask_usuarios u
     where mdtask_tokens_nombre(u.nombre) @> array['berber','tovar']::text[]
     order by u.nombre
  loop
    raise notice '[042]   "%"  puesto=%  activo=%  tareas=%  ultima=%',
      r.nombre, r.puesto, r.activo, r.tareas, coalesce(r.ultima::text, 'nunca');
  end loop;
end $$;
