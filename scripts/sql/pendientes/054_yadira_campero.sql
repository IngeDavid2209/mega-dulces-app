-- =====================================================================
-- ⚠ NO APLICADA. ESPERA UNA RESPUESTA HUMANA.
--
--  ═══ POR QUE ESTA EN scripts/sql/pendientes/ Y NO EN scripts/sql/ ═══
--  `scripts/db-migrate.js` hace readdirSync sobre `scripts/sql` SIN recursion y
--  filtra por `.sql`. Un archivo en esta subcarpeta NO se aplica en el arranque.
--  Es a proposito: si viviera un nivel arriba, el proximo `railway up` la
--  ejecutaria y ADIVINARIA la respuesta que todavia no tenemos.
--
--  Para aplicarla: mover a `scripts/sql/054_yadira_campero.sql`, llenar
--  v_ficha_vigente, y desplegar.
--
-- ═══════════════════════════════════════════════════════════════════════
--  QUE FALTA SABER, Y POR QUE NO ESTA EN LA BASE
-- ═══════════════════════════════════════════════════════════════════════
-- Hay dos fichas de la misma persona en Morelia Abastos:
--
--   "Yaadira Campero Ortiz"  (sin puesto)          17 checklists, 19/may→31/ago
--                                                  2 puntos trabajados
--                                                  ultimo latido 30/jun
--   "Yadira Campero Ortiz"   encargado-sucursal    30 checklists, 28/ago→31/ago
--                                                  0 puntos trabajados
--                                                  ultimo latido 24/jun
--
-- Las dos comparten `usuario = yadira.campero`, y las DOS tienen latido. La 049
-- busco la señal definitiva -el `assigned_uid` de los checklists trabajados- y
-- vino vacia: los dos unicos trabajados son del 19/may, creados por Luis
-- Francisco Lopez, sin uid.
--
-- Asi que la respuesta NO ESTA EN LA BASE. Esta en ella o en su Gerente de Zona.
-- Adivinar aqui le mueve tres meses de historial a la cuenta equivocada, y es
-- exactamente lo que la 048 se nego a hacer, con razon.
--
-- ═══════════════════════════════════════════════════════════════════════
--  Y HAY RELOJ: ESTO CADUCA CON SU PRIMER LOGIN
-- ═══════════════════════════════════════════════════════════════════════
-- Hoy ninguna ficha tiene sesion desde junio, asi que solo UNA tiene trabajo
-- real y la fusion es limpia. El dia que alguien le diga "empieza a usar la
-- app", ella aterrizara en la ficha con puesto -asi ordena api/login.js, y esta
-- bien que asi sea: prioriza acceso sobre historial- y GENERARA HISTORIA AHI.
--
-- En ese momento las DOS fichas tienen trabajo real, y la regla de "un empate no
-- se resuelve" bloquea la fusion para siempre. De ahi que el pedido a la Gerente
-- sea angosto: "avisame antes de pedirle que empiece a entrar".
--
-- ═══════════════════════════════════════════════════════════════════════
--  REVERSA (escrita antes que la ida, §8.3)
-- ═══════════════════════════════════════════════════════════════════════
--   -- 1. reactivar la ficha desactivada
--   update mdtask_usuarios set activo = true,
--          datos = datos - '_bajaEn' - '_bajaMotivo' - '_bajaEvento'
--    where datos->>'_bajaEvento' = '054_yadira_campero';
--
--   -- 2. quitarle el puesto a quien se le puso aqui
--   update mdtask_usuarios
--      set datos = datos - '_puestoDe054'
--        , datos = jsonb_set(datos, '{puestoId}', '""')
--    where datos->>'_puestoDe054' = 'si';
--
--   -- 3. devolver los checklists excluidos al KPI
--   update mdtask_checklists
--      set datos = datos - '_excluidoKpi' - '_excluidoMotivo'
--                        - '_excluidoEn' - '_excluidoPor' - '_excluidoEvento'
--    where datos->>'_excluidoEvento' = '054_yadira_campero';
-- =====================================================================

do $$
declare
  -- ═══ LLENAR ESTO CON LA RESPUESTA DE ELLA O DE SU GERENTE ═══
  -- El nombre EXACTO, tal como esta en la base, de la ficha por la que ENTRA.
  -- Los dos valores validos son, literalmente:
  --     'Yaadira Campero Ortiz'   (la del historial, sin puesto)
  --     'Yadira Campero Ortiz'    (la del puesto, sin historial)
  v_ficha_vigente text := 'PENDIENTE';

  v_otra   text;
  n        bigint;
  n_hecho  bigint;
begin
  -- ── Candado: sin respuesta, no se hace nada ────────────────────────────
  if v_ficha_vigente = 'PENDIENTE' then
    raise notice '[054] NO SE APLICA: falta la respuesta de por cual ficha entra Yadira.';
    raise notice '[054] La señal definitiva (assigned_uid de los trabajados) vino vacia en la 049,';
    raise notice '[054] asi que el dato NO esta en la base: esta en ella o en su Gerente de Zona.';
    return;
  end if;

  if v_ficha_vigente not in ('Yaadira Campero Ortiz', 'Yadira Campero Ortiz') then
    raise notice '[054] NO SE APLICA: "%" no es uno de los dos nombres exactos.', v_ficha_vigente;
    return;
  end if;

  v_otra := case when v_ficha_vigente = 'Yaadira Campero Ortiz'
                 then 'Yadira Campero Ortiz' else 'Yaadira Campero Ortiz' end;

  -- ── Las dos fichas tienen que existir y estar activas ──────────────────
  select count(*) into n
    from mdtask_usuarios
   where nombre in (v_ficha_vigente, v_otra) and activo is not false;
  raise notice '[054] fichas activas encontradas: % (se esperan 2)', n;
  if n <> 2 then
    raise notice '[054] NO SE APLICA: se esperaban 2 fichas activas. El caso cambio desde que se escribio esto.';
    return;
  end if;

  -- ── CANDADO DEL RELOJ ──────────────────────────────────────────────────
  -- Si la ficha que se va a desactivar ya tiene trabajo REAL, la fusion dejo de
  -- ser limpia: las dos emitieron y la regla de "un empate no se resuelve"
  -- aplica. Eso pasa el dia que ella empiece a entrar.
  select count(*) into n
    from mdtask_checklists c
    cross join lateral jsonb_array_elements(coalesce(c.datos->'items','[]'::jsonb)) i
   where c.assigned = v_otra
     and ((i->>'checked')::boolean is true
       or coalesce(i->>'photo','') not in ('', 'subiendo...'));
  raise notice '[054] puntos trabajados en la ficha a desactivar ("%"): %', v_otra, n;
  if n > 0 then
    raise notice '[054] NO SE APLICA: esa ficha YA tiene trabajo real. El reloj corrio.';
    raise notice '[054] Ahora las dos emitieron y elegir le mueve historial a alguien. Se resuelve a mano.';
    return;
  end if;

  -- ── 1. El puesto a la ficha vigente, si no lo tiene ────────────────────
  update mdtask_usuarios u
     set cargo = 'Encargada de Sucursal',
         datos = coalesce(u.datos,'{}'::jsonb)
                 || jsonb_build_object('puestoId', 'encargado-sucursal',
                                       '_puestoDe054', 'si',
                                       '_puestoOrigen', 'fusion 054, confirmado por su Gerente')
   where u.nombre = v_ficha_vigente
     and coalesce(u.datos->>'puestoId','') <> 'encargado-sucursal';
  get diagnostics n_hecho = row_count;
  raise notice '[054] puesto puesto en "%": % fila(s)', v_ficha_vigente, n_hecho;

  -- ── 2. Desactivar la otra ──────────────────────────────────────────────
  update mdtask_usuarios u
     set activo = false,
         datos = coalesce(u.datos,'{}'::jsonb)
                 || jsonb_build_object('_bajaEn', to_char(current_date,'YYYY-MM-DD'),
                                       '_bajaMotivo', 'ficha duplicada; la vigente es ' || v_ficha_vigente,
                                       '_bajaEvento', '054_yadira_campero')
   where u.nombre = v_otra;
  get diagnostics n_hecho = row_count;
  raise notice '[054] ficha "%" desactivada: % fila(s)', v_otra, n_hecho;

  -- ── 3. Sacar del KPI lo que se le emitio a la ficha muerta ─────────────
  -- Sin esto, sus puntos se quedan en el denominador de Morelia Abastos para
  -- siempre y el cumplimiento historico de esa sucursal queda hundido sin que
  -- nadie recuerde por que.
  update mdtask_checklists c
     set datos = coalesce(c.datos,'{}'::jsonb)
                 || jsonb_build_object(
                      '_excluidoKpi', true,
                      '_excluidoMotivo', 'emitido a una ficha duplicada (' || v_otra || '); la persona real entra por ' || v_ficha_vigente,
                      '_excluidoEn', to_char(current_date,'YYYY-MM-DD'),
                      '_excluidoPor', 'confirmado por su Gerente de Zona',
                      '_excluidoEvento', '054_yadira_campero')
   where c.assigned = v_otra
     and coalesce(c.datos->>'_excluidoKpi','') <> 'true';
  get diagnostics n_hecho = row_count;
  raise notice '[054] checklists excluidos del KPI: %', n_hecho;
  raise notice '[054] (marcados, NO borrados. Reversa completa en la cabecera.)';
end $$;
