-- ============================================================================
--  BLOQUES DE TRABAJO — creacion de tareas por tramos de horario.
--
--  La idea: el dia se parte en BLOQUES (Mañana 07:00-11:00, Media mañana,
--  Tarde...), sin limite de cuantos. El HORARIO lo manda el bloque, y las tareas
--  que viven dentro lo heredan: asi no hay que ponerle hora a cada tarea, que es
--  de donde salian las horas incoherentes.
--
--  Tres tablas, cada una con un trabajo claro:
--
--  1) mdtask_bloques            -> el tramo y su horario. Nada mas.
--  2) mdtask_bloque_tareas      -> que se hace en ese bloque. Cada tarea puede ser
--                                  de UNA VEZ (con su fecha) o RUTINA (con su
--                                  frecuencia), igual que las tareas normales.
--  3) mdtask_bloque_asignaciones-> a quien le toca: sucursales + por rol o por
--                                  personas, con el mismo modelo que las
--                                  asignaciones de rutinas (SQL 011).
--
--  EJECUCION DEL DIA: el generador (api/bloques-generar.js) materializa cada
--  bloque asignado como un checklist normal en `mdtask_checklists`, con la hora
--  del bloque y las tareas que aplican ese dia. Se hace asi a proposito: el radar
--  del celular, el bot de WhatsApp, las estadisticas, el ranking y los reportes
--  ya leen esa tabla, y reimplementar la entrega de tareas (fotos, envio,
--  retrasos) en un carril paralelo seria empezar de cero y dejar la mitad de la
--  app ciega a estas tareas.
--
--  El checklist generado lleva `_bloqueId` en `datos`, para poder distinguirlo y
--  rastrearlo hasta el bloque que lo creo.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1) El bloque: un tramo de horario del dia
-- --------------------------------------------------------------------------
create table if not exists mdtask_bloques (
  id             text primary key,
  nombre         text,              -- "Mañana", "Media mañana", "Cierre"...
  hora_inicio    text,              -- 'HH:mm' (hora de Mexico)
  hora_fin       text,              -- 'HH:mm'; es la hora LIMITE de sus tareas
  orden          integer,           -- para pintarlos en el orden del dia
  color          text,              -- opcional, para distinguirlos de un vistazo
  activo         boolean not null default true,
  datos          jsonb not null default '{}'::jsonb,
  creado_en      bigint,
  creado_por     text,
  actualizado_en bigint,
  eliminado      boolean not null default false
);

create index if not exists idx_bloques_activo on mdtask_bloques (activo) where eliminado = false;
create index if not exists idx_bloques_orden on mdtask_bloques (orden);

-- --------------------------------------------------------------------------
-- 2) Las tareas de cada bloque
-- --------------------------------------------------------------------------
--  `tipo`: 'unica'  -> se hace una vez, en `fecha`
--          'rutina' -> se repite segun `frecuencia` (+ dias_semana / dia_mes)
--
--  Las frecuencias son las MISMAS que ya usa el resto de la app (Diaria, Semanal,
--  Catorcenal, Mensual, Trimestral, PorEvento), para no inventar un vocabulario
--  nuevo que despues nadie sepa mapear.
--
--  OJO: la tarea NO lleva hora. La hora es la del bloque. Eso es justo el motivo
--  de que exista este modulo.
create table if not exists mdtask_bloque_tareas (
  id             text primary key,
  bloque_id      text not null,
  texto          text,
  orden          integer,
  tipo           text not null default 'rutina',   -- 'unica' | 'rutina'
  fecha          text,              -- YYYY-MM-DD, solo si tipo = 'unica'
  frecuencia     text,              -- solo si tipo = 'rutina'
  dias_semana    jsonb not null default '[]'::jsonb,  -- ["Lunes","Miércoles"]
  dia_mes        integer,           -- 1-31 para Mensual/Trimestral
  requiere_foto  boolean not null default false,
  activo         boolean not null default true,
  datos          jsonb not null default '{}'::jsonb, -- requiereAntesDespues, variasFotos, tiempoEstimado...
  creado_en      bigint,
  creado_por     text,
  actualizado_en bigint,
  eliminado      boolean not null default false
);

create index if not exists idx_bloque_tareas_bloque on mdtask_bloque_tareas (bloque_id) where eliminado = false;
create index if not exists idx_bloque_tareas_fecha on mdtask_bloque_tareas (fecha);

-- --------------------------------------------------------------------------
-- 3) A quien le toca cada bloque (mismo modelo que las rutinas)
-- --------------------------------------------------------------------------
create table if not exists mdtask_bloque_asignaciones (
  id             text primary key,
  bloque_id      text not null,
  sucursales     jsonb not null default '[]'::jsonb,   -- ["Morelia Madero", ...]
  modo           text not null default 'porRol',       -- 'porRol' | 'porPersonas'
  rol_objetivo   text,                                  -- si modo = porRol
  personas       jsonb not null default '[]'::jsonb,   -- uids, si modo = porPersonas
  fecha_inicio   text,              -- vigencia (YYYY-MM-DD), opcional
  fecha_fin      text,
  activa         boolean not null default true,
  datos          jsonb not null default '{}'::jsonb,
  creado_en      bigint,
  creado_por     text,
  actualizado_en bigint,
  eliminado      boolean not null default false
);

create index if not exists idx_bloque_asig_bloque on mdtask_bloque_asignaciones (bloque_id) where eliminado = false;
create index if not exists idx_bloque_asig_activa on mdtask_bloque_asignaciones (activa) where eliminado = false;
