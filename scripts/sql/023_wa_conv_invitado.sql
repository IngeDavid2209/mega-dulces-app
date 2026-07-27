-- FLOTILLA/BOT: identidad de INVITADO para números NO registrados en MD Task.
-- Cuando un número desconocido escribe, el bot le pide nombre y apellido y lo
-- guarda aquí (no crea usuario). Con eso lo atiende como invitado SOLO para
-- vehículos. Vive en el mismo hilo de conversación (1 fila por número).
alter table mdtask_wa_conversaciones add column if not exists invitado jsonb;
