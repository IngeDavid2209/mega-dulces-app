-- ============================================================================
--  TICKETS / VALE DE SERVICIO OPERATIVO.
--
--  Digitaliza el formato en papel del mismo nombre: alguien LEVANTA un ticket
--  (necesito que me arreglen algo), un responsable lo ATIENDE, y al terminar se
--  documenta que se hizo, con que materiales y con las tres firmas del formato.
--
--  Ciclo de vida en `estatus`:
--    'abierto'     -> se levanto, nadie lo ha tomado
--    'en_proceso'  -> alguien lo esta atendiendo (el formato tiene esta casilla)
--    'completado'  -> se termino y se documento el servicio (la otra casilla)
--    'cancelado'   -> ya no se va a hacer (queda el registro y el motivo)
--
--  El FOLIO es un entero con indice unico. El formato lo imprime con ceros a la
--  izquierda (000513), pero guardarlo como texto haria que 0514 < 0600 < 0900 se
--  ordenaran mal y que calcular el siguiente fuera imposible. Mismo criterio que
--  el folio de las promociones (SQL 027).
--
--  Las tres firmas y los campos largos del formato viven en `datos` jsonb: son
--  para leer y para imprimir, no para filtrar ni ordenar, y asi el formato puede
--  crecer sin migrar la tabla cada vez que se le agregue una casilla.
--
--  El borrado es LOGICO: un vale es el respaldo de un trabajo hecho y de quien
--  lo firmo; si alguien se equivoca al borrar, se recupera.
-- ============================================================================
create table if not exists mdtask_tickets (
  id                  text primary key,
  folio               integer,
  estatus             text not null default 'abierto',

  -- Encabezado del formato
  fecha               text,            -- YYYY-MM-DD (igual que los checklists)
  area                text,            -- AREA / DEPARTAMENTO que solicita
  lugar               text,            -- LUGAR / SUCURSAL / AREA
  solicitante         text,            -- nombre de quien solicita
  solicitante_uid     text,            -- usuario que lo levanto
  responsable         text,            -- RESPONSABLE DEL SERVICIO (nombre)
  responsable_uid     text,
  supervisor          text,            -- SUPERVISOR / JEFE INMEDIATO
  supervisor_uid      text,

  -- Informacion del servicio realizado
  actividad           text,            -- ACTIVIDAD / SERVICIO REALIZADO
  requiere_seguimiento boolean,        -- ¿REQUIERE SEGUIMIENTO? si/no

  -- Fechas de control del ciclo
  tomado_en           bigint,          -- cuando paso a 'en_proceso'
  completado_en       bigint,          -- cuando paso a 'completado'

  datos               jsonb not null default '{}'::jsonb,
  creado_en           bigint,
  creado_por          text,
  actualizado_en      bigint,
  eliminado           boolean not null default false
);

-- Un folio no se puede repetir: es el numero del vale.
create unique index if not exists idx_tickets_folio
  on mdtask_tickets (folio) where folio is not null;

create index if not exists idx_tickets_estatus on mdtask_tickets (estatus) where eliminado = false;
create index if not exists idx_tickets_area on mdtask_tickets (area);
create index if not exists idx_tickets_fecha on mdtask_tickets (fecha);
create index if not exists idx_tickets_solicitante on mdtask_tickets (solicitante_uid);
create index if not exists idx_tickets_responsable on mdtask_tickets (responsable_uid);
