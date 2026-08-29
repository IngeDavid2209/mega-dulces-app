-- =====================================================================
-- DIAGNOSTICO · NO CAMBIA NADA
--
-- La 039 no encontro a Manuel Medina: cero candidatos con {medina, manuel}.
-- O no tiene cuenta en la app, o su nombre esta escrito de otra forma, y desde
-- aqui no hay manera de mirar la base directamente.
--
-- Esta migracion solo LEE y escribe el resultado en el log del arranque, que es
-- el unico canal de lectura que existe hoy hacia esa base. No hace un solo
-- UPDATE. Se cuela por el runner de migraciones porque es lo que corre solo al
-- desplegar; queda registrada en _migraciones y no vuelve a correr.
--
-- Lo que se imprime son nombres y puestos de personal, que es exactamente lo
-- que hace falta para resolver esto y nada mas: ni correos, ni contrasenas, ni
-- telefonos, ni nada de la nomina.
-- =====================================================================

do $$
declare
  r record;
  n bigint;
begin
  -- ── 1. ¿Fernando Espitia quedo con puesto? ─────────────────────────────
  -- La 038 corrio ANTES de que el runner reenviara los notice, asi que su
  -- resultado nunca se vio. Esta es la unica forma de saberlo.
  raise notice '[040] --- Fernando Espitia ---';
  for r in
    select u.nombre, coalesce(u.datos->>'puestoId', '(sin puesto)') as puesto, u.activo
      from mdtask_usuarios u
     where mdtask_tokens_nombre(u.nombre) @> array['espitia']::text[]
  loop
    raise notice '[040]   "%"  puesto=%  activo=%', r.nombre, r.puesto, r.activo;
  end loop;

  -- ── 2. ¿Como esta escrito Manuel Medina? ───────────────────────────────
  raise notice '[040] --- quien tiene "medina" o "manuel" en el nombre ---';
  for r in
    select u.nombre, coalesce(u.datos->>'puestoId', '(sin puesto)') as puesto
      from mdtask_usuarios u
     where u.activo is not false
       and (mdtask_tokens_nombre(u.nombre) @> array['medina']::text[]
         or mdtask_tokens_nombre(u.nombre) @> array['manuel']::text[])
     order by u.nombre
  loop
    raise notice '[040]   "%"  puesto=%', r.nombre, r.puesto;
  end loop;

  -- ── 3. Los otros dos "Auxiliar de Chofer" de Tlmkt Canindo ─────────────
  -- Para poder preguntarle a David por ellos con el nombre que ve en la app.
  raise notice '[040] --- Casas Mendoza y Chavero (los otros dos de Tlmkt) ---';
  for r in
    select u.nombre, coalesce(u.datos->>'puestoId', '(sin puesto)') as puesto
      from mdtask_usuarios u
     where u.activo is not false
       and (mdtask_tokens_nombre(u.nombre) @> array['casas']::text[]
         or mdtask_tokens_nombre(u.nombre) @> array['chavero']::text[])
  loop
    raise notice '[040]   "%"  puesto=%', r.nombre, r.puesto;
  end loop;

  -- ── 4. El tamano real del problema ─────────────────────────────────────
  select count(*) into n from mdtask_usuarios u
   where u.activo is not false and coalesce(u.datos->>'puestoId', '') = '';
  raise notice '[040] activos SIN puestoId capturado: %', n;

  select count(*) into n from mdtask_usuarios u where u.activo is not false;
  raise notice '[040] activos en total: %', n;

  -- ── 5. ¿Son altas posteriores a la 037? ────────────────────────────────
  -- Si los que no tienen puesto son casi todos los que NO llevan el sello de
  -- aquella migracion, se confirma que el problema no es el cruce de nombres
  -- sino que nada sella el puesto de las altas nuevas.
  select count(*) into n from mdtask_usuarios u
   where u.activo is not false
     and coalesce(u.datos->>'puestoId', '') = ''
     and coalesce(u.datos->>'_puestoAsignadoEn', '') = '';
  raise notice '[040] de esos, sin sello de la 037 (probables altas nuevas): %', n;
end $$;
