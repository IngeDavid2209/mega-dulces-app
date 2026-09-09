-- ============================================================================
--  FASE 3 · PASO 3.1a — LA PLAZA COMO DATO
--
--  Hasta hoy la obligación se le entrega A UNA PERSONA: el robot recorre
--  `mdtask_usuarios`, lee su `puestoId` y su `datos.sucursales[]`, y escribe un
--  checklist con `assigned` = el NOMBRE en texto. Consecuencia medida: los
--  cinco anaquelistas de Canindo reciben la MISMA tarea y el sistema no puede
--  distinguir cuál de ellos la hizo, ni cuál pasillo cubre cada uno.
--
--  El invariante §5.1 dice que toda obligación pertenece a una PLAZA, nunca
--  directamente a una persona. Estas dos tablas son esa plaza:
--
--    mdtask_plazas      la posición, permanente. «Anaquelista · Canindo · 3».
--    mdtask_coberturas  quién la cubre y desde cuándo. La persona ROTA; la
--                       plaza no. Un hueco es una fila explícita, no la
--                       ausencia de filas (§5.2: la ausencia de datos no puede
--                       significar dos cosas distintas).
--
--  ─── ESTA MIGRACIÓN NO SIEMBRA NADA, Y ES A PROPÓSITO ─────────────────────
--  La primera versión sembraba aquí mismo, con un `insert ... select` sobre
--  `mdtask_usuarios`. Está mal por dos razones que solo se ven al escribirlo:
--
--   1. SQL no sabe resolver un puesto. `resolverPuesto()` (puesto.util.ts) tiene
--      DOS caminos: el `puestoId` explícito y, si falta, el `cargo` de texto
--      libre mapeado por los `aliasCargos` del catálogo. Un `insert` que solo
--      mire `datos->>'puestoId'` deja fuera a las fichas que hoy funcionan por
--      alias — y las deja fuera EN SILENCIO, que es el peor modo de fallo.
--      Sería una tercera versión de la regla, libre de discrepar de las otras
--      dos (§8.11 d: no reimplementes, usa la función real).
--
--   2. La `unidad` no está en la base. Vive en `organigrama.catalogo.ts`
--      (hallazgo 5). Copiar los 89 pares a un `VALUES` sería exactamente la
--      lista local que el §4 prohíbe: el organigrama cambia y la lista miente
--      sin avisar.
--
--  Por eso la siembra vive en `scripts/sembrar-plazas.js`, que COMPILA el
--  catálogo y llama a la función real. Esta migración solo crea la casa.
--  Beneficio secundario: el despliegue es DDL puro sobre tablas que nadie lee
--  todavía, o sea riesgo cero para las 186 personas que están trabajando.
--
--  ─── REVERSA ──────────────────────────────────────────────────────────────
--    drop table if exists mdtask_coberturas;
--    drop table if exists mdtask_plazas;
--  Es completa y sin pérdida: son tablas nuevas, derivadas, y nada apunta a
--  ellas. No hay dato original que restaurar. Va en una migración NUEVA — esta
--  no se edita una vez aplicada.
-- ============================================================================

-- ─── LA PLAZA ───────────────────────────────────────────────────────────────
create table if not exists mdtask_plazas (
  id          text primary key,        -- 'Canindo::anaquelista::2' — estable, no se renombra jamás (§2).
                                       -- El último segmento es un SLOT CORRELATIVO, y NO es el número de
                                       -- cuadrilla: solo distingue las N plazas de un mismo puesto y lugar para
                                       -- que la siembra sea idempotente. A qué persona le tocó el slot 2 es
                                       -- arbitrario y no significa nada. El número de verdad es la columna
                                       -- `numero`, nace NULL, y lo pone la Encargada (3.1b).
  puesto_id   text not null,           -- id de organigrama.catalogo.ts. NO hay FK: el catálogo es código (hallazgo 5)
  lugar       text not null,           -- sucursal/área tal como hoy vive en datos.sucursales[]. Sigue siendo texto
                                       -- a propósito: convertirlo en tabla es un paso posterior de la Fase 3, y
                                       -- adelantarlo acoplaría dos cambios que deben poder revertirse por separado
  numero      integer,                 -- NULL = la cuadrilla no se ha ordenado. Lo captura la Encargada (3.1b),
                                       -- nunca el sistema: el orden de la nómina es alfabético, o sea inventado
  unidad      text,                    -- derivada del catálogo por el sembrador. NULL = puesto que el catálogo
                                       -- no conoce; se deja visible en vez de rellenarse por parecido (§8.5)
  ambito      text,                    -- pasillo | caja | anaquel | ... — VACÍO HOY: ese inventario físico no
                                       -- existe en ningún dato. Es el paso 3.1c, y sin él «Anaquelista 1» todavía
                                       -- no dice qué pasillo cubre. La columna existe para que 3.1c no migre nada
  turno       text,                    -- VACÍO HOY por lo mismo. El horario vive en Mega Talento (solo lectura)
  vigente     boolean not null default true,   -- una plaza retirada se marca, no se borra (§5.5)
  creada_en   bigint,
  datos       jsonb                    -- origen de la siembra, motivo de retiro, etc.
);

-- OJO CON ESTE ÍNDICE, que en el primer borrador estaba MAL y habría hecho
-- imposible el caso que motiva todo el paso.
--
-- Iba como `unique (puesto_id, lugar, coalesce(numero, -1))`. Con `numero` NULL
-- en todas —que es justo el estado en que nacen— ese `coalesce` las colapsa a
-- todas en el mismo -1, así que de las CINCO plazas de anaquelista de Canindo
-- habría cabido UNA. El sembrador no habría reventado: habría insertado la
-- primera y chocado con las otras cuatro, o peor, se habrían leído como «solo
-- hay un anaquelista».
--
-- Lo correcto es un índice PARCIAL: la unicidad aplica cuando el número ya está
-- confirmado. Impide que existan dos «Anaquelista 2» en Canindo —que es el error
-- que sí importa— y deja convivir N plazas sin numerar mientras la Encargada no
-- ha ordenado su cuadrilla.
create unique index if not exists idx_mdtask_plazas_numero
  on mdtask_plazas (puesto_id, lugar, numero) where numero is not null;

create index if not exists idx_mdtask_plazas_lugar  on mdtask_plazas (lugar);
create index if not exists idx_mdtask_plazas_puesto on mdtask_plazas (puesto_id);

-- ─── QUIÉN LA CUBRE ─────────────────────────────────────────────────────────
create table if not exists mdtask_coberturas (
  id         text primary key,
  plaza_id   text not null,            -- mdtask_plazas.id
  uid        text,                     -- mdtask_usuarios.id. NULL SOLO cuando tipo='hueco'
  tipo       text not null,            -- 'titular' | 'suplencia' | 'hueco'
  desde      text not null,            -- 'YYYY-MM-DD' (mismo formato que mdtask_checklists.fecha)
  hasta      text,                     -- NULL = vigente. Cerrar una cobertura es ponerle fecha, no borrarla (§5.5)
  motivo     text,
  creada_en  bigint,
  datos      jsonb
);

-- Sin FK a propósito: `mdtask_usuarios` está en el mismo Postgres pero
-- COMPARTIDO con otras apps, y este repo tiene 0 FK en 36 tablas (hallazgo 1).
-- Meter la primera aquí, en tablas que nadie lee todavía, mezclaría el cambio
-- de modelo con un cambio de política de integridad. Va cuando la Fase 3 cierre.
create index if not exists idx_mdtask_coberturas_plaza on mdtask_coberturas (plaza_id);
create index if not exists idx_mdtask_coberturas_uid   on mdtask_coberturas (uid);

-- Una plaza no puede tener dos coberturas ABIERTAS a la vez: eso sería el
-- «no se sabe quién responde» que el §5.2 prohíbe. Índice parcial porque las
-- cerradas (con `hasta`) sí pueden ser muchas — son la historia.
create unique index if not exists idx_mdtask_coberturas_una_abierta
  on mdtask_coberturas (plaza_id) where hasta is null;

-- ─── REPORTE ────────────────────────────────────────────────────────────────
-- Una migración que solo dice «aplicada» no se puede auditar (§2). En la
-- primera corrida esto imprime 0 y 0, y ESO ES EL RESULTADO ESPERADO: la
-- siembra es un paso aparte que corre David. Si algún día imprime otra cosa en
-- una base nueva, es que alguien sembró antes de tiempo.
do $$
declare n_plazas bigint; n_cob bigint;
begin
  select count(*) into n_plazas from mdtask_plazas;
  select count(*) into n_cob    from mdtask_coberturas;
  raise notice '056 · plazas: % filas · coberturas: % filas (0 y 0 en la primera corrida: la siembra va aparte, con scripts/sembrar-plazas.js)', n_plazas, n_cob;
end $$;
