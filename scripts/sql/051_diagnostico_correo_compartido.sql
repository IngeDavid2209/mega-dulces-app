-- =====================================================================
-- DIAGNOSTICO · NO CAMBIA NADA
--
-- `mataviejitas778@gmail.com` aparece en DOS fichas activas con nombres
-- distintos: "EL DAVE" (usuario inge.dave) y "Miriam" (usuario miriam).
--
-- Importa porque `api/login.js` tambien resuelve por correo, asi que quien entre
-- con ese correo aterriza en la fila que gane el orden. Si son dos personas
-- reales, UNA PUEDE QUEDAR DENTRO DE LA SESION DE LA OTRA. Ese es el unico caso
-- de todo el diagnostico con filo de privacidad, no solo de reporte.
--
-- ═══════════════════════════════════════════════════════════════════════
--  EL CRITERIO SE FIJA ANTES DE MIRAR
-- ═══════════════════════════════════════════════════════════════════════
-- Si se mira primero y se decide despues, la conclusion se acomoda a lo que uno
-- queria ver. Asi que queda escrito aqui, y la consulta lo aplica sola:
--
--   PERSONA REAL  si la ficha trae CUALQUIERA de estas: un `puestoId`, un
--                 `ultimoLatido`, o checklists asignados.
--                 -> Dos personas sobre una cuenta de Auth. Se arregla AUNQUE
--                    todo lo demas espere.
--
--   DE PRUEBAS    si NO trae ninguna de las tres.
--                 -> No se deja como ruido permanente en cada diagnostico: se
--                    saca de produccion.
--
-- La consulta imprime el veredicto por ficha segun ese criterio, mas las cifras
-- de las que sale. No decide que hacer: eso lo decide David con el veredicto
-- enfrente.
--
-- Solo LEE. Ni un UPDATE.
-- =====================================================================

do $$
declare
  r record;
  n bigint;
  n_reales bigint := 0;
begin
  select count(*) into n
    from mdtask_usuarios u
   where u.activo is not false
     and lower(btrim(coalesce(u.correo,''))) = 'mataviejitas778@gmail.com';

  raise notice '[051] fichas activas con ese correo: %', n;
  if n = 0 then
    raise notice '[051] AVISO: cero fichas. O ya se corrigio, o el correo se escribe distinto. No se leyo nada.';
    return;
  end if;

  for r in
    select u.id, u.nombre,
           coalesce(nullif(u.usuario,''), '(sin usuario)') as usuario,
           coalesce(u.rol, '(sin rol)')                    as rol,
           coalesce(u.datos->>'puestoId', '')              as puesto,
           case when u.datos->>'ultimoLatido' ~ '^[0-9]+$'
                then to_timestamp((u.datos->>'ultimoLatido')::bigint / 1000)
                else null end                              as latido,
           (select count(*) from mdtask_checklists c where c.assigned = u.nombre) as checklists,
           (select count(*) from mdtask_usuarios_tokens t where t.uid = u.id)     as dispositivos
      from mdtask_usuarios u
     where u.activo is not false
       and lower(btrim(coalesce(u.correo,''))) = 'mataviejitas778@gmail.com'
     order by u.nombre
  loop
    raise notice '[051]   "%" · usuario=% · rol=% · id=%', r.nombre, r.usuario, r.rol, r.id;
    raise notice '[051]      puesto=% · latido=% · checklists=% · dispositivos=%',
      coalesce(nullif(r.puesto,''), '(ninguno)'),
      coalesce(r.latido::text, 'NUNCA'),
      r.checklists, r.dispositivos;

    -- El criterio, aplicado por la consulta y no por mi impresion.
    if nullif(r.puesto,'') is not null or r.latido is not null or r.checklists > 0 then
      n_reales := n_reales + 1;
      raise notice '[051]      VEREDICTO: PARECE PERSONA REAL (trae puesto, latido o checklists)';
    else
      raise notice '[051]      VEREDICTO: PARECE DE PRUEBAS (sin puesto, sin latido, sin checklists)';
    end if;
  end loop;

  raise notice '[051] fichas que parecen reales: % de %', n_reales, n;
  if n_reales > 1 then
    raise notice '[051] DOS O MAS REALES sobre un mismo correo: hay filo de PRIVACIDAD.';
    raise notice '[051] Una persona puede quedar dentro de la sesion de la otra. Se arregla aunque todo lo demas espere.';
  elsif n_reales = 1 then
    raise notice '[051] Una real y el resto de pruebas: sacar las de pruebas de produccion, no dejarlas como ruido.';
  else
    raise notice '[051] Ninguna parece real: las dos son de pruebas y salen de produccion.';
  end if;
end $$;
