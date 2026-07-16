-- Modulo FLOTILLA: catalogo de vehiculos de la empresa.
-- Un vehiculo tiene nombre (ej. "Nissan NP300 blanca"), sucursal a la que
-- pertenece y estatus activo. El resto de campos (placa, foto, notas) van en
-- `datos` (jsonb), igual que el resto de tablas migradas. `nombre` y `sucursal`
-- se sacan como columnas para poder ordenar/filtrar.
create table if not exists vehiculos (
  id       text primary key,
  nombre   text,
  sucursal text,
  activo   boolean default true,
  datos    jsonb
);

create index if not exists idx_vehiculos_sucursal on vehiculos (sucursal);
create index if not exists idx_vehiculos_activo on vehiculos (activo);
