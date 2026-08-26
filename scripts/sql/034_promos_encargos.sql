-- ENCARGOS: lo que el vendedor le avisa a la caja ANTES de que llegue el cliente.
--
-- Hasta aqui el circuito estaba cojo: la cajera reportaba la venta cuando ya
-- habia pasado, sin saber que venia. Ahora el vendedor, cuando cierra el trato
-- en el piso, manda el encargo: "Juan Perez lleva 3 del combo". Le aparece a la
-- caja de esa sucursal, y cuando el cliente llega, la cajera CONFIRMA que si se
-- las llevo (o cancela si no).
--
-- Al confirmar se genera la luz verde en mdtask_promos_luzverde, que es lo que
-- alimenta el tablero. Por eso `luz_id` guarda cual: sin ese hilo no se podria
-- deshacer una confirmacion sin dejar la luz verde huerfana contando de mas.
--
-- POR QUE TABLA APARTE Y NO UN ESTADO EN LA LUZ VERDE: son dos hechos
-- distintos con dos vidas distintas. La luz verde es una bitacora que no se
-- toca una vez escrita; el encargo NACE pendiente y cambia (se confirma, se
-- cancela, se queda colgado). Meterlos juntos obligaria a filtrar por estado en
-- cada suma del tablero, y bastaria olvidarlo una vez para contar como vendido
-- algo que el cliente nunca se llevo.

create table if not exists mdtask_promos_encargos (
  id                  text primary key,
  promo_id            text not null,
  sucursal            text not null,
  piezas              integer not null default 1,
  cliente             text,                    -- el nombre con que la caja lo reconoce
  estado              text not null default 'pendiente',  -- 'pendiente' | 'confirmado' | 'cancelado'
  nota                text,
  -- Quien lo mando (el vendedor, en el piso)
  creado_en           bigint not null,
  creado_por          text,
  creado_por_nombre   text,
  -- Quien lo resolvio (la cajera, en el mostrador)
  resuelto_en         bigint,
  resuelto_por        text,
  resuelto_por_nombre text,
  motivo              text,                    -- por que se cancelo, si se cancelo
  luz_id              text,                    -- la luz verde que genero al confirmarse
  eliminado           boolean not null default false
);

-- La consulta de la caja es siempre la misma: "que tengo pendiente aqui, lo mas
-- viejo primero" (lo mas viejo primero porque es el cliente que lleva mas rato
-- esperando, no el que acaba de llegar).
create index if not exists idx_promos_enc_pendientes
  on mdtask_promos_encargos (sucursal, estado, creado_en asc)
  where eliminado = false;

create index if not exists idx_promos_enc_promo
  on mdtask_promos_encargos (promo_id, creado_en desc) where eliminado = false;

-- Para que el vendedor vea como le fue a lo que mando.
create index if not exists idx_promos_enc_vendedor
  on mdtask_promos_encargos (creado_por, creado_en desc) where eliminado = false;
