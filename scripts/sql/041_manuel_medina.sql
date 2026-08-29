-- =====================================================================
-- MANUEL MEDINA · Auxiliar de Reparto (el que la 039 no encontro)
--
-- El diagnostico de la 040 lo explico: en la app esta capturado como
-- "MANUEL MEDIAN ESPINOZA". MEDIAN, no MEDINA. La nomina lo trae bien
-- ("MEDINA ESPINOZA MANUEL"), asi que el error esta en su ficha.
--
-- Se le busca por 'median', que en las 153 fichas activas solo lo produce ese
-- error de dedo: una palabra mal escrita es, por accidente, un identificador
-- bastante bueno.
--
-- --- EL NOMBRE NO SE CORRIGE AQUI, Y ES A PROPOSITO ------------------------
-- Da comezon dejarlo mal escrito, pero los checklists guardan a la persona por
-- NOMBRE en el campo `assigned`, no por id. Cambiarle el nombre a la ficha
-- dejaria sus checklists existentes apuntando a un nombre que ya no existe:
-- perderia su historial y las tareas del dia se le desprenderian.
--
-- Arreglarlo bien es renombrar la ficha Y todos sus checklists en la misma
-- transaccion, y eso merece revisarse aparte y con David enterado. Lo que si
-- urge -que reciba sus tareas- no depende del nombre sino del puesto, y eso es
-- lo que hace esta migracion.
-- =====================================================================

do $$
declare
  n_cand bigint;
  n_hecho bigint;
begin
  select count(*) into n_cand
    from mdtask_usuarios u
   where u.activo is not false
     and mdtask_tokens_nombre(u.nombre) @> array['median','manuel']::text[];

  if n_cand > 1 then
    raise notice '[041] % candidatos con {median,manuel}: NO se toca a nadie.', n_cand;
    return;
  end if;

  update mdtask_usuarios u
     set cargo = 'Auxiliar de Reparto',
         datos = coalesce(u.datos, '{}'::jsonb)
                 || jsonb_build_object('puestoId', 'aux-reparto',
                                       '_puestoAsignadoEn', '2026-08-29',
                                       '_puestoOrigen', 'confirmado por David',
                                       '_nombreMalEscrito', 'la ficha dice MEDIAN; la nomina dice MEDINA')
   where u.activo is not false
     and mdtask_tokens_nombre(u.nombre) @> array['median','manuel']::text[];
  get diagnostics n_hecho = row_count;

  raise notice '[041] Manuel Medina -> aux-reparto: % candidato(s), % actualizado(s)', n_cand, n_hecho;
  if n_cand = 0 then
    raise notice '[041] AVISO: tampoco aparece con median. Revisar a mano.';
  end if;
end $$;
