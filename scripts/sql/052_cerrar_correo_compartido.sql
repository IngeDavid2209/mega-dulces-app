-- =====================================================================
-- DIAGNOSTICO · NO CAMBIA NADA
--
-- Cierra -o declara irresoluble- el caso `mataviejitas778@gmail.com`, y prueba
-- que el orden estable de api/login.js hace lo que dice.
--
-- ─── POR QUE EL CRITERIO DE LA 051 NO ALCANZO ─────────────────────────────
-- La 051 dijo "2 de 2 parecen personas reales", y estaba mal: lo unico que lo
-- disparo fue `checklists > 0`, y un checklist asignado prueba que ALGUIEN
-- ESCRIBIO ESE NOMBRE, no que exista una persona que use la cuenta. Cualquier
-- admin puede crear una tarea a nombre de quien sea. Las dos señales fuertes
-- -latido y puesto- estan ausentes en ambas fichas.
--
-- Fijar el criterio antes de mirar fue correcto; el criterio era flojo. Meti
-- como evidencia de identidad justo el dato que el hallazgo 1 vuelve poco
-- fiable: un nombre en un campo de texto.
--
-- ─── Y EL CASO ES PEOR DE LO QUE PARECIA ─────────────────────────────────
-- En la nomina hay DOS Miriam, las dos en sucursal:
--     CARRILLO CONTRERAS MIRIAM JAZMIN · Cajera      · 8 Esquinas
--     RODRIGUEZ SANCHEZ MIRIAM JUDITH  · Anaquelista · Canindo
--
-- Asi que la ficha llamada solo "Miriam" NO ES ATRIBUIBLE: aunque se decidiera
-- que es una persona, no se puede decir CUAL. El criterio deja de ser "real o de
-- pruebas" y pasa a ser: es una ficha NO ATRIBUIBLE con acceso potencial a una
-- cuenta compartida.
--
-- ─── EL DISCRIMINADOR YA ESTABA EN LA TABLA ──────────────────────────────
-- `store` del checklist. Si dice "8 Esquinas" o "Canindo", apunta a una de las
-- dos Miriam de la nomina. Si viene vacio o con un valor de prueba, es una ficha
-- de pruebas. Junto con `created_by` y `timestamp_creacion`, los tres cierran el
-- caso o lo declaran irresoluble — que tambien es un resultado.
--
-- Solo LEE. Ni un UPDATE.
-- =====================================================================

do $$
declare
  r record;
  n bigint;
begin
  -- ── 1. Los checklists de las dos fichas, con los tres campos que deciden ──
  raise notice '[052] --- checklists de "Miriam" y "EL DAVE" ---';
  n := 0;
  for r in
    select c.assigned, c.id, c.fecha,
           coalesce(nullif(c.store,''), '(SIN SUCURSAL)') as store,
           coalesce(nullif(c.created_by,''), '(sin creador)') as creado_por,
           case when c.timestamp_creacion is not null
                then to_timestamp(c.timestamp_creacion / 1000)::text
                else '(sin sello)' end as creado_en,
           c.status, c.enviado,
           jsonb_array_length(coalesce(c.datos->'items','[]'::jsonb)) as puntos
      from mdtask_checklists c
     where c.assigned in ('Miriam', 'EL DAVE')
     order by c.assigned, c.fecha
  loop
    n := n + 1;
    raise notice '[052]   "%" · % · store=% · creado_por=% · creado_en=% · puntos=% · enviado=%',
      r.assigned, r.fecha, r.store, r.creado_por, r.creado_en, r.puntos, r.enviado;
  end loop;
  raise notice '[052] checklists listados: %', n;
  if n = 0 then
    raise notice '[052] AVISO: cero checklists. La 051 conto 6 y 1, asi que el `assigned` se escribe distinto. No concluyas.';
  end if;

  -- ── 2. ¿Alguna sucursal de esos checklists apunta a una Miriam de nomina? ──
  raise notice '[052] --- sucursales distintas en los checklists de "Miriam" ---';
  n := 0;
  for r in
    select coalesce(nullif(c.store,''), '(SIN SUCURSAL)') as store, count(*) as veces
      from mdtask_checklists c
     where c.assigned = 'Miriam'
     group by coalesce(nullif(c.store,''), '(SIN SUCURSAL)')
     order by count(*) desc
  loop
    n := n + 1;
    raise notice '[052]   store=% · % vez(ces)', r.store, r.veces;
    if r.store in ('8 Esquinas', 'Canindo') then
      raise notice '[052]      ^ APUNTA A UNA MIRIAM DE NOMINA. Sigue sin decir CUAL de las dos, pero ya no es de pruebas.';
    elsif r.store = '(SIN SUCURSAL)' then
      raise notice '[052]      ^ sin sucursal: compatible con ficha de pruebas.';
    end if;
  end loop;
  if n = 0 then
    raise notice '[052]   ninguna fila. Ver el aviso de arriba.';
  end if;

  -- ── 3. Prueba de determinismo del orden nuevo de api/login.js ────────────
  -- Se corre el MISMO order by que quedo en el codigo, para ver que fila gana y
  -- por que. Esto prueba el cambio sin que nadie tenga que iniciar sesion.
  raise notice '[052] --- orden estable para "yadira.campero": quien gana y por que ---';
  n := 0;
  for r in
    select u.id, u.nombre, u.activo,
           coalesce(nullif(u.datos->>'puestoId',''), '(sin puesto)') as puesto,
           case when u.datos->>'ultimoLatido' ~ '^[0-9]+$'
                then to_timestamp((u.datos->>'ultimoLatido')::bigint / 1000)::text
                else 'NUNCA' end as latido
      from mdtask_usuarios u
     where lower(u.usuario) = 'yadira.campero' or lower(u.correo) = 'yadira.campero'
     order by (u.activo is not false) desc,
              (coalesce(u.datos->>'puestoId', '') <> '') desc,
              case when u.datos->>'ultimoLatido' ~ '^[0-9]+$'
                   then (u.datos->>'ultimoLatido')::bigint else 0 end desc,
              u.id
     limit 3
  loop
    n := n + 1;
    raise notice '[052]   #% · "%" · activo=% · puesto=% · latido=%',
      n, r.nombre, r.activo, r.puesto, r.latido;
  end loop;
  raise notice '[052] La #1 es la que api/login.js elige SIEMPRE. Antes era la que Postgres encontrara primero.';
end $$;
