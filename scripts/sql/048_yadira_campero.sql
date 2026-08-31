-- =====================================================================
-- YADIRA CAMPERO · ficha duplicada en Morelia Abastos
--
-- En la pantalla de Productividad aparecen dos, las dos Encargada de Sucursal:
--
--     "Yaadira Campero Ortiz"   0 de 76    <- MEDIAN/ALACARAZ otra vez: doble 'a'
--     "Yadira Campero Ortiz"    0 de 230
--
-- Es la SEXTA correccion de identidad por nombre en un dia (Maria Dolores,
-- Manuel Medina, Fernando Espitia, las dos bajas de Yurecuaro, y esta). Ese
-- conteo vale mas que la correccion: es el argumento medible para la Fase 3.
--
-- ═══════════════════════════════════════════════════════════════════════
--  LAS TRES DISCIPLINAS QUE PIDIO DAVID
-- ═══════════════════════════════════════════════════════════════════════
--
-- 1. CONTAR ANTES DE DECIDIR, Y NO RESOLVER UN EMPATE.
--    Si las DOS fichas tienen emisiones reales, no se desactiva ninguna y la
--    migracion se detiene diciendolo. Adivinar ahi le mueve el historial a la
--    persona equivocada, y eso se descubre cuando alguien pide el historial de
--    un mes — o nunca. Es la misma regla de la 037 y de la 043.
--
-- 2. DESACTIVAR, NUNCA BORRAR. `activo = false` mas el sello del evento. El
--    `raise notice` reporta cuantos checklists colgaban de CADA ficha antes de
--    tocar nada: si la que parecia vacia tenia 40, no estaba vacia.
--
-- 3. DESACTIVAR DETIENE LA SANGRIA, NO LIMPIA EL PASADO.
--    Aqui esta lo que se suele olvidar. Morelia Abastos acumulo 698 puntos
--    asignados porque recibio DOS juegos de apertura y cierre. Esos puntos ya
--    estan contados: apagar la ficha no los saca del denominador, asi que el
--    cumplimiento historico de esa sucursal se queda hundido para siempre y en
--    tres meses nadie va a recordar por que.
--
--    Por el invariante §5.5 no se borran. Se MARCAN con una bandera que apunta a
--    este evento, con autor y motivo, y las mediciones los excluyen por esa
--    razon documentada. El dato sigue ahi y se puede auditar; lo que cambia es
--    que deja de contarse como trabajo que alguien no hizo.
--
-- ═══════════════════════════════════════════════════════════════════════
--  REVERSA (escrita antes que la ida, §8.3)
-- ═══════════════════════════════════════════════════════════════════════
-- Sin borrado fisico. Para deshacer TODO lo de esta migracion:
--
--   -- 1. reactivar la ficha
--   update mdtask_usuarios set activo = true,
--          datos = datos - '_bajaEn' - '_bajaMotivo' - '_bajaEvento'
--    where datos->>'_bajaEvento' = '048_yadira_campero';
--
--   -- 2. devolver los checklists al KPI
--   update mdtask_checklists
--      set datos = datos - '_excluidoKpi' - '_excluidoMotivo'
--                        - '_excluidoEn' - '_excluidoPor' - '_excluidoEvento'
--    where datos->>'_excluidoEvento' = '048_yadira_campero';
--
-- Las dos son idempotentes y se pueden correr en cualquier orden. El sello
-- `_excluidoEvento` existe justamente para que la reversa sea exacta y no toque
-- ni una fila de mas.
-- =====================================================================

do $$
declare
  r record;
  n_fichas   bigint;
  n_con_tareas bigint;
  v_viva     text;
  v_dup      text;
  n_hecho    bigint;
begin
  -- ── 1. Contar, e imprimir, ANTES de decidir ────────────────────────────
  select count(*) into n_fichas
    from mdtask_usuarios u
   where u.activo is not false
     and mdtask_tokens_nombre(u.nombre) @> array['campero','ortiz']::text[];

  raise notice '[048] fichas activas con {campero,ortiz}: %', n_fichas;

  if n_fichas = 0 then
    raise notice '[048] AVISO: cero fichas. O ya se corrigio, o el nombre se escribe de otra forma. No se toca nada.';
    return;
  end if;

  -- El reporte lleva TRABAJO HECHO y RANGO DE FECHAS, no solo el conteo de
  -- checklists. Con la captura de David las dos fichas tenian puntos asignados
  -- (76 y 230), asi que el conteo a secas iba a dar empate y a abstenerse sin
  -- decir nada util. Lo que separa a una ficha viva de una fantasma es si
  -- alguien trabajo con ella y cuando: una que solo tiene tareas de hoy es el
  -- robot repartiendo, no una persona usando la app.
  n_con_tareas := 0;
  for r in
    select u.nombre,
           coalesce(u.datos->>'puestoId', '(sin puesto)') as puesto,
           (select count(*) from mdtask_checklists c where c.assigned = u.nombre) as tareas,
           (select min(c.fecha) from mdtask_checklists c where c.assigned = u.nombre) as desde,
           (select max(c.fecha) from mdtask_checklists c where c.assigned = u.nombre) as hasta,
           (select count(*)
              from mdtask_checklists c
              cross join lateral jsonb_array_elements(coalesce(c.datos->'items','[]'::jsonb)) i
             where c.assigned = u.nombre
               and ((i->>'checked')::boolean is true
                 or coalesce(i->>'photo','') not in ('', 'subiendo...'))) as puntos_trabajados,
           (select count(*) from mdtask_checklists c
             where c.assigned = u.nombre and c.enviado is true) as entregados
      from mdtask_usuarios u
     where u.activo is not false
       and mdtask_tokens_nombre(u.nombre) @> array['campero','ortiz']::text[]
     order by u.nombre
  loop
    raise notice '[048]   "%"', r.nombre;
    raise notice '[048]      puesto=%  checklists=%  del % al %', r.puesto, r.tareas, coalesce(r.desde,'-'), coalesce(r.hasta,'-');
    raise notice '[048]      puntos trabajados=%  checklists entregados=%', r.puntos_trabajados, r.entregados;
    if r.tareas > 0 then n_con_tareas := n_con_tareas + 1; end if;
  end loop;

  raise notice '[048] fichas CON checklists: % de %', n_con_tareas, n_fichas;

  -- ── 2. La abstencion, codificada — no es mi juicio ─────────────────────
  if n_fichas <> 2 or n_con_tareas <> 1 then
    raise notice '[048] NO SE TOCA NADA. Se esperaba exactamente 2 fichas y 1 con checklists.';
    raise notice '[048] Con dos fichas que ambas emitieron, elegir le mueve el historial a la persona equivocada.';
    raise notice '[048] LEE ARRIBA "puntos trabajados" y "entregados": la ficha viva es la que tiene trabajo,';
    raise notice '[048] no la que tiene mas tareas repartidas. Si una trae 0 trabajados y solo fechas de hoy,';
    raise notice '[048] es el robot repartiendo a una ficha que nadie usa. Dime cual es y va en la 049.';
    return;
  end if;

  select u.nombre into v_viva
    from mdtask_usuarios u
   where u.activo is not false
     and mdtask_tokens_nombre(u.nombre) @> array['campero','ortiz']::text[]
     and exists (select 1 from mdtask_checklists c where c.assigned = u.nombre);

  select u.nombre into v_dup
    from mdtask_usuarios u
   where u.activo is not false
     and mdtask_tokens_nombre(u.nombre) @> array['campero','ortiz']::text[]
     and not exists (select 1 from mdtask_checklists c where c.assigned = u.nombre);

  raise notice '[048] vigente: "%"  ·  duplicada: "%"', v_viva, v_dup;

  -- ── 3. Desactivar la duplicada ─────────────────────────────────────────
  update mdtask_usuarios u
     set activo = false,
         datos = coalesce(u.datos, '{}'::jsonb)
                 || jsonb_build_object('_bajaEn', '2026-08-31',
                                       '_bajaMotivo', 'ficha duplicada sin checklists; la vigente es ' || v_viva,
                                       '_bajaEvento', '048_yadira_campero')
   where u.nombre = v_dup;
  get diagnostics n_hecho = row_count;
  raise notice '[048] ficha duplicada desactivada: % fila', n_hecho;

  -- ── 4. Sacar del KPI lo que emitio la ficha duplicada ──────────────────
  -- Nada se borra: se marca con el evento que lo excluyo, su autor y su motivo.
  -- Sin esto, los puntos de la ficha fantasma se quedan en el denominador de
  -- Morelia Abastos para siempre.
  update mdtask_checklists c
     set datos = coalesce(c.datos, '{}'::jsonb)
                 || jsonb_build_object(
                      '_excluidoKpi', true,
                      '_excluidoMotivo', 'emitido a una ficha duplicada (' || v_dup || '); la persona real es ' || v_viva,
                      '_excluidoEn', '2026-08-31',
                      '_excluidoPor', 'David, confirmado el 2026-08-31',
                      '_excluidoEvento', '048_yadira_campero')
   where c.assigned = v_dup
     and coalesce(c.datos->>'_excluidoKpi', '') <> 'true';
  get diagnostics n_hecho = row_count;
  raise notice '[048] checklists excluidos del KPI: %', n_hecho;
  raise notice '[048] (marcados, NO borrados: siguen auditables y la reversa esta en la cabecera)';
end $$;
