-- =====================================================================
-- APAGA permiteFotos EN LAS TAREAS DEL MANUAL YA CREADAS
--
-- --- QUE PASO ------------------------------------------------------------
-- El 29 de agosto, al montar la evidencia por punto, encendi `permiteFotos` en
-- todos los puntos que NO exigian foto ni documento, con la idea de que
-- cualquiera pudiera adjuntar una si queria dejar constancia.
--
-- El efecto no fue el que imagine. En la plantilla del checklist, el bloque de
-- evidencia son DOSCIENTAS lineas por punto, y su condicion incluye
-- `permiteFotos`. De unos 95 puntos con interfaz de foto se paso a los 377: un
-- checklist de 23 puntos multiplico su DOM por cuatro. En un celular de piso
-- eso es la diferencia entre una lista que responde y una que se traba.
--
-- Nadie pidio esa foto opcional en todos los puntos. Fue idea mia y se retira.
--
-- --- POR QUE HACE FALTA TOCAR EL DATO ------------------------------------
-- El robot ya no lo enciende, pero las banderas se guardan DENTRO de cada
-- checklist al crearlo. Los que ya existen seguirian pesando igual hasta que
-- caduquen solos. Esto los limpia.
--
-- --- POR QUE NO SE ARREGLA EN LA PLANTILLA -------------------------------
-- Seria una linea, pero `permiteFotos` es una funcion legitima y anterior: al
-- crear una tarea libre se puede activar a mano (`tareaDiaPermiteFotos`).
-- Quitarla de la plantilla arreglaria mi desastre rompiendo algo de alguien mas.
--
-- Por eso el filtro es `created_by = 'Manual Corporativo'`: toca EXACTAMENTE lo
-- que el robot creo, y no roza una sola tarea hecha a mano.
--
-- Idempotente: despues de correr no queda ningun punto con la bandera en true,
-- asi que una segunda pasada no encuentra nada que cambiar.
-- =====================================================================

do $$
declare
  n_afectados bigint := 0;
  n_puntos    bigint := 0;
begin
  select count(*) into n_afectados
    from mdtask_checklists c
   where c.created_by = 'Manual Corporativo'
     and jsonb_typeof(c.datos->'items') = 'array'
     and c.datos->'items' @> '[{"permiteFotos": true}]'::jsonb;

  select count(*) into n_puntos
    from mdtask_checklists c
    cross join lateral jsonb_array_elements(c.datos->'items') as it
   where c.created_by = 'Manual Corporativo'
     and jsonb_typeof(c.datos->'items') = 'array'
     and (it->>'permiteFotos')::boolean is true;

  raise notice '[046] checklists a limpiar: %  ·  puntos con la bandera: %', n_afectados, n_puntos;

  update mdtask_checklists c
     set datos = jsonb_set(
           c.datos,
           '{items}',
           (
             -- Se reconstruye el arreglo con `with ordinality` y `order by ord`
             -- para NO perder el orden de los puntos. Sin eso, jsonb_agg puede
             -- devolverlos revueltos y el checklist quedaria desordenado
             -- respecto al anexo del manual, que es justo lo que da su valor.
             select jsonb_agg(
                      case when (t.it->>'permiteFotos')::boolean is true
                           then jsonb_set(t.it, '{permiteFotos}', 'false'::jsonb)
                           else t.it
                      end
                      order by t.ord
                    )
               from jsonb_array_elements(c.datos->'items') with ordinality as t(it, ord)
           )
         )
   where c.created_by = 'Manual Corporativo'
     and jsonb_typeof(c.datos->'items') = 'array'
     and c.datos->'items' @> '[{"permiteFotos": true}]'::jsonb;

  get diagnostics n_afectados = row_count;
  raise notice '[046] checklists actualizados: %', n_afectados;

  -- Comprobacion, no adorno: si esto no sale 0, la limpieza no funciono y hay
  -- que enterarse por el log en vez de creer que se arreglo.
  select count(*) into n_puntos
    from mdtask_checklists c
    cross join lateral jsonb_array_elements(c.datos->'items') as it
   where c.created_by = 'Manual Corporativo'
     and jsonb_typeof(c.datos->'items') = 'array'
     and (it->>'permiteFotos')::boolean is true;
  raise notice '[046] puntos que AUN tienen la bandera (debe ser 0): %', n_puntos;
end $$;
