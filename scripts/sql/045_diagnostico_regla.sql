-- =====================================================================
-- DIAGNOSTICO · NO CAMBIA NADA
--
-- La 044 probo que SI hay avance: 109 puntos palomeados el 29 de agosto, con su
-- sello de hora, en Padre Hidalgo, 8 Esquinas y SISTEMAS. Pero la pantalla de
-- Productividad muestra 0% en esas mismas tres sucursales. Una de las dos cosas
-- esta mal y hay que saber cual antes de tocar nada.
--
-- Esta consulta replica EXACTAMENTE las dos reglas que usa la pantalla, para
-- poder comparar numero contra numero en vez de razonar de memoria:
--
--   cuentaEnOperacion(c) : no eliminado, no archivado, no origenTec
--   esItemHecho(it, c)   : tiene su evidencia real, O el checklist trae
--                          justificacion del colaborador
--
--   tieneEvidencia(it):
--     requiresAntesDespues -> photoAntes Y photoDespues, ninguna 'subiendo...'
--     requiresVariasFotos  -> photos[] con al menos una
--     requiresPhoto        -> photo con valor y distinto de 'subiendo...'
--     ninguno de los tres  -> checked === true
--
--   tieneJustificacionChecklist(c): notaEmpleado con texto, o entregaConRetraso
--
-- Si el numero de aqui no coincide con el de la pantalla, el error esta en la
-- pantalla. Si coincide, el 0% es la verdad y hay que buscar por otro lado.
--
-- Solo LEE. Ni un UPDATE.
-- =====================================================================

do $$
declare
  r record;
begin
  raise notice '[045] --- ventana de 7 dias, con la regla EXACTA de la app ---';
  for r in
    with base as (
      -- eliminado, archivado, origen_tec y entrega_con_retraso son COLUMNAS
      -- reales de la tabla, no viven en `datos`. Buscarlas en el jsonb las
      -- habria devuelto todas nulas y el filtro no habria descartado nada.
      select c.store, c.fecha, c.datos, c.origen_tec,
             coalesce(c.datos->>'notaEmpleado', '') as nota,
             c.entrega_con_retraso                  as retraso,
             c.archivado                            as archivado,
             c.eliminado                            as eliminado
        from mdtask_checklists c
       where c.fecha >= to_char(now() - interval '7 days', 'YYYY-MM-DD')
    ),
    operativos as (
      -- cuentaEnOperacion
      select * from base
       where coalesce(eliminado, false) is not true
         and coalesce(archivado, false) is not true
         and coalesce(origen_tec, false) is not true
    ),
    puntos as (
      select o.store,
             btrim(o.nota) <> '' or o.retraso is true as justificado,
             it as p
        from operativos o
        cross join lateral jsonb_array_elements(coalesce(o.datos->'items', '[]'::jsonb)) as it
    ),
    evaluados as (
      select store,
             case
               when (p->>'requiresAntesDespues')::boolean is true then
                 coalesce(p->>'photoAntes','') not in ('', 'subiendo...')
                 and coalesce(p->>'photoDespues','') not in ('', 'subiendo...')
               when (p->>'requiresVariasFotos')::boolean is true then
                 jsonb_typeof(p->'photos') = 'array' and jsonb_array_length(p->'photos') > 0
               when (p->>'requiresPhoto')::boolean is true then
                 coalesce(p->>'photo','') not in ('', 'subiendo...')
               else
                 (p->>'checked')::boolean is true
             end as con_evidencia,
             justificado,
             (p->>'checked')::boolean is true            as palomeado,
             (p->>'requiresPhoto')::boolean is true      as pide_foto
        from puntos
    )
    select store,
           count(*)                                                      as asignados,
           count(*) filter (where con_evidencia or justificado)           as hechos_regla_app,
           count(*) filter (where palomeado)                              as palomeados,
           count(*) filter (where palomeado and pide_foto and not con_evidencia) as palomeados_sin_su_foto,
           count(*) filter (where justificado and not con_evidencia)      as pasan_por_justificacion
      from evaluados
     group by store
     order by hechos_regla_app desc, asignados desc
  loop
    -- raise notice no admite anchos tipo printf: solo %. Un '%-24s' habria
    -- salido como el valor seguido de un literal '-24s'.
    raise notice '[045] % · asignados=% hechos=% palomeados=% palomeados_sin_su_foto=% por_justificacion=%',
      r.store, r.asignados, r.hechos_regla_app, r.palomeados, r.palomeados_sin_su_foto, r.pasan_por_justificacion;
  end loop;
end $$;
