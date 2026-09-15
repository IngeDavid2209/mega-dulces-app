-- ============================================================================
--  FASE 7 (adelanto) · PASO 7.1a — LA TAREA DE PUESTO EXISTE COMO DATO
--
--  Instrucción de David (14/sep/2026): «quiero que todos los puestos tengan sus
--  tareas propias activas», y enfrentado a las tres opciones eligió que las
--  tareas de los puestos sin manual se CAPTUREN desde la app, no que se
--  inventen en código.
--
--  ─── LA CIFRA QUE LO JUSTIFICA, MEDIDA ANTES DE ESCRIBIR ESTO ─────────────
--  De los 89 puestos vigentes del organigrama, solo 19 tienen manual escrito.
--  Cruzando contra la nómina de agosto (191 filas):
--
--      su puesto TIENE manual .......  82 personas
--      su puesto NO tiene manual ....  104 personas   <-- el 54%
--      sin puesto asignado ..........  5
--
--  104 personas cuyo puesto no puede recibir una sola tarea automática, y 38
--  puestos con gente esperando documento (vendedor-rd 11, surtidor-zona 10,
--  promotora 6, chofer-cedis 6, auxiliar-chofer 6, auxiliar-encargado 5...).
--  Hasta hoy la única forma de darles tareas era que un desarrollador las
--  escribiera en `tareas-manual.catalogo.ts` y desplegara: el hallazgo 5 del
--  CLAUDE.md, «Capital Humano no puede operar su propio documento».
--
--  ─── POR QUÉ ESTO NO ROMPE «EL MANUAL NO SE EDITA» (§5.4) ─────────────────
--  El invariante dice que la norma SE VERSIONA, no que sea intocable. Lo que
--  prohíbe es editar en el sitio una norma ya emitida, porque entonces nadie
--  puede reconstruir con qué regla se juzgó un día pasado.
--
--  Aquí eso se respeta por estructura, no por disciplina:
--    · corregir una tarea NO actualiza su fila. Se inserta una fila NUEVA con
--      `reemplaza_a` apuntando a la anterior, y la anterior pasa a
--      `vigente = false`. Las dos quedan, con autor y fecha (§5.5).
--    · cada fila lleva su `version`, y el checklist emitido sella con cuál se
--      juzgó — igual que ya hacen `_manualVersion` y `_manualDocumento` para
--      el catálogo en código.
--  El catálogo en TypeScript NO se toca: sigue siendo la norma de los 19
--  puestos que ya tienen su documento publicado.
--
--  ═══════════════════════════════════════════════════════════════════════════
--   LOS CANDADOS VIVEN EN LA TABLA, NO EN EL ENDPOINT
--  ═══════════════════════════════════════════════════════════════════════════
--  Misma decisión que en la 057 con `tmp-%`, y por el mismo motivo: un candado
--  en el handler queda a merced del siguiente camino de escritura que alguien
--  abra (un script, una consulta a mano, un endpoint futuro). En SQL no.
--
--   1. `check (id like 'tp-%')` — UNA TAREA CAPTURADA NO PUEDE PISAR UNA
--      PUBLICADA. Los ids del catálogo tienen la forma `puestoId.slug`
--      ('anaquelista.pasillo'); con el prefijo obligatorio, la colisión es
--      imposible. Importa más de lo que parece: la llave de idempotencia de la
--      emisión es `man_<tareaId>_<periodo>_<sucursal>_<persona>`, así que dos
--      tareas con el mismo id producirían LA MISMA LLAVE y una pisaría a la
--      otra en silencio — la persona vería una sola y su denominador mentiría.
--
--   2. UNA SOLA TAREA VIGENTE CON EL MISMO NOMBRE POR PUESTO. Instrucción
--      expresa de David el mismo día: «revisa estrictamente que ninguna tarea
--      se repita». El índice es sobre `lower(trim(nombre))`, porque el duplicado
--      real no llega escrito idéntico: llega como «Apertura» contra «apertura »
--      — el hallazgo 1 (identidad por texto) entrando por esta puerta.
--      Es PARCIAL (`where vigente`) a propósito: las versiones retiradas tienen
--      que poder convivir con la nueva, o versionar sería imposible.
--
--   3. LA FRECUENCIA NO PUEDE QUEDAR A MEDIAS. Una tarea Semanal sin día y una
--      Mensual sin día del mes son tareas que NO SE EMITEN NUNCA, y eso se ve
--      igual que «esa persona no tiene nada que hacer». Los dos `check` obligan
--      a contestar la pregunta al capturar, que es cuando alguien sabe la
--      respuesta.
--
--   4. NO SE BORRAN (§5.5). Retirar es `vigente = false`. Los checklists ya
--      emitidos tienen que seguir teniendo a qué tarea apuntar.
--
--  ─── LO QUE ESTA MIGRACIÓN *NO* HACE, dicho para que no se lea de más ─────
--  NO entrega una sola tarea. La tabla nace VACÍA y el emisor todavía no la
--  lee: este paso crea el lugar donde escribir la norma y la pantalla para
--  hacerlo. Que lo capturado se entregue es el paso siguiente, con su propio
--  control negativo — porque ése sí mueve el denominador de 104 personas y no
--  puede viajar de contrabando con éste.
--
--  ─── REVERSA (§8.3) ───────────────────────────────────────────────────────
--    update mdtask_tareas_puesto set vigente = false;
--  Con eso la sección queda inerte sin que nadie pierda acceso ni tareas: la
--  tabla no la lee la emisión, y no toca `mdtask_usuarios`, `mdtask_checklists`
--  ni `mdtask_plazas`. Sin borrado físico.
--
--  DDL PURO. No siembra una sola fila: la norma la escribe Dirección, no una
--  migración (§8.5 — un puesto al que se le inventan tareas le entrega
--  obligaciones que no le tocan a una persona real).
-- ============================================================================

create table if not exists mdtask_tareas_puesto (
  -- Candado 1. El prefijo NO es convención: es restricción.
  id           text primary key check (id like 'tp-%'),

  -- Puede apuntar al catálogo publicado ('anaquelista') o a un puesto
  -- declarado ('tmp-...'). Sin llave foránea a propósito: el catálogo de
  -- puestos vive en TypeScript (hallazgo 5), así que esa integridad la
  -- comprueba la aplicación y NO se puede fingir aquí.
  puesto_id    text not null check (length(trim(puesto_id)) > 0),

  nombre       text not null check (length(trim(nombre)) > 0),

  -- Mismo vocabulario que `MomentoManual` y `FrecuenciaManual` del catálogo en
  -- código. Se restringe en SQL para que una tercera versión del vocabulario
  -- no pueda entrar por una ruta de escritura futura (§8.11 d).
  momento      text not null default 'operacion'
               check (momento in ('apertura','operacion','cierre','supervision','administrativo')),
  frecuencia   text not null default 'Diaria'
               check (frecuencia in ('Diaria','Semanal','Quincenal','Mensual')),

  dia_semana   text check (dia_semana is null or dia_semana in
               ('Lunes','Martes','Miércoles','Jueves','Viernes','Sábado')),
  dia_mes      integer check (dia_mes is null or (dia_mes between 1 and 31)),

  hora_limite  text not null default '23:59' check (hora_limite ~ '^[0-9]{2}:[0-9]{2}$'),

  -- De qué documento sale y con qué versión se juzga. `version` es NOT NULL
  -- porque un punto emitido sin saber con qué regla se juzgó no se puede
  -- auditar después (invariante §5.4), que es justo la prueba de fuego del §4.
  documento    text,
  version      text not null check (length(trim(version)) > 0),

  vigente      boolean not null default true,

  -- Candado 4 + §5.5: corregir es un evento NUEVO que apunta al anterior.
  reemplaza_a  text,

  creado_en    bigint,
  creado_por   text,
  motivo       text,

  -- Los puntos de control viven aquí, en `items`, igual que el patrón de tabla
  -- del §2 (columnas tipadas para lo buscable + `datos` jsonb para el resto).
  datos        jsonb not null default '{}'::jsonb,

  -- Candado 3: una frecuencia a medias es una tarea que no se emite nunca, y
  -- eso se ve idéntico a «esa persona no tiene nada que hacer».
  constraint mdtask_tareas_puesto_semanal_con_dia
    check (frecuencia <> 'Semanal' or dia_semana is not null),
  constraint mdtask_tareas_puesto_mensual_con_dia
    check (frecuencia <> 'Mensual' or dia_mes is not null)
);

-- Candado 2. Sobre `lower(trim(...))` porque el duplicado real no llega
-- escrito idéntico. Parcial para que las versiones retiradas convivan.
create unique index if not exists mdtask_tareas_puesto_uk_nombre_vigente
  on mdtask_tareas_puesto (puesto_id, lower(trim(nombre)))
  where vigente;

create index if not exists mdtask_tareas_puesto_ix_puesto
  on mdtask_tareas_puesto (puesto_id) where vigente;

-- ─── Reporte: sin esto una migración solo dice "aplicada" y no se audita ───
do $$
declare
  n_tareas  bigint;
  n_puestos bigint;
  n_vig     bigint;
begin
  select count(*)                  into n_tareas  from mdtask_tareas_puesto;
  select count(distinct puesto_id) into n_puestos from mdtask_tareas_puesto;
  select count(*)                  into n_vig     from mdtask_tareas_puesto where vigente;

  raise notice '060 · tareas de puesto: % filas (% vigentes) en % puesto(s)',
    n_tareas, n_vig, n_puestos;
  raise notice '060 · los ceros son el resultado ESPERADO en la primera corrida: la norma la escribe Direccion desde la pantalla, no la siembra una migracion';
end $$;
