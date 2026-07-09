-- Migración a Postgres: hilo de conversación del BOT de WhatsApp (antes colección
-- `wa_conversaciones` en Firestore). Última pieza del bot que dependía de Firestore.
-- 1 fila por número (últimos 10 dígitos del teléfono). Prefijo mdtask_ (Postgres
-- compartido). El historial de mensajes de Claude va en `messages` jsonb.
create table if not exists mdtask_wa_conversaciones (
  id          text primary key,   -- últimos 10 dígitos del teléfono
  uid         text,               -- usuario identificado (mdtask_usuarios.id)
  actualizado bigint,             -- epoch ms del último mensaje (para el reset por inactividad)
  messages    jsonb               -- historial de mensajes (formato de la API de Claude)
);
