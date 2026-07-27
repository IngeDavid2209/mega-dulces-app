-- Alta inicial del catalogo de vehiculos (modulo FLOTILLA).
-- Corre UNA sola vez (el runner registra el archivo en _migraciones), asi que no
-- se re-insertan en futuros deploys ni pelea con borrados hechos desde la app.
-- Sucursal vacia = vehiculos "generales / compartidos" (aparecen en el filtro
-- "Todas" del itinerario). Se pueden reasignar despues en la pestana Vehiculos.
insert into vehiculos (id, nombre, sucursal, activo, datos) values
  ('veh-jetta',  'Jetta',   '', true, '{}'::jsonb),
  ('veh-ram700', 'Ram 700', '', true, '{}'::jsonb),
  ('veh-toyota', 'Toyota',  '', true, '{}'::jsonb)
on conflict (id) do nothing;
