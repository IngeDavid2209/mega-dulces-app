-- ============================================================================
--  PARTE C — APAGAR LAS CUENTAS DE PERSONA
--
--  ⚠ ESTE ARCHIVO VIVE EN `pendientes/` A PROPÓSITO Y NO SE APLICA SOLO.
--  `db-migrate.js` hace `readdirSync` sobre `scripts/sql` SIN recursión, así que
--  esta subcarpeta es invisible para el runner. Si estuviera un nivel arriba, el
--  próximo despliegue la ejecutaría — y hoy eso dejaría a 186 personas fuera de
--  la app. El mismo mecanismo que protege a la 053 y la 054.
--
--  ═══════════════════════════════════════════════════════════════════════════
--   POR QUÉ NO SE PUEDE CORRER TODAVÍA, dicho con la causa exacta
--  ═══════════════════════════════════════════════════════════════════════════
--  No es prudencia: es que al 13/sep/2026 NO EXISTE UNA SOLA CREDENCIAL DE
--  PLAZA. Nadie ha capturado una plantilla, así que no hay plazas, así que no
--  hay códigos ni PINs. Apagar las cuentas hoy cerraría los DOS caminos a la
--  vez y la operación se detendría por completo.
--
--  Los tres candados de abajo comprueban justo eso, y ABORTAN en vez de dejar a
--  nadie fuera. No se quitan «porque ya sabemos que está bien»: son la
--  diferencia entre un despliegue y un incidente.
--
--  ─── LO QUE ESTA MIGRACIÓN NO HACE ────────────────────────────────────────
--  NO BORRA NINGUNA FICHA. Decisión de David el 13/sep: las personas se apagan
--  como CUENTA y se conservan como NOMBRES. Borrarlas dejaría al pase de lista
--  sin a quién asignar, a los checklists de agosto sin a quién atribuir, y al
--  bot de WhatsApp sin saber a quién le habla. Aquí solo se marca
--  `datos.accesoPorCuenta = false`; el nombre, el puesto y la sucursal siguen
--  intactos y la persona sigue apareciendo en todas las listas.
--
--  ─── REVERSA (§8.3), probada antes que la ida ─────────────────────────────
--    update mdtask_usuarios
--       set datos = datos - 'accesoPorCuenta' - 'accesoApagadoEn'
--     where datos ? 'accesoPorCuenta';
--  Con eso todas las cuentas vuelven a entrar. Sin borrado físico, sin pérdida.
-- ============================================================================

do $$
declare
  -- La única cuenta que sobrevive. Confirmada POR ESCRITO por David el
  -- 13/sep/2026 tras dictarla por voz: si estuviera mal escrita, esta migración
  -- dejaría fuera al administrador y no habría cómo volver a entrar.
  c_admin   constant text := 'davidcisneros2209@outlook.es';
  n_cred      bigint;
  n_usadas    bigint;
  n_plazas    bigint;
  n_apagadas  bigint;
  n_admin     bigint;
begin
  -- ── CANDADO 1: tiene que existir el otro camino ──────────────────────────
  select count(*) into n_cred   from mdtask_credenciales_plaza where activa;
  select count(*) into n_plazas from mdtask_plazas where vigente;
  if n_cred = 0 then
    raise exception 'ABORTA: hay % plaza(s) vigente(s) y CERO credenciales activas. '
      'Apagar las cuentas ahora cierra los dos caminos a la vez.', n_plazas;
  end if;

  -- ── CANDADO 2: alguien tiene que haber ENTRADO por ahí ───────────────────
  --
  -- Que la credencial exista no prueba que funcione. Hasta que una persona real
  -- haya entrado con su código y su PIN, esto es una teoría — y no se apaga el
  -- acceso de 186 personas sobre una teoría.
  select count(*) into n_usadas from mdtask_credenciales_plaza
   where activa and ultimo_acceso is not null;
  if n_usadas = 0 then
    raise exception 'ABORTA: hay % credencial(es) activa(s) y NINGUNA se ha usado. '
      'Nadie ha entrado por plaza todavia.', n_cred;
  end if;

  -- ── CANDADO 3: el administrador tiene que existir y poder entrar ─────────
  select count(*) into n_admin from mdtask_usuarios
   where lower(correo) = lower(c_admin) and activo is not false;
  if n_admin <> 1 then
    raise exception 'ABORTA: se esperaba EXACTAMENTE 1 ficha activa con el correo %, y hay %. '
      'Sin ella, esta migracion deja la app sin administrador.', c_admin, n_admin;
  end if;

  -- ── La ida ───────────────────────────────────────────────────────────────
  update mdtask_usuarios
     set datos = coalesce(datos, '{}'::jsonb)
               || jsonb_build_object('accesoPorCuenta', false,
                                     'accesoApagadoEn', extract(epoch from now())::bigint * 1000)
   where lower(coalesce(correo, '')) <> lower(c_admin);
  get diagnostics n_apagadas = row_count;

  raise notice '059 · cuentas apagadas: % · conservada: % · credenciales activas: % (% ya usadas) · plazas vigentes: %',
    n_apagadas, c_admin, n_cred, n_usadas, n_plazas;
  raise notice '059 · NINGUNA ficha se borro: siguen como nombres para el pase de lista, el historial y el bot';
end $$;
