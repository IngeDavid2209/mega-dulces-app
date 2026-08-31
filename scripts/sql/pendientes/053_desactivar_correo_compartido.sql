-- =====================================================================
-- DESACTIVA LAS DOS FICHAS DE `mataviejitas778@gmail.com`
--
--   "EL DAVE" (usuario inge.dave) · dato de pruebas, PROBADO
--   "Miriam"  (usuario miriam)    · no atribuible
--
-- ═══════════════════════════════════════════════════════════════════════
--  ⚠ ESTA EN pendientes/ PARA QUE NINGUN DESPLIEGUE LA APLIQUE POR ACCIDENTE
-- ═══════════════════════════════════════════════════════════════════════
-- Vivia en `scripts/sql/` y eso era un accidente esperando: el runner aplica
-- TODO lo que hay ahi en el proximo arranque, sin importar por que se
-- desplego. Un despliegue del sidebar, o de cualquier otra cosa, la habria
-- ejecutado — y con eso se destruye la medicion de abajo.
--
-- Para aplicarla: mover a `scripts/sql/` y desplegar. Nada mas.
--
--  ⚠ ORDEN OBLIGATORIO: VA DESPUES DE MEDIR
-- ═══════════════════════════════════════════════════════════════════════
-- `scripts/diagnostico-asignaciones-huerfanas.js` mide la cubeta E -fichas sin
-- plaza asignadas a una sucursal real, que es el mecanismo del selector- y hoy
-- las UNICAS fichas conocidas que la ejercen son estas dos.
--
-- Si esta migracion corre ANTES del script, esas fichas pasan a inactivas, se
-- van a la cubeta B, y la cubeta E queda vacia: la medicion se destruye y ya no
-- se puede recuperar sin reactivarlas. **Correr el script primero.**
--
-- ═══════════════════════════════════════════════════════════════════════
--  LA EVIDENCIA DE CADA UNA
-- ═══════════════════════════════════════════════════════════════════════
-- EL DAVE: cinco checklists de UN punto en `SISTEMAS`, creados por "Administrador
-- Supremo" el 6, 7 y 8 de mayo — tres el mismo dia en siete minutos (18:37,
-- 18:43, 18:44). Eso es alguien probando el flujo, no operacion. Nunca ha
-- iniciado sesion, no tiene puesto, no tiene dispositivo.
--
-- MIRIAM: un solo checklist, del 22/may, en `La Piedad Abastos`. Y en la nomina
-- hay DOS Miriam, las dos en OTRAS plazas: CARRILLO CONTRERAS MIRIAM JAZMIN
-- (8 Esquinas) y RODRIGUEZ SANCHEZ MIRIAM JUDITH (Canindo). Asi que la ficha NO
-- ES ATRIBUIBLE: aunque fuera una persona, no se puede decir cual. Nunca ha
-- iniciado sesion, no tiene puesto, no tiene dispositivo.
--
-- Su checklist se creo el mismo SEGUNDO que el sexto de EL DAVE (13:11:11), los
-- dos por Claudia Pimentel Duran: una asignacion en bloque cuyo selector ofrecio
-- fichas ajenas a esa plaza.
--
-- ═══════════════════════════════════════════════════════════════════════
--  POR QUE SE DESACTIVAN Y NO SE BORRAN, NI SE LES QUITA EL CORREO
-- ═══════════════════════════════════════════════════════════════════════
-- El invariante es que nada se borra. Y tampoco se edita el correo: mientras las
-- dos fichas existan compartiendolo, el `order by` de api/login.js las ordena de
-- forma estable, pero UNA de las dos sigue ganando el login. Desactivarlas cierra
-- el acceso por esa via sin destruir el rastro de que existieron.
--
-- El filo de privacidad era LATENTE, no realizado: ninguna se ha abierto jamas,
-- asi que nadie ha caido en la sesion de nadie. Esto lo cierra antes de que
-- alguien empiece a usarlas.
--
-- ═══════════════════════════════════════════════════════════════════════
--  REVERSA (escrita antes que la ida, §8.3)
-- ═══════════════════════════════════════════════════════════════════════
--   update mdtask_usuarios
--      set activo = true,
--          datos = datos - '_bajaEn' - '_bajaMotivo' - '_bajaEvento'
--    where datos->>'_bajaEvento' = '053_correo_compartido';
--
-- Idempotente y exacta: el sello `_bajaEvento` no toca ni una fila de mas. Los
-- checklists de las dos fichas NO se tocan, asi que la reversa los devuelve
-- intactos a las mediciones.
-- =====================================================================

do $$
declare
  r record;
  n_antes  bigint;
  n_hecho  bigint;
begin
  -- Cuenta y reporta ANTES de tocar. Si sale 0, se dice y no se concluye nada.
  select count(*) into n_antes
    from mdtask_usuarios u
   where u.activo is not false
     and lower(btrim(coalesce(u.correo,''))) = 'mataviejitas778@gmail.com';

  raise notice '[053] fichas activas con ese correo, antes de tocar: %', n_antes;
  if n_antes = 0 then
    raise notice '[053] AVISO: cero fichas. O ya se desactivaron, o el correo cambio. No se toca nada.';
    return;
  end if;

  -- El detalle de cada una, para que el log sea auditable por si solo.
  for r in
    select u.nombre,
           coalesce(nullif(u.usuario,''),'(sin usuario)') as usuario,
           coalesce(nullif(u.datos->>'puestoId',''),'(sin puesto)') as puesto,
           case when u.datos->>'ultimoLatido' ~ '^[0-9]+$'
                then to_timestamp((u.datos->>'ultimoLatido')::bigint/1000)::text
                else 'NUNCA' end as latido,
           (select count(*) from mdtask_checklists c where c.assigned = u.nombre) as checklists
      from mdtask_usuarios u
     where u.activo is not false
       and lower(btrim(coalesce(u.correo,''))) = 'mataviejitas778@gmail.com'
     order by u.nombre
  loop
    raise notice '[053]   "%" · usuario=% · puesto=% · latido=% · checklists=%',
      r.nombre, r.usuario, r.puesto, r.latido, r.checklists;
  end loop;

  -- ── La baja. Los checklists NO se tocan. ────────────────────────────────
  update mdtask_usuarios u
     set activo = false,
         datos = coalesce(u.datos, '{}'::jsonb)
                 || jsonb_build_object(
                      '_bajaEn', '2026-08-31',
                      '_bajaMotivo',
                      case
                        when lower(coalesce(u.usuario,'')) = 'inge.dave'
                          then 'cuenta de pruebas: 5 checklists de 1 punto en SISTEMAS, 3 el mismo dia en 7 minutos, nunca inicio sesion'
                        else 'ficha no atribuible: hay DOS Miriam en nomina y ninguna en La Piedad Abastos; nunca inicio sesion; compartia correo'
                      end,
                      '_bajaEvento', '053_correo_compartido')
   where u.activo is not false
     and lower(btrim(coalesce(u.correo,''))) = 'mataviejitas778@gmail.com';
  get diagnostics n_hecho = row_count;

  raise notice '[053] fichas desactivadas: % de %', n_hecho, n_antes;
  if n_hecho <> n_antes then
    raise notice '[053] AVISO: se esperaban % y se tocaron %. Revisar.', n_antes, n_hecho;
  end if;
  raise notice '[053] Los checklists NO se tocaron: siguen auditables y la reversa los devuelve intactos.';
  raise notice '[053] Recordatorio: el correo compartido debe salir de esas cuentas en Firebase Auth aparte.';
end $$;
