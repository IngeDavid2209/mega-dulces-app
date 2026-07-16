-- Modulo FLOTILLA: reservas / itinerario de vehiculos.
-- Cada fila es un "apartado" de un vehiculo en un rango de horas:
--   desde / hasta  -> epoch en milisegundos (bigint), como el resto de la app.
--   estatus        -> 'pendiente' | 'aprobada' | 'rechazada' | 'cancelada'
-- El flujo es con AUTORIZACION: nace 'pendiente' y un admin la aprueba/rechaza.
-- El resto de campos (destino, motivo, nombre del solicitante, sucursal,
-- aprobadoPor, kilometraje, fotos, etc.) van en `datos` (jsonb).
--
-- Las columnas vehiculo_id / estatus / desde / hasta se sacan aparte porque el
-- endpoint las necesita para la REGLA ANTI-CHOQUE (buscar traslapes) y para el
-- itinerario por rango de fechas.
create table if not exists reservas_vehiculos (
  id          text primary key,
  vehiculo_id text,
  usuario_uid text,
  desde       bigint,
  hasta       bigint,
  estatus     text,
  datos       jsonb
);

create index if not exists idx_reservas_veh_vehiculo on reservas_vehiculos (vehiculo_id);
create index if not exists idx_reservas_veh_estatus on reservas_vehiculos (estatus);
create index if not exists idx_reservas_veh_rango on reservas_vehiculos (desde, hasta);
create index if not exists idx_reservas_veh_usuario on reservas_vehiculos (usuario_uid);
