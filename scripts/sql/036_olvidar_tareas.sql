-- ============================================================================
--  OLVIDAR TAREAS Y RUTINAS — corte de arranque del modelo nuevo
--  Pedido por David el 2026-08-28.
--
--  QUÉ HACE
--  Deja la operación con la pizarra limpia antes de que empiecen a entregarse
--  las tareas del Manual Corporativo por puesto. Olvida TODO lo que había
--  —pendiente, en progreso, enviado y archivado— menos lo del Espacio TEC.
--
--  QUÉ CONSERVA
--    · Todo lo del Espacio TEC: los checklists que ellos asignaron
--      (origen_tec = true) y los de sus usuarios (grupoTec = true), por uid o
--      por nombre. Sus tablas propias (tec_tareas, tec_notas,
--      tec_conversaciones, tec_grupos) no se tocan ni se mencionan aquí.
--    · La Agenda Personal de todos (mdtask_agenda): son pendientes que cada
--      quien se anota para sí mismo, no tareas que alguien le asignó. Por
--      decisión expresa, no se toca.
--
--  CÓMO LO HACE (y por qué así)
--  NO borra filas. Marca `eliminado = true` —que es lo que TODAS las pantallas
--  ya respetan (checklist, estadísticas, ranking, auditoría, cierre mensual,
--  dashboard)— y además estampa `datos._olvidado = '2026-08-28'`.
--
--  El sello es lo que hace esto reversible con precisión. Sin él, deshacer
--  significaría "des-eliminar todo", y arrastraría de vuelta lo que alguien
--  borró antes a mano por otra razón. Por lo mismo cada UPDATE lleva un
--  candado del tipo `where eliminado is not true`: solo se estampa lo que esta
--  operación cambió de verdad.
--
--  PARA DESHACER (exacto, solo lo de esta operación):
--
--    update mdtask_checklists        set eliminado = false where datos->>'_olvidado' = '2026-08-28';
--    update mdtask_catalogo_rutinas   set activa = true    where datos->>'_olvidado' = '2026-08-28';
--    update mdtask_asignaciones_rutinas set activa = true  where datos->>'_olvidado' = '2026-08-28';
--    update mdtask_rutinas_personales set activa = true    where datos->>'_olvidado' = '2026-08-28';
--    update mdtask_tareas_equipo      set datos = datos - 'eliminado' where datos->>'_olvidado' = '2026-08-28';
--
--  OJO: los checklists también viven en Firestore por el dual-write, pero la app
--  los LEE solo de Postgres desde la migración FERROCARRIL. Marcarlos aquí es
--  suficiente para que la app los olvide; las copias de Firestore quedan como
--  respaldo muerto.
-- ============================================================================

-- Bitácora de la operación, para saber después qué tanto movió.
create table if not exists mdtask_olvido_log (
  sello       text primary key,
  aplicado_en bigint,
  resumen     jsonb
);

do $$
declare
  v_sello   text   := '2026-08-28';
  n_chk     bigint := 0;
  n_cat     bigint := 0;
  n_asig    bigint := 0;
  n_mol     bigint := 0;
  n_rper    bigint := 0;
  n_eq      bigint := 0;
  n_tec_u   bigint := 0;
  n_chk_tec bigint := 0;
begin
  -- ── Quiénes son del Espacio TEC ────────────────────────────────────────
  -- Se compara `datos->'grupoTec' = 'true'::jsonb` y no un cast a boolean:
  -- si algún perfil trae ahí un texto raro, el cast reventaría la migración
  -- completa y esta comparación simplemente no coincide.
  create temporary table tmp_tec on commit drop as
    select id, lower(btrim(coalesce(nombre, ''))) as nombre
      from mdtask_usuarios
     where datos->'grupoTec' = 'true'::jsonb;
  select count(*) into n_tec_u from tmp_tec;

  -- Cuántos checklists quedan a salvo (para la bitácora).
  select count(*) into n_chk_tec
    from mdtask_checklists c
   where c.origen_tec = true
      or exists (select 1 from tmp_tec t where t.id = c.assigned_uid)
      or exists (select 1 from tmp_tec t
                  where t.nombre <> '' and t.nombre = lower(btrim(coalesce(c.assigned, ''))));

  -- ── 1) CHECKLISTS (las tareas del día y todo su historial) ─────────────
  update mdtask_checklists c
     set eliminado = true,
         datos = coalesce(c.datos, '{}'::jsonb)
                 || jsonb_build_object('_olvidado', v_sello,
                                       'eliminadoPor', 'corte de arranque del Manual',
                                       'eliminadoEn', (extract(epoch from now()) * 1000)::bigint)
   where c.eliminado is not true                      -- no re-estampar lo ya borrado antes
     and c.origen_tec is not true                     -- lo que asignó el Espacio TEC se queda
     and not exists (select 1 from tmp_tec t where t.id = c.assigned_uid)
     and not exists (select 1 from tmp_tec t
                      where t.nombre <> ''
                        and t.nombre = lower(btrim(coalesce(c.assigned, ''))));
  get diagnostics n_chk = row_count;

  -- ── 2) RUTINAS: el catálogo y sus asignaciones ─────────────────────────
  -- Aquí NO se excluye nada del TEC, y es a propósito: el Espacio TEC nunca
  -- usó este modelo (asigna checklists con origen_tec, no rutinas), y el
  -- modelo quedó retirado — sus dos robots están apagados y sus pantallas
  -- fuera, así que desactivarlas no cambia nada que hoy funcione.
  update mdtask_catalogo_rutinas
     set activa = false,
         datos = coalesce(datos, '{}'::jsonb) || jsonb_build_object('_olvidado', v_sello)
   where activa is not false;
  get diagnostics n_cat = row_count;

  update mdtask_asignaciones_rutinas
     set activa = false,
         datos = coalesce(datos, '{}'::jsonb) || jsonb_build_object('_olvidado', v_sello)
   where activa is not false;
  get diagnostics n_asig = row_count;

  -- Moldes del robot V1 (legacy). No tienen columna `activa`: se estampan y se
  -- marcan con la bandera de pausa que ese robot ya respetaba.
  update mdtask_moldes_checklists
     set datos = coalesce(datos, '{}'::jsonb)
                 || jsonb_build_object('_olvidado', v_sello, '_pausadoPorMigracion', true)
   where coalesce(datos->>'_olvidado', '') <> v_sello;
  get diagnostics n_mol = row_count;

  -- ── 3) RUTINAS PERSONALES (las que cada quien se repite) ───────────────
  -- Estas SÍ excluyen a la gente del TEC: son suyas y llevan su uid.
  update mdtask_rutinas_personales r
     set activa = false,
         datos = coalesce(r.datos, '{}'::jsonb) || jsonb_build_object('_olvidado', v_sello)
   where r.activa is not false
     and not exists (select 1 from tmp_tec t where t.id = r.uid);
  get diagnostics n_rper = row_count;

  -- ── 4) PROYECTOS EN EQUIPO (apartado ya retirado de la interfaz) ───────
  -- Se conserva el proyecto donde alguien del TEC sea jefe o integrante.
  update mdtask_tareas_equipo e
     set datos = coalesce(e.datos, '{}'::jsonb)
                 || jsonb_build_object('eliminado', true, '_olvidado', v_sello)
   where coalesce(e.datos->>'eliminado', '') <> 'true'
     and not exists (select 1 from tmp_tec t
                      where t.nombre <> ''
                        and t.nombre = lower(btrim(coalesce(e.jefe_equipo, ''))))
     and not exists (
           select 1
             from tmp_tec t,
                  jsonb_array_elements_text(
                    case when jsonb_typeof(e.datos->'integrantes') = 'array'
                         then e.datos->'integrantes' else '[]'::jsonb end
                  ) as x(nombre)
            where t.nombre <> '' and t.nombre = lower(btrim(coalesce(x.nombre, '')))
         );
  get diagnostics n_eq = row_count;

  -- ── Bitácora ───────────────────────────────────────────────────────────
  insert into mdtask_olvido_log (sello, aplicado_en, resumen)
  values (
    v_sello,
    (extract(epoch from now()) * 1000)::bigint,
    jsonb_build_object(
      'usuariosTec',            n_tec_u,
      'checklistsConservados',  n_chk_tec,
      'checklistsOlvidados',    n_chk,
      'catalogoRutinas',        n_cat,
      'asignacionesRutinas',    n_asig,
      'moldesLegacy',           n_mol,
      'rutinasPersonales',      n_rper,
      'proyectosEnEquipo',      n_eq,
      'agendaPersonal',         'no se tocó (decisión expresa)'
    )
  )
  on conflict (sello) do update
     set aplicado_en = excluded.aplicado_en,
         resumen     = excluded.resumen;

  raise notice 'OLVIDO % -> checklists:% (conservados:%), catalogo:%, asignaciones:%, moldes:%, rutinasPersonales:%, equipo:%, usuariosTEC:%',
    v_sello, n_chk, n_chk_tec, n_cat, n_asig, n_mol, n_rper, n_eq, n_tec_u;
end $$;
