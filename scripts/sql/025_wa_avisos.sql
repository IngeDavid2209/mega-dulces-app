-- Bot de WhatsApp: bitacora de AVISOS ya enviados (idempotencia del poll).
--
-- El poll de api/tareas-notificar.js corre cada minuto y no debe repetir un
-- aviso si el proceso se reinicia o si dos ticks se solapan. Cada aviso se
-- identifica con una clave estable y se registra aqui ANTES de enviarse.
--
-- Claves usadas:
--   asig:<checklistId>           aviso inmediato de asignacion
--   resumen:<uid>:<YYYY-MM-DD>   resumen de la manana
--   limite:<checklistId>         recordatorio de hora limite
create table if not exists mdtask_wa_avisos (
  clave      text primary key,
  enviado_en bigint
);
