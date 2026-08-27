-- Activacion de promociones: el permiso unico se parte en DOS oficios.
--
-- Antes habia una sola bandera, `grupoPromociones`, y quien la tenia hacia todo:
-- daba de alta el formato MKTN001, lo editaba, lo quitaba y llenaba los
-- expedientes de cualquier sucursal. Ahora son dos permisos independientes que
-- se prenden por separado desde Personal:
--
--   promocionesFormato      captura el formato y lo edita, lo quita, y ademas
--                           llena expedientes de donde sea. Alcanza todo.
--   promocionesExpediente   SOLO sube evidencia, y unicamente de los canales de
--                           SUS sucursales. No modifica el formato y no puede
--                           quitar nada de lo que ya se subio.
--
-- A quien HOY tiene el permiso viejo se le prenden LOS DOS: el dia del cambio
-- nadie pierde nada de lo que ya podia hacer. De ahi en adelante David va
-- apagando a mano el de formato a quien solo deba llenar expedientes.
--
-- `grupoPromociones` NO se borra a proposito: las sesiones firmadas antes del
-- cambio traen las banderas de ese momento guardadas en el navegador, y el
-- guard, el menu y el servidor la siguen aceptando hasta que la gente vuelve a
-- entrar. Se puede limpiar en una migracion posterior, cuando ya no quede
-- ninguna sesion vieja.
--
-- Es idempotente: correrla dos veces deja lo mismo. `||` sobre jsonb pisa las
-- llaves que ya existan, asi que a quien ya se le hubiera configurado a mano...
-- se le volveria a poner en true. Por eso el WHERE excluye a los que ya tienen
-- alguna de las dos banderas puestas: a esos ya se les decidio y no se tocan.

update mdtask_usuarios
   set datos = coalesce(datos, '{}'::jsonb)
             || '{"promocionesFormato": true, "promocionesExpediente": true}'::jsonb
 where datos->>'grupoPromociones' = 'true'
   and datos->>'promocionesFormato'    is null
   and datos->>'promocionesExpediente' is null;

-- Para revisar como quedo:
--
--   select id, nombre,
--          datos->>'grupoPromociones'      as viejo,
--          datos->>'promocionesFormato'    as formato,
--          datos->>'promocionesExpediente' as expediente,
--          datos->'sucursales'             as sucursales
--     from mdtask_usuarios
--    where datos->>'grupoPromociones' = 'true'
--       or datos->>'promocionesFormato' = 'true'
--       or datos->>'promocionesExpediente' = 'true'
--    order by nombre;
