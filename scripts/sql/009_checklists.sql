-- Migración a Postgres: colección `checklists` (Etapa 3 FERROCARRIL).
-- Es el MAYOR lector de Firestore de la app (radar de checklist, home, reportes,
-- estadísticas, calendario, ranking, checkstore, etc.). Migrarla corta de raíz
-- el consumo diario de cuota. Prefijo `mdtask_` porque el Postgres es COMPARTIDO.
-- Patrón del proyecto: columnas buscables + `datos` jsonb para el resto del doc.
create table if not exists mdtask_checklists (
  id                   text primary key,       -- doc.id de Firestore (numérico o string; se guarda como texto)
  name                 text,
  assigned             text,                   -- nombre del empleado asignado
  assigned_uid         text,                   -- uid (solo lo traen los checklists de Robot V2)
  store                text,                   -- sucursal; valor especial 'MANTENIMIENTO'
  fecha                text,                   -- 'YYYY-MM-DD'; campo clave de casi todas las queries (where date >= ..)
  hora                 text,                   -- 'HH:mm' (default '23:59' en el front)
  status               text,                   -- 'pendiente' | 'completo'
  enviado              boolean default false,  -- controla el historial de enviadas
  eliminado            boolean default false,  -- soft-delete
  archivado            boolean default false,  -- cierre mensual
  origen_tec           boolean default false,  -- asignada por el Espacio TEC (query where origenTec == true)
  entrega_con_retraso  boolean default false,  -- query de estadísticas (where entregaConRetraso == true)
  created_by           text,
  timestamp_creacion   bigint,                 -- epoch ms
  asignacion_id        text,                   -- _asignacionId (Robot V2; query where _asignacionId == ..)
  catalogo_rutina_id   text,                   -- _catalogoRutinaId (Robot V2; query where _catalogoRutinaId == ..)
  datos                jsonb                   -- items[], subtareas[], mantenimiento, notaEmpleado, vistoPor/vistoTimestamp, fechaInicio/fechaFin, esTareaPropia, origenTec, frecuencia, flags de cierre (archivadoEn/fotosBorradas...), _v2, _rutinaPersonalId...
);

-- `fecha` es el filtro dominante (rango por día). Los flags booleanos y los ids
-- de rutina/asignación se consultan en igualdad puntual.
create index if not exists idx_mdtask_checklists_fecha          on mdtask_checklists (fecha);
create index if not exists idx_mdtask_checklists_origen_tec      on mdtask_checklists (origen_tec) where origen_tec = true;
create index if not exists idx_mdtask_checklists_asignacion      on mdtask_checklists (asignacion_id);
create index if not exists idx_mdtask_checklists_catalogo        on mdtask_checklists (catalogo_rutina_id);
create index if not exists idx_mdtask_checklists_entrega_retraso on mdtask_checklists (entrega_con_retraso) where entrega_con_retraso = true;
