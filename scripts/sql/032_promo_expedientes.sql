-- Expedientes de una promocion (protocolo de seguimiento del MKTN001).
--
-- Una promocion ya negociada no termina cuando se firma el formato: hay que
-- probar que se ejecuto en cada canal donde se autorizo. Este expediente es esa
-- prueba, y lleva TRES secciones de evidencia:
--
--   1) salida     -> el ticket o el formato con el que se le dio salida a la
--                    mercancia del CEDIS.
--   2) exhibicion -> la foto del producto puesto donde debe estar (y el combo
--                    ya armado, cuando la promocion es de combo).
--   3) ventas     -> las fotos de los tickets de venta. De cada foto se saca el
--                    importe (lo lee la IA, lo confirma una persona) y las
--                    piezas, y de ahi salen el KPI y el ranking.
--
-- UNA FILA POR PROMOCION + CANAL. El canal se guarda con el nombre EXACTO con
-- el que viene en el formato ('PH', 'ALP', 'Zam. Centro', 'Mayoreo'...), no con
-- el de las sucursales del sistema: el expediente existe porque el formato
-- marco ese canal, y los nombres del papel no coinciden con el catalogo. Solo
-- se abre expediente de los canales que la promocion tiene marcados.
--
-- POR QUE LOS TOTALES VAN EN COLUMNAS Y NO SOLO EN `datos`: el ranking suma y
-- ordena piezas e importes de todas las promociones. Con los totales dentro del
-- jsonb habria que leer y sumar en Node cada expediente para armar la tabla;
-- en columnas lo hace Postgres de un tiro. Los recalcula el backend cada vez
-- que se toca una venta, nunca el cliente.

create table if not exists mdtask_promo_expedientes (
  id             text primary key,        -- exp_<promoId>_<slug del canal>
  promo_id       text not null,
  canal          text not null,           -- el nombre tal cual sale en el formato
  estado         text,                    -- 'pendiente' | 'completo'
  piezas_total   integer not null default 0,
  importe_total  numeric(14,2) not null default 0,
  ventas_total   integer not null default 0,   -- cuantos tickets se subieron
  -- salida[], exhibicion[], ventas[] y notas. Las evidencias son el mismo
  -- objeto que ya usa el paso 2 de la promocion (url de Cloudinary, nombre,
  -- tipo, peso, quien y cuando).
  datos          jsonb not null default '{}'::jsonb,
  creado_en      bigint,
  creado_por     text,
  actualizado_en bigint,
  eliminado      boolean not null default false
);

-- Un solo expediente por promocion y canal. Es lo que permite guardar con un id
-- determinista (upsert) y no duplicar si dos personas suben evidencia a la vez.
create unique index if not exists idx_promo_exp_promo_canal
  on mdtask_promo_expedientes (promo_id, canal) where eliminado = false;

create index if not exists idx_promo_exp_promo on mdtask_promo_expedientes (promo_id)
  where eliminado = false;
-- Para el ranking: ordenar por piezas sin leer el jsonb.
create index if not exists idx_promo_exp_piezas on mdtask_promo_expedientes (piezas_total desc)
  where eliminado = false;
create index if not exists idx_promo_exp_canal on mdtask_promo_expedientes (canal)
  where eliminado = false;
