-- =====================================================================
-- DIAGNOSTICO · NO CAMBIA NADA
--
-- La pantalla de Productividad muestra 0% de cumplimiento en TODAS las
-- sucursales, en rangos de varios dias. Puede ser real -los accesos se abrieron
-- el viernes por la tarde y el domingo no se entregan tareas- o puede ser que
-- algo no este registrando el avance.
--
-- Adivinar aqui seria caro en las dos direcciones: si es real y digo que hay un
-- bug, mando a buscar un problema que no existe; si hay un bug y digo que es
-- normal, la empresa mide con una regla rota.
--
-- Solo LEE y escribe al log del arranque. Ni un UPDATE.
--
-- LO QUE SEPARA: un punto puede estar "hecho" de tres formas distintas, y saber
-- cual falta cambia el diagnostico por completo.
--   · checked = true            -> alguien lo palomeo
--   · checkedEn con valor       -> ademas quedo el SELLO de la hora
--   · photo con valor           -> subio evidencia
-- Si hay muchos checked y ningun checkedEn, el problema es el sello. Si no hay
-- ni checked, no hay avance que medir y el 0% es la verdad.
-- =====================================================================

do $$
declare
  r record;
  n bigint;
begin
  select count(*) into n from mdtask_checklists
   where fecha >= to_char(now() - interval '7 days', 'YYYY-MM-DD');
  raise notice '[044] checklists de los ultimos 7 dias: %', n;

  select count(*) into n from mdtask_checklists
   where fecha >= to_char(now() - interval '7 days', 'YYYY-MM-DD')
     and jsonb_typeof(datos->'items') = 'array';
  raise notice '[044] de esos, con arreglo de items: %', n;

  -- ── El desglose que responde la pregunta ───────────────────────────────
  for r in
    with puntos as (
      select c.fecha,
             c.store,
             it as punto
        from mdtask_checklists c
        cross join lateral jsonb_array_elements(coalesce(c.datos->'items', '[]'::jsonb)) as it
       where c.fecha >= to_char(now() - interval '7 days', 'YYYY-MM-DD')
    )
    select fecha,
           count(*)                                                          as total,
           count(*) filter (where (punto->>'checked')::boolean is true)       as palomeados,
           count(*) filter (where coalesce(punto->>'checkedEn', '') <> '')    as con_sello,
           count(*) filter (where coalesce(punto->>'photo', '') <> ''
                              and punto->>'photo' <> 'subiendo...')           as con_foto,
           count(*) filter (where (punto->>'requiresPhoto')::boolean is true) as piden_foto
      from puntos
     group by fecha
     order by fecha
  loop
    raise notice '[044] % · puntos=% palomeados=% con_sello=% con_foto=% piden_foto=%',
      r.fecha, r.total, r.palomeados, r.con_sello, r.con_foto, r.piden_foto;
  end loop;

  -- ── Y quien si avanzo, si alguien avanzo ───────────────────────────────
  raise notice '[044] --- los que tienen algun punto palomeado (top 10) ---';
  for r in
    with puntos as (
      select c.assigned, c.store,
             it as punto
        from mdtask_checklists c
        cross join lateral jsonb_array_elements(coalesce(c.datos->'items', '[]'::jsonb)) as it
       where c.fecha >= to_char(now() - interval '7 days', 'YYYY-MM-DD')
    )
    select assigned, store,
           count(*) as total,
           count(*) filter (where (punto->>'checked')::boolean is true) as palomeados
      from puntos
     group by assigned, store
    having count(*) filter (where (punto->>'checked')::boolean is true) > 0
     order by palomeados desc
     limit 10
  loop
    raise notice '[044]   "%" (%) · % de % palomeados', r.assigned, r.store, r.palomeados, r.total;
  end loop;
end $$;
