-- ============================================================================
--  FASE 3 · PASO 3.1b — LA PLANTILLA DE CADA SUCURSAL
--
--  Instrucción de David (13/sep/2026), literal: «falta tener una sección donde
--  cada sucursal va a tener su propia plantilla de cómo debería de estar
--  acomodada su zona de trabajo. Por ejemplo, la sucursal de Padre Hidalgo debe
--  tener cuatro anaquelistas, dos bodegueros, dos surtidores, una encargada, una
--  auxiliar de encargada.»
--
--  ─── LA DISTINCIÓN QUE HACE ÚTIL A ESTA TABLA ─────────────────────────────
--  La plantilla dice lo que DEBE haber. El censo (mdtask_usuarios cruzado con
--  el catálogo) dice lo que HAY. Hoy el sistema solo conoce lo segundo, así que
--  no puede nombrar ni una VACANTE ni un EXCEDENTE: si en Padre Hidalgo faltan
--  dos anaquelistas, el tablero muestra el trabajo repartido entre los que
--  quedan y se lee como bajo cumplimiento de esas personas.
--
--  El propio ejemplo de David ya lo destapa. Él dice CUATRO anaquelistas en
--  Padre Hidalgo; el guardián de duplicados del 31/ago midió CINCO fichas
--  activas con ese puesto en esa sucursal. Una de las dos cifras está mal, y
--  hasta hoy no existía el lugar donde esa pregunta se pudiera siquiera hacer.
--
--  ─── POR QUÉ LA PLANTILLA NO ES LA PLAZA ──────────────────────────────────
--  `mdtask_plazas` (056) es la posición concreta y numerada: «Anaquelista · Padre
--  Hidalgo · 3». La plantilla es la AUTORIZACIÓN: «en Padre Hidalgo hay cuatro
--  anaquelistas autorizados». De la plantilla se GENERAN las plazas, no al revés.
--  Separarlas es lo que permite que una plaza siga existiendo, vacía y visible,
--  cuando alguien renuncia: la autorización no se va con la persona.
--
--  ═══════════════════════════════════════════════════════════════════════════
--   PUESTOS DECLARADOS ("de temporada"), y el candado que llevan
--  ═══════════════════════════════════════════════════════════════════════════
--  David pidió, con estas palabras: «quiero que pienses como un jefe reclutador
--  en el cual, si el puesto no existe, poder agregar uno que sea de Temporada».
--
--  Eso es la Fase 7 (la norma como dato) entrando por la puerta de la plantilla,
--  y es legítimo: la §8.5 prohíbe que el DESARROLLO invente un puesto por
--  parecido, no que Dirección declare uno explícitamente, con autor y fecha.
--
--  Pero el hallazgo 1 de este proyecto es que la identidad se cruza por TEXTO, y
--  un puesto nuevo escrito a mano es exactamente cómo nace un duplicado. De ahí
--  los tres candados de `mdtask_puestos_declarados`:
--
--   1. EL ID LLEVA PREFIJO `tmp-` POR RESTRICCIÓN DE TABLA, no por convención.
--      Un `check (id like 'tmp-%')` hace IMPOSIBLE que un puesto declarado
--      colisione con uno del catálogo publicado. Sin esto, alguien que teclee
--      «anaquelista» crearía un segundo puesto con el mismo id que el real y el
--      cruce puesto→unidad empezaría a devolver dos respuestas distintas.
--
--   2. `hasta` ES OBLIGATORIA. Una temporada sin fecha de fin es un puesto
--      permanente con otro nombre, y en tres meses nadie sabe por qué existe.
--      La restricción `not null` es la que obliga a contestar «¿hasta cuándo?».
--
--   3. NO SE BORRAN, se marcan `vigente = false` (§2: los ids publicados se
--      conservan). Una temporada que termina deja su historia en pie: los
--      checklists que se le emitieron siguen teniendo a qué puesto apuntar.
--
--  ─── LO QUE UN PUESTO DECLARADO *NO* HACE, y hay que decirlo ───────────────
--  NO recibe tareas del manual. El robot emite recorriendo el catálogo por
--  `puestoId`, y un puesto declarado no tiene manual escrito: su columna de
--  tareas va a salir VACÍA. Es correcto —no se puede exigir el cumplimiento de
--  una norma que nadie ha escrito— pero si no se dice en pantalla se lee como
--  que la app está rota. La pantalla lo nombra; esta tabla guarda el dato.
--
--  ─── REVERSA (§8.3) ───────────────────────────────────────────────────────
--    update mdtask_plantillas          set vigente = false;
--    update mdtask_puestos_declarados  set vigente = false;
--  Con eso la sección queda inerte y NADIE pierde acceso ni tareas: ninguna de
--  las dos tablas se lee todavía desde la app, y ninguna toca `mdtask_usuarios`,
--  `mdtask_checklists` ni `mdtask_plazas`. Sin borrado físico.
--
--  DDL PURO. No siembra una sola fila: la plantilla la captura Dirección.
-- ============================================================================

-- ─── La plantilla autorizada, por sucursal y puesto ────────────────────────
create table if not exists mdtask_plantillas (
  id           text primary key,
  sucursal     text not null,
  -- Puede apuntar al catálogo publicado ('anaquelista') o a un puesto
  -- declarado ('tmp-...'). No lleva llave foránea a propósito: el catálogo
  -- vive en TypeScript (hallazgo 5), así que la integridad de ese lado la
  -- comprueba la aplicación y NO se puede fingir aquí.
  puesto_id    text not null,
  cantidad     integer not null check (cantidad >= 0),
  vigente      boolean not null default true,
  creado_en    bigint,
  creado_por   text,
  datos        jsonb not null default '{}'::jsonb
);

-- Una sola plantilla VIGENTE por sucursal y puesto. Parcial a propósito, como
-- en la 056: las versiones retiradas (vigente = false) conviven sin estorbar,
-- que es lo que permite conservar la historia sin borrar nada (§5.5).
create unique index if not exists mdtask_plantillas_uk_vigente
  on mdtask_plantillas (sucursal, puesto_id)
  where vigente;

create index if not exists mdtask_plantillas_ix_sucursal
  on mdtask_plantillas (sucursal) where vigente;

-- ─── Puestos declarados por Dirección (temporada) ──────────────────────────
create table if not exists mdtask_puestos_declarados (
  -- El prefijo NO es convención: es restricción. Ver candado 1 en la cabecera.
  id           text primary key check (id like 'tmp-%'),
  nombre       text not null check (length(trim(nombre)) > 0),
  tipo         text not null default 'temporada',
  -- Unidad de control y jefe. Pueden venir vacíos: un puesto declarado sin
  -- unidad sale VISIBLE como pendiente, nunca rellenado por parecido (§8.5).
  unidad       text,
  reporta_a    text,
  desde        text,
  -- Obligatoria. Ver candado 2.
  hasta        text not null check (hasta ~ '^\d{4}-\d{2}-\d{2}$'),
  vigente      boolean not null default true,
  creado_en    bigint,
  creado_por   text,
  motivo       text,
  datos        jsonb not null default '{}'::jsonb
);

create index if not exists mdtask_puestos_declarados_ix_vigente
  on mdtask_puestos_declarados (vigente);

-- ─── Reporte: sin esto una migración solo dice "aplicada" y no se audita ───
do $$
declare
  n_plantillas bigint;
  n_puestos    bigint;
  n_sucursales bigint;
begin
  select count(*) into n_plantillas from mdtask_plantillas;
  select count(*) into n_puestos    from mdtask_puestos_declarados;
  select count(distinct sucursal) into n_sucursales from mdtask_plantillas;

  raise notice '057 · plantillas: % filas en % sucursal(es) · puestos declarados: % filas',
    n_plantillas, n_sucursales, n_puestos;
  raise notice '057 · los tres ceros son el resultado ESPERADO en la primera corrida: la plantilla la captura Direccion, no la siembra una migracion';
end $$;
