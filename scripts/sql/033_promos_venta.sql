-- VENTA DE PROMOS — el piso de venta, en vivo.
--
-- NO se mezcla con mdtask_promociones (el formato MKTN001). Aquella tabla es la
-- NEGOCIACION con el proveedor: folio, vigencia, presupuesto, firmas. Esta es
-- otra cosa y por eso vive aparte: la promo tal como la ve quien la vende y
-- quien la cobra, con su foto, su precio y nada mas.
--
-- Dos tablas, porque son dos ritmos distintos:
--
-- 1) mdtask_promos_venta   la promo. Se crea una vez y se consulta mucho.
-- 2) mdtask_promos_luzverde  cada aviso de la caja. Se escribe todo el dia y
--    NUNCA se actualiza: es una bitacora, no un contador. Un renglon por luz
--    verde, con quien y a que hora.
--
-- POR QUE BITACORA Y NO UN CONTADOR EN LA PROMO: si la caja sumara +1 a un
-- campo de la promo, dos cajas dando luz verde al mismo tiempo se pisarian el
-- numero (lectura-suma-escritura), y ademas se perderia lo unico que le importa
-- a quien monitorea: A QUE HORA y EN QUE SUCURSAL se movio. Los totales salen
-- de contar renglones, que ademas Postgres hace mejor que nosotros.

create table if not exists mdtask_promos_venta (
  id                text primary key,
  nombre            text not null,
  descripcion       text,
  costo             numeric(12,2),           -- lo que cuesta la promo al publico
  foto_url          text,                    -- la foto de la promo (Cloudinary)
  estado            text not null default 'activa',   -- 'activa' | 'pausada' | 'terminada'
  vigencia_del      text,                    -- YYYY-MM-DD, igual que los checklists
  vigencia_al       text,
  datos             jsonb not null default '{}'::jsonb,  -- sucursales[], foto{}, notas
  creado_en         bigint,
  creado_por        text,
  creado_por_nombre text,
  actualizado_en    bigint,
  eliminado         boolean not null default false
);

create index if not exists idx_promos_venta_estado on mdtask_promos_venta (estado)
  where eliminado = false;

-- La bitacora de luces verdes. `tipo` distingue las dos cosas que pidieron:
--   'asegurada'  el cliente ya se comprometio, todavia no paga.
--   'vendida'    ya se cobro.
-- Se guardan las DOS como renglones distintos a proposito: una asegurada que
-- despues se vende son dos hechos, y borrar el primero al llegar el segundo
-- taparia justo lo que quiere ver quien monitorea (cuanto de lo apartado se
-- acaba cerrando).
create table if not exists mdtask_promos_luzverde (
  id                text primary key,
  promo_id          text not null,
  sucursal          text not null,
  tipo              text not null default 'vendida',
  piezas            integer not null default 1,
  importe           numeric(12,2) not null default 0,
  nota              text,
  creado_en         bigint not null,
  creado_por        text,
  creado_por_nombre text,
  eliminado         boolean not null default false
);

-- El tablero del monitor siempre pregunta lo mismo: "que paso hoy, lo mas
-- reciente primero". Ese es el indice que importa.
create index if not exists idx_promos_lv_reciente
  on mdtask_promos_luzverde (creado_en desc) where eliminado = false;
create index if not exists idx_promos_lv_promo
  on mdtask_promos_luzverde (promo_id, creado_en desc) where eliminado = false;
create index if not exists idx_promos_lv_sucursal
  on mdtask_promos_luzverde (sucursal, creado_en desc) where eliminado = false;
