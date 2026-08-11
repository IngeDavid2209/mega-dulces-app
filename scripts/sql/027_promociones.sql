-- Activacion de promociones (formato MKTN001 "Apoyo para Sell Out").
--
-- Dos tablas:
--
-- 1) mdtask_promo_proveedores: el catalogo de proveedores/marcas. Se va llenando
--    solo: cada nombre nuevo que alguien escribe en el paso 1 queda guardado, y
--    a partir de ahi se sugiere. `clave` guarda el nombre normalizado (sin
--    acentos, minusculas) y es la llave primaria, para que "Canels", "canels" y
--    "CANELS" NO se conviertan en tres proveedores distintos.
--
-- 2) mdtask_promociones: una fila por promocion. Los campos del encabezado que
--    se buscan y ordenan van en columnas propias; el resto del formato (canales
--    marcados, codigos, distribucion por canal, evidencias) vive en `datos`
--    jsonb, igual que el resto de la app, para no tener que migrar la tabla cada
--    vez que el formato cambie una casilla.
--
-- El folio es un ENTERO con indice unico: el formato lo imprime con ceros a la
-- izquierda (0740), pero guardarlo como texto haria que 0741 < 0800 < 0900 se
-- ordenaran mal y que el siguiente folio fuera imposible de calcular.

create table if not exists mdtask_promo_proveedores (
  clave       text primary key,          -- nombre normalizado
  nombre      text not null,             -- como se escribio la primera vez
  usos        integer not null default 1,
  creado_en   bigint,
  creado_por  text,
  ultimo_uso  bigint
);

create table if not exists mdtask_promociones (
  id                 text primary key,
  folio              integer,
  estado             text,               -- 'paso1' | 'paso2' | 'paso3' | 'cerrada'
  proveedor          text,
  proveedor_clave    text,
  agente_ventas      text,
  fecha_negociacion  text,               -- YYYY-MM-DD, igual que los checklists
  periodo            text,
  vigencia_del       text,
  vigencia_al        text,               -- admite texto ("Agotar Producto Asignado")
  monto              numeric(14,2),
  datos              jsonb not null default '{}'::jsonb,
  creado_en          bigint,
  creado_por         text,
  actualizado_en     bigint,
  eliminado          boolean not null default false
);

create unique index if not exists idx_promociones_folio
  on mdtask_promociones (folio) where folio is not null;

create index if not exists idx_promociones_estado on mdtask_promociones (estado);
create index if not exists idx_promociones_proveedor on mdtask_promociones (proveedor_clave);
create index if not exists idx_promociones_fecha on mdtask_promociones (fecha_negociacion);
