-- =====================================================================
-- DIAGNOSTICO · NO CAMBIA NADA
--
-- ¿POR CUAL DE LAS DOS FICHAS ENTRA YADIRA CAMPERO?
--
-- La 048 se abstuvo bien: las dos fichas tenian emisiones, y el reporte mostro
-- algo que invertia lo que se veia en la pantalla —
--
--     "Yaadira Campero Ortiz"  (sin puesto)        17 checklists  19/may→31/ago  trabajados=2
--     "Yadira Campero Ortiz"   encargado-sucursal  30 checklists  28/ago→31/ago  trabajados=0
--
-- — pero "quien trabajo" no es lo mismo que "por donde entra". David señalo la
-- señal que si lo dice y que ya existe en la base: `ultimoLatido`, que app.ts
-- escribe en cada sesion (linea 178), y que reportes.ts ya interpreta como
-- 'Activo' contra 'Nunca ha entrado' (linea 274).
--
-- ─── TRES SEÑALES, EN ORDEN DE FUERZA ────────────────────────────────────
--   1. `assigned_uid` de los checklists que SI se trabajaron. Es la definitiva:
--      alguien marco esos puntos DESDE una sesion, y ese uid es la cuenta.
--   2. `ultimoLatido`: si una ficha nunca latio, nadie ha entrado por ella.
--   3. Tokens de dispositivo (mdtask_usuarios_tokens): quien tiene la app
--      instalada y recibiendo avisos.
--
-- Si las tres salen vacias o se contradicen, NO se decide aqui: se le pregunta a
-- ella o a su Gerente de Zona (§8.5). Adivinar es exactamente lo que la 048 se
-- nego a hacer, y con razon — la ficha con tres meses de historia es la del
-- typo, asi que la corazonada obvia habria borrado el historial correcto.
--
-- Solo LEE. Ni un UPDATE.
-- =====================================================================

do $$
declare
  r record;
  n bigint;
begin
  -- ── 1. Las fichas: latido, tokens, puesto ──────────────────────────────
  raise notice '[049] --- fichas con "campero" ---';
  n := 0;
  for r in
    select u.id, u.nombre, u.activo,
           coalesce(nullif(u.usuario, ''), '(sin usuario)') as usuario,
           coalesce(u.datos->>'puestoId', '(sin puesto)')   as puesto,
           -- ultimoLatido se guarda como epoch en MILISEGUNDOS (app.ts:178).
           -- El nullif evita que una cadena vacia truene el cast a bigint.
           case when nullif(u.datos->>'ultimoLatido','') is null then null
                else to_timestamp((u.datos->>'ultimoLatido')::bigint / 1000) end as ultimo_latido,
           (select count(*) from mdtask_usuarios_tokens t where t.uid = u.id) as dispositivos
      from mdtask_usuarios u
     where lower(u.nombre) like '%campero%'
     order by u.nombre
  loop
    n := n + 1;
    raise notice '[049]   "%"  id=%', r.nombre, r.id;
    raise notice '[049]      usuario=%  activo=%  puesto=%', r.usuario, r.activo, r.puesto;
    raise notice '[049]      ultimo_latido=%  dispositivos=%',
      coalesce(r.ultimo_latido::text, 'NUNCA HA ENTRADO'), r.dispositivos;
  end loop;
  if n = 0 then
    raise notice '[049] AVISO: cero fichas con "campero". No se leyo nada; no concluyas.';
    return;
  end if;
  raise notice '[049] fichas encontradas: %', n;

  -- ── 2. La señal definitiva: desde que uid se trabajo ───────────────────
  raise notice '[049] --- checklists de campero: desde que uid ---';
  n := 0;
  for r in
    select c.id, c.fecha, c.assigned,
           coalesce(nullif(c.assigned_uid, ''), '(sin uid)') as uid,
           coalesce(c.created_by, '') as creado_por,
           c.status, c.enviado,
           (select count(*)
              from jsonb_array_elements(coalesce(c.datos->'items','[]'::jsonb)) i
             where (i->>'checked')::boolean is true
                or coalesce(i->>'photo','') not in ('', 'subiendo...')) as trabajados
      from mdtask_checklists c
     where c.assigned ilike '%campero%'
     order by c.fecha, c.id
  loop
    n := n + 1;
    -- Solo se detallan los que tienen trabajo: son los que prueban la sesion.
    if r.trabajados > 0 then
      raise notice '[049]   TRABAJADO · % · "%" · uid=% · creado_por=% · enviado=% · puntos=%',
        r.fecha, r.assigned, r.uid, r.creado_por, r.enviado, r.trabajados;
    end if;
  end loop;
  raise notice '[049] checklists de campero revisados: %', n;

  -- ── 3. Resumen por nombre, para leerlo de un golpe ─────────────────────
  raise notice '[049] --- resumen por nombre ---';
  for r in
    select c.assigned,
           count(*) as checklists,
           count(distinct nullif(c.assigned_uid,'')) as uids_distintos,
           string_agg(distinct nullif(c.assigned_uid,''), ' | ') as uids,
           sum((select count(*)
                  from jsonb_array_elements(coalesce(c.datos->'items','[]'::jsonb)) i
                 where (i->>'checked')::boolean is true
                    or coalesce(i->>'photo','') not in ('', 'subiendo...'))) as trabajados
      from mdtask_checklists c
     where c.assigned ilike '%campero%'
     group by c.assigned
     order by c.assigned
  loop
    raise notice '[049]   "%" · checklists=% · trabajados=% · uids=% (%)',
      r.assigned, r.checklists, r.trabajados, r.uids_distintos, coalesce(r.uids, 'ninguno');
  end loop;

  raise notice '[049] Si el uid de los trabajados coincide con el id de UNA ficha, esa es la cuenta.';
  raise notice '[049] Si sale "(sin uid)" o se contradice, se le pregunta a ella. No se adivina.';
end $$;
