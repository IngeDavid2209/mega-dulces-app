-- =====================================================================
-- DIAGNOSTICO DE IDENTIDAD · NO CAMBIA NADA
--
-- Sale del caso Yadira, donde el hallazgo no fue el duplicado sino esto: dos
-- fichas comparten `usuario = yadira.campero`, y `api/login.js` linea 45 resuelve
-- con `where lower(usuario) = $1 or lower(correo) = $1 LIMIT 1` sin ORDER BY.
-- Con dos filas empatadas, la que Postgres devuelva primero es la ficha en la
-- que la persona SE CONVIERTE, y contra el hash de esa fila se valida su
-- contrasena.
--
-- Dicho con precision, porque la version exagerada circula facil y es falsa:
-- NO es que dos personas puedan entrar a la misma cuenta. Es que UNA PERSONA
-- ENTRA A DOS CUENTAS DISTINTAS Y EL SISTEMA LA CUENTA COMO DOS. Eso si esta
-- probado, y es argumento suficiente.
--
-- ─── LAS TRES COLISIONES, QUE TIENEN CONSECUENCIAS DISTINTAS ──────────────
--   1. `usuario` repetido  -> ambiguedad al resolver el login.
--   2. `correo` repetido   -> dos fichas sobre UNA cuenta de Firebase Auth.
--   3. CRUZADA             -> el `usuario` de una persona es igual al `correo`
--                             de otra. El `or` de la consulta lo permite, y es
--                             el caso mas feo: escribes tu usuario y te
--                             autentican contra la ficha de alguien mas.
--
-- Por eso se imprime `correo`: es el campo que decide si son dos cuentas de Auth
-- o una sola con dos fichas peleandose el uid. Sin el no se puede saber si la
-- misma contrasena puede validar en ambas.
--
-- ─── Y SE CUENTA EL SILENCIO ─────────────────────────────────────────────
-- Es la parte que va a pesar mas, y no la trae ningun tablero hoy. Fichas
-- ACTIVAS y CON PUESTO cuyo `ultimoLatido` es nulo o de hace mas de 30 y 60
-- dias: son emisiones cayendo al vacio.
--
-- El caso Yadira lo enseno de la peor forma. Sus dos latidos son de JUNIO
-- (30/jun y 24/jun) y hoy es 31/ago: nadie ha entrado por ninguna en mas de dos
-- meses. Su cumplimiento no esta hundido por un duplicado — esta hundido porque
-- ahi nadie esta operando el sistema, y desde el 28/ago el robot le emite ~10
-- puntos diarios a una cuenta que nadie abre.
--
-- Es una falla de supervision (no_ejecutado / no_asignado), no de higiene de
-- datos. Y es exactamente el hueco que predice el modelo: hoy la AUSENCIA y el
-- INCUMPLIMIENTO se ven identicos.
--
-- Solo LEE. Ni un UPDATE.
-- =====================================================================

do $$
declare
  r record;
  n bigint;
  total_activas bigint;
  total_con_puesto bigint;
  -- Variables propias para el silencio. Antes reusaba total_activas y
  -- total_con_puesto como paso, lo que destruia su significado a media
  -- migracion: el notice decia "mas de 60 dias" leyendo una variable llamada
  -- "total_activas". Un nombre que miente es peor que no tenerlo.
  n_nunca  bigint;
  n_mas60  bigint;
  n_30a60  bigint;
begin
  -- Denominadores primero: ningun conteo se reporta sin la cifra de la que sale.
  select count(*) into total_activas
    from mdtask_usuarios where activo is not false;
  select count(*) into total_con_puesto
    from mdtask_usuarios
   where activo is not false and coalesce(datos->>'puestoId','') <> '';

  raise notice '[050] fichas activas: %  ·  de esas, con puesto: %', total_activas, total_con_puesto;
  if total_activas = 0 then
    raise notice '[050] AVISO: cero fichas activas. No se leyo nada; no concluyas.';
    return;
  end if;

  -- ── 1. `usuario` repetido ──────────────────────────────────────────────
  raise notice '[050] --- 1. USUARIO repetido (ambiguedad en el login) ---';
  n := 0;
  for r in
    select lower(btrim(u.usuario)) as clave, count(*) as fichas,
           string_agg(u.nombre || ' <' || coalesce(nullif(u.correo,''), 'sin correo') || '>'
                      || ' [' || coalesce(u.datos->>'puestoId','sin puesto') || ']', ' || '
                      order by u.nombre) as detalle
      from mdtask_usuarios u
     where u.activo is not false
       and coalesce(btrim(u.usuario), '') <> ''
     group by lower(btrim(u.usuario))
    having count(*) > 1
     order by count(*) desc
  loop
    n := n + 1;
    raise notice '[050]   usuario "%" → % fichas: %', r.clave, r.fichas, r.detalle;
  end loop;
  raise notice '[050]   grupos con usuario repetido: % (de % fichas activas)', n, total_activas;

  -- ── 2. `correo` repetido ───────────────────────────────────────────────
  raise notice '[050] --- 2. CORREO repetido (dos fichas sobre una cuenta de Auth) ---';
  n := 0;
  for r in
    select lower(btrim(u.correo)) as clave, count(*) as fichas,
           string_agg(u.nombre || ' (' || coalesce(nullif(u.usuario,''),'sin usuario') || ')',
                      ' || ' order by u.nombre) as detalle
      from mdtask_usuarios u
     where u.activo is not false
       and coalesce(btrim(u.correo), '') <> ''
     group by lower(btrim(u.correo))
    having count(*) > 1
     order by count(*) desc
  loop
    n := n + 1;
    raise notice '[050]   correo "%" → % fichas: %', r.clave, r.fichas, r.detalle;
  end loop;
  raise notice '[050]   grupos con correo repetido: %', n;

  -- ── 3. La cruzada: usuario de A == correo de B ─────────────────────────
  raise notice '[050] --- 3. CRUZADA: el usuario de una es el correo de otra ---';
  n := 0;
  for r in
    select a.nombre as nombre_a, a.usuario as usuario_a,
           b.nombre as nombre_b, b.correo as correo_b
      from mdtask_usuarios a
      join mdtask_usuarios b
        on lower(btrim(a.usuario)) = lower(btrim(b.correo))
       and a.id <> b.id
     where a.activo is not false and b.activo is not false
       and coalesce(btrim(a.usuario),'') <> ''
     order by a.nombre
  loop
    n := n + 1;
    raise notice '[050]   "%" usa "%" y eso es el correo de "%" (%)',
      r.nombre_a, r.usuario_a, r.nombre_b, r.correo_b;
  end loop;
  if n = 0 then
    raise notice '[050]   ninguna cruzada. Es el caso mas feo y no se presenta.';
  else
    raise notice '[050]   CRUZADAS: % — escribir tu usuario te autentica contra la ficha de otro.', n;
  end if;

  -- ── 4. El silencio: emisiones cayendo al vacio ─────────────────────────
  raise notice '[050] --- 4. SILENCIO: fichas con puesto que nadie abre ---';

  with vivos as (
    select u.id, u.nombre,
           coalesce(u.datos->>'puestoId','') as puesto,
           case when nullif(u.datos->>'ultimoLatido','') is null then null
                else to_timestamp((u.datos->>'ultimoLatido')::bigint / 1000) end as latido
      from mdtask_usuarios u
     where u.activo is not false
       and coalesce(u.datos->>'puestoId','') <> ''
  )
  select count(*) filter (where latido is null),
         count(*) filter (where latido is not null and latido < now() - interval '60 days'),
         count(*) filter (where latido is not null and latido < now() - interval '30 days'
                            and latido >= now() - interval '60 days')
    into n_nunca, n_mas60, n_30a60
    from vivos;

  raise notice '[050]   NUNCA han entrado: % de % con puesto', n_nunca, total_con_puesto;
  raise notice '[050]   sin entrar hace mas de 60 dias: %', n_mas60;
  raise notice '[050]   sin entrar entre 30 y 60 dias: %', n_30a60;
  raise notice '[050]   silencio total (nunca + mas de 30 dias): % de %',
    n_nunca + n_mas60 + n_30a60, total_con_puesto;

  -- Los peores, con nombre, para poder llamarles.
  raise notice '[050] --- los 15 silencios mas largos, con puesto ---';
  n := 0;
  for r in
    select u.nombre,
           coalesce(u.datos->>'puestoId','') as puesto,
           coalesce(u.datos->>'sucursal', u.datos->'sucursales'->>0, '(sin sucursal)') as sucursal,
           case when nullif(u.datos->>'ultimoLatido','') is null then null
                else to_timestamp((u.datos->>'ultimoLatido')::bigint / 1000) end as latido
      from mdtask_usuarios u
     where u.activo is not false
       and coalesce(u.datos->>'puestoId','') <> ''
       and (nullif(u.datos->>'ultimoLatido','') is null
         or to_timestamp((u.datos->>'ultimoLatido')::bigint / 1000) < now() - interval '30 days')
     order by latido asc nulls first
     limit 15
  loop
    n := n + 1;
    raise notice '[050]   % · % · % · ultimo: %',
      r.nombre, r.puesto, r.sucursal, coalesce(r.latido::text, 'NUNCA');
  end loop;
  raise notice '[050]   listados: %', n;
end $$;
