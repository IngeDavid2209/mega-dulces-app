-- =====================================================================
-- TODOS LOS PUNTOS PIDEN FOTO, Y MAS DE UNA
--
-- --- DE DONDE SALE ---------------------------------------------------------
-- Decision de Direccion, relevada por David el 3/sep/2026: "el jefe quiere que
-- todas las tareas tengan evidencia, entonces a todas activale la evidencia
-- fotografica, que solo se pueda tomar la foto al instante" y "que sea mas de
-- una foto".
--
-- El codigo ya lo hace (`robot-manual.service.ts`: `requiresVariasFotos: true`).
-- Pero el robot corre EN EL NAVEGADOR cada 5 minutos y guarda las banderas
-- DENTRO de cada checklist al crearlo: los que ya se emitieron hoy siguen con
-- las banderas viejas hasta que caduquen. Esto los alcanza. Son las dos mitades
-- del mismo arreglo, como en la 046 -- que es la reversa probada de esto mismo.
--
-- --- LO QUE NO TOCA, Y ES LO MAS IMPORTANTE DE ESTE ARCHIVO ---------------
-- NO toca los checklists ENVIADOS, ni los de fechas PASADAS.
--
-- No es prudencia: seria destruir la historia. `tieneEvidencia()` devuelve
-- true para un punto con `requiresVariasFotos` SOLO si `photos` trae algo. Un
-- punto que se cerro ayer con un palomeo legitimo -porque entonces no pedia
-- foto- pasaria a "sin evidencia" en el instante en que se le enciende la
-- bandera. El cumplimiento historico de las 186 personas se hundiria de golpe,
-- sin que nadie hubiera dejado de hacer su trabajo, y las siete pantallas que
-- leen esa regla lo mostrarian como incumplimiento.
--
-- La regla nueva rige desde hoy hacia adelante. Lo ya juzgado se juzgo con la
-- norma que estaba vigente ese dia (invariante 4 del CLAUDE.md).
--
-- --- DOS NOMBRES QUE CASI ARRUINAN ESTO --------------------------------
-- `enviado` es una COLUMNA TIPADA de mdtask_checklists (009_checklists.sql:15),
-- no un campo de `datos`. El primer borrador filtraba con
-- `coalesce((c.datos->>'enviado')::boolean,false) is not true`, que da NULL en
-- TODAS las filas -- asi que el filtro pasaba todo, enviados incluidos, y esta
-- migracion habria hecho exactamente el dano que dice evitar. Sin error de SQL:
-- solo un `update` mas grande de lo que decia su propio comentario.
-- Y `fecha` es TEXT 'YYYY-MM-DD', no date: se compara contra texto.
-- Es el §12 del CLAUDE.md -- los nombres heredados no coinciden -- pero un nivel
-- peor, porque aqui el nombre equivocado no devuelve cero: devuelve todo.
--
-- --- LA REVERSA, ESCRITA ANTES QUE LA IDA (regla 8.3) ---------------------
-- Para deshacer, con los mismos tres filtros:
--
--   update mdtask_checklists c
--      set datos = jsonb_set(c.datos, '{items}', (
--            select jsonb_agg(
--                     jsonb_set(jsonb_set(t.it,
--                       '{requiresVariasFotos}', 'false'::jsonb),
--                       '{requiresPhoto}',
--                       case when (t.it->>'permiteDocumentos')::boolean is true
--                            then 'true'::jsonb else 'false'::jsonb end)
--                     order by t.ord)
--              from jsonb_array_elements(c.datos->'items') with ordinality as t(it, ord)))
--    where c.created_by = 'Manual Corporativo'
--      and c.enviado is not true
--      and c.eliminado is not true
--      and c.archivado is not true
--      and c.fecha >= to_char(current_date, 'YYYY-MM-DD')
--      and jsonb_typeof(c.datos->'items') = 'array';
--
-- Ojo con la reversa: devuelve `requiresPhoto` a true SOLO en los puntos de
-- documento, que es donde estaba antes (`!!ev?.foto || !!ev?.documento`). Los
-- 50 de foto pura perderian su bandera, asi que tras revertir hay que dejar
-- que el robot vuelva a emitir -- o aceptar que el dia siguiente ya sale bien.
--
-- Idempotente: despues de correr, ningun punto vigente queda con
-- `requiresVariasFotos` en false, asi que una segunda pasada no cambia nada.
-- =====================================================================

do $$
declare
  n_afectados   bigint := 0;
  n_puntos      bigint := 0;
  n_enviados    bigint := 0;
  n_pasados     bigint := 0;
  n_docs        bigint := 0;
begin
  -- ── LO QUE HAY ANTES ────────────────────────────────────────────────────
  -- Se imprime el tamano de la entrada antes de concluir nada: un "0 puntos
  -- actualizados" por "ya estaban todos" y por "no lei nada" se ven identicos.
  select count(*) into n_afectados
    from mdtask_checklists c
   where c.created_by = 'Manual Corporativo'
     and jsonb_typeof(c.datos->'items') = 'array'
     and c.enviado is not true
     and c.eliminado is not true
     and c.archivado is not true
     and c.fecha >= to_char(current_date, 'YYYY-MM-DD');

  select count(*) into n_puntos
    from mdtask_checklists c
    cross join lateral jsonb_array_elements(c.datos->'items') as it
   where c.created_by = 'Manual Corporativo'
     and jsonb_typeof(c.datos->'items') = 'array'
     and c.enviado is not true
     and c.eliminado is not true
     and c.archivado is not true
     and c.fecha >= to_char(current_date, 'YYYY-MM-DD');

  -- Lo que queda FUERA a proposito, contado para que se vea en el log que la
  -- exclusion existio y de que tamano fue.
  select count(*) into n_enviados
    from mdtask_checklists c
   where c.created_by = 'Manual Corporativo'
     and c.enviado is true;

  select count(*) into n_pasados
    from mdtask_checklists c
   where c.created_by = 'Manual Corporativo'
     and c.enviado is not true
     and c.eliminado is not true
     and c.archivado is not true
     and c.fecha <  to_char(current_date, 'YYYY-MM-DD');

  raise notice '[055] vigentes a tocar: % checklists · % puntos', n_afectados, n_puntos;
  raise notice '[055] INTACTOS a proposito: % enviados · % de fechas pasadas', n_enviados, n_pasados;

  if n_afectados = 0 then
    raise notice '[055] no hay checklists vigentes del Manual. Nada que hacer (el robot los emitira ya con la bandera).';
  end if;

  -- ── LA IDA ──────────────────────────────────────────────────────────────
  update mdtask_checklists c
     set datos = jsonb_set(
           c.datos,
           '{items}',
           (
             -- `with ordinality` + `order by ord` para NO perder el orden de
             -- los puntos: jsonb_agg puede devolverlos revueltos y un checklist
             -- desordenado respecto al anexo del manual pierde justo lo que le
             -- da valor. Copiado tal cual de la 046, que ya lo resolvio.
             select jsonb_agg(
                      -- Las DOS banderas, y en este orden importa que
                      -- requiresPhoto quede en false: `tieneEvidencia` exige
                      -- `item.photo` cuando esta encendida, pero la plantilla
                      -- ESCONDE el bloque de foto unica si variasFotos esta
                      -- encendida. Con las dos, el punto no se podria completar
                      -- nunca y la operacion quedaria bloqueada.
                      jsonb_set(
                        jsonb_set(t.it, '{requiresVariasFotos}', 'true'::jsonb),
                        '{requiresPhoto}', 'false'::jsonb
                      )
                      order by t.ord
                    )
               from jsonb_array_elements(c.datos->'items') with ordinality as t(it, ord)
           )
         )
   where c.created_by = 'Manual Corporativo'
     and jsonb_typeof(c.datos->'items') = 'array'
     and c.enviado is not true
     and c.eliminado is not true
     and c.archivado is not true
     and c.fecha >= to_char(current_date, 'YYYY-MM-DD');

  get diagnostics n_afectados = row_count;
  raise notice '[055] checklists actualizados: %', n_afectados;

  -- ── COMPROBACIONES, no adorno ───────────────────────────────────────────
  -- Si esto no sale 0, la migracion no hizo lo que dice y hay que enterarse
  -- por el log, no descubrirlo cuando alguien no pueda cerrar su turno.
  select count(*) into n_puntos
    from mdtask_checklists c
    cross join lateral jsonb_array_elements(c.datos->'items') as it
   where c.created_by = 'Manual Corporativo'
     and jsonb_typeof(c.datos->'items') = 'array'
     and c.enviado is not true
     and c.eliminado is not true
     and c.archivado is not true
     and c.fecha >= to_char(current_date, 'YYYY-MM-DD')
     and coalesce((it->>'requiresVariasFotos')::boolean, false) is not true;
  raise notice '[055] puntos vigentes SIN la bandera (debe ser 0): %', n_puntos;

  -- El bloqueo que este archivo viene a evitar: ningun punto puede quedar con
  -- las dos banderas encendidas.
  select count(*) into n_puntos
    from mdtask_checklists c
    cross join lateral jsonb_array_elements(c.datos->'items') as it
   where c.created_by = 'Manual Corporativo'
     and jsonb_typeof(c.datos->'items') = 'array'
     and coalesce((it->>'requiresVariasFotos')::boolean, false) is true
     and coalesce((it->>'requiresPhoto')::boolean, false) is true;
  raise notice '[055] puntos con las DOS banderas -imposibles de completar- (debe ser 0): %', n_puntos;

  -- Los 45 puntos de documento conservan su bandera: la plantilla la usa para
  -- dejar el selector de archivo abierto en vez de forzar la camara. Si esto
  -- sale 0 en toda la base, algo se la borro y esas personas no van a poder
  -- adjuntar el PDF que se les pide.
  select count(*) into n_docs
    from mdtask_checklists c
    cross join lateral jsonb_array_elements(c.datos->'items') as it
   where c.created_by = 'Manual Corporativo'
     and jsonb_typeof(c.datos->'items') = 'array'
     and c.enviado is not true
     and c.eliminado is not true
     and c.archivado is not true
     and c.fecha >= to_char(current_date, 'YYYY-MM-DD')
     and coalesce((it->>'permiteDocumentos')::boolean, false) is true;
  raise notice '[055] puntos de DOCUMENTO que conservan su selector: %', n_docs;
end $$;
