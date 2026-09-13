-- ============================================================================
--  FASE 3 — EL ACCESO DEJA DE SER DE UNA PERSONA Y PASA A SER DE UNA PLAZA
--
--  Instrucción de David (13/sep/2026), literal: «no quiero que quede ningún
--  usuario más que el que tiene el correo de davidcisneros2209@outlook.es […]
--  dame la forma de cómo vamos a manejar el login para esos usuarios […] cómo
--  vamos a darle su usuario a anaquelista uno, dos y tres».
--
--  ═══════════════════════════════════════════════════════════════════════════
--   LA DISTINCIÓN QUE HACE QUE ESTO NO SEA UN CORREO COMPARTIDO
--  ═══════════════════════════════════════════════════════════════════════════
--  CUENTA  = por PLAZA. «PH-ANA-1» + un PIN.
--  PERSONA = por COBERTURA. Quién ocupa esa plaza hoy lo dice el pase de lista.
--
--  Sin la segunda mitad, esto sería exactamente `mataviejitas778@gmail.com`:
--  una cuenta que varias personas usan y cuya evidencia no se puede atribuir a
--  nadie (migraciones 051-053). Con ella, cada foto sigue teniendo nombre y
--  apellido — que es el invariante §4: «identidad (cobertura, no nombre
--  escrito)».
--
--  ─── LAS FICHAS DE PERSONA NO SE BORRAN ───────────────────────────────────
--  Decisión de David el 13/sep: se apagan como CUENTA y se conservan como
--  NOMBRES. Borrarlas dejaría al pase de lista sin a quién asignar, a los
--  checklists de agosto sin a quién atribuir, y al bot de WhatsApp sin saber a
--  quién le habla. Esta migración NO toca `mdtask_usuarios`: apagar las cuentas
--  es un paso POSTERIOR, y solo cuando una sucursal real haya entrado por plaza.
--
--  ═══════════════════════════════════════════════════════════════════════════
--   EL PIN NO SE GUARDA. SE GUARDA SU HASH.
--  ═══════════════════════════════════════════════════════════════════════════
--  `pin_hash` es bcrypt, el mismo esquema que ya usan las contraseñas nuevas
--  (`api/_password.js`). Consecuencia práctica que hay que decir ANTES de que
--  alguien la descubra: un PIN perdido NO se puede consultar, solo regenerar.
--  Por eso la pantalla lo muestra UNA vez, al crearlo, con su hoja para
--  imprimir.
--
--  ─── LOS DOS ÍNDICES SON LA MITAD DE LA SEGURIDAD ─────────────────────────
--   1. `codigo` ÚNICO en toda la tabla, incluidas las inactivas: un código
--      entregado no se reutiliza JAMÁS. Si se reciclara, la hoja impresa de
--      alguien empezaría a abrir la plaza de otra persona y ninguna de las dos
--      se enteraría.
--   2. UNA credencial activa por plaza. Dos activas significaría que la misma
--      plaza tiene dos accesos vivos y que revocar uno no revoca nada.
--
--  ─── REVERSA (§8.3) ───────────────────────────────────────────────────────
--    update mdtask_credenciales_plaza set activa = false;
--  Con eso ninguna credencial sirve y NADIE pierde acceso: hoy se sigue
--  entrando por `mdtask_usuarios`, que esta migración no toca. Sin borrado
--  físico: las credenciales retiradas son la historia de quién tuvo acceso.
--
--  DDL PURO. No genera una sola credencial: eso lo hace David desde la pantalla.
-- ============================================================================

create table if not exists mdtask_credenciales_plaza (
  id             text primary key,
  -- Sin FK a mdtask_plazas: este repo tiene 0 FK en 36 tablas (hallazgo 1) y
  -- meter la primera aquí mezclaría el cambio de acceso con un cambio de
  -- política de integridad. Va cuando la Fase 3 cierre.
  plaza_id       text not null,
  codigo         text not null,
  -- bcrypt. NUNCA el PIN en claro, ni siquiera en `datos`.
  pin_hash       text not null,
  activa         boolean not null default true,
  creada_en      bigint,
  creada_por     text,
  -- Para poder decir «esta plaza nunca ha entrado», que es distinto de «entró y
  -- no hizo nada» (§5.2). El silencio medido el 31/ago salió de esta pregunta.
  ultimo_acceso  bigint,
  datos          jsonb not null default '{}'::jsonb
);

-- Un código no se reutiliza nunca. Ver candado 1 en la cabecera.
create unique index if not exists idx_mdtask_cred_codigo
  on mdtask_credenciales_plaza (codigo);

-- Una sola credencial ACTIVA por plaza. Parcial: las revocadas conviven, son
-- la historia de quién tuvo acceso a qué y desde cuándo.
create unique index if not exists idx_mdtask_cred_una_activa
  on mdtask_credenciales_plaza (plaza_id) where activa;

do $$
declare
  n_cred bigint;
  n_act  bigint;
begin
  select count(*) into n_cred from mdtask_credenciales_plaza;
  select count(*) into n_act  from mdtask_credenciales_plaza where activa;
  raise notice '058 · credenciales de plaza: % filas (% activas)', n_cred, n_act;
  raise notice '058 · los ceros son el resultado ESPERADO en la primera corrida: las credenciales las genera Direccion desde la pantalla de Accesos, no una migracion';
end $$;
