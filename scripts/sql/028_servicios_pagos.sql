-- ============================================================================
--  PAGOS DE SERVICIOS (luz, agua, internet, gas, renta...) por sucursal.
--
--  El problema que resuelve: los recibos se vencen porque nadie recuerda
--  pagarlos y, cuando se pagan, el comprobante se queda en el celular de quien
--  fue a pagar. Aqui el sistema recuerda solo por WhatsApp, recibe la foto o el
--  PDF del comprobante por el mismo chat, y todo queda en un tablero por
--  sucursal.
--
--  Tres tablas:
--
--  1) mdtask_servicios: el CATALOGO. Una fila por servicio contratado
--     ("Morelia Madero / Luz / CFE / dia 15 / cada mes"). Se da de alta UNA vez
--     y de ahi el sistema genera solo el pago de cada periodo.
--
--  2) mdtask_pagos_servicios: un PAGO por periodo. Es lo que se recuerda, se
--     paga y se comprueba. La llave (servicio_id, periodo) es unica para que el
--     generador pueda correr cada rato sin duplicar nada, igual que la bitacora
--     de mdtask_wa_avisos (SQL 025).
--
--  3) mdtask_pagos_espera: el hilo del bot. Guarda en que paso va la persona
--     que esta reportando un pago por WhatsApp (elegir cual, decir el monto).
--     Es aparte del estado de fotos de TAREAS (mdtask_wa_conversaciones.esperando)
--     a proposito: son dos conversaciones distintas y mezclarlas haria que una
--     foto de evidencia se guardara como comprobante de la luz.
--
--  El borrado de servicios y pagos es LOGICO (`eliminado`), mismo criterio que
--  las promociones (SQL 027): un pago trae dinero y comprobante fiscal; si
--  alguien se equivoca al borrar, se recupera.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1) Catalogo de servicios contratados
-- --------------------------------------------------------------------------
create table if not exists mdtask_servicios (
  id                  text primary key,
  sucursal            text,              -- "Morelia Madero" (o el departamento)
  departamento        text,              -- opcional, cuando no es una sucursal
  tipo                text,              -- 'luz' | 'agua' | 'internet' | 'gas' | 'telefono' | 'renta' | 'otro'
  proveedor           text,              -- CFE, Telmex, Totalplay...
  referencia          text,              -- numero de servicio / medidor / contrato
  periodicidad        text,              -- 'mensual' | 'bimestral'
  -- Solo para los BIMESTRALES (la luz de CFE): mes YYYY-MM de un vencimiento
  -- conocido. A partir de ahi el generador sabe que los recibos caen de dos en
  -- dos meses. Sin este ancla no habria forma de distinguir si a un servicio
  -- bimestral le toca pagar en julio o en agosto.
  mes_ancla           text,
  dia_limite          integer,           -- dia del mes en que vence (1-31)
  dias_aviso          integer,           -- cuantos dias antes empieza a avisar
  monto_estimado      numeric(14,2),     -- referencia de cuanto suele llegar
  responsable_uid     text,              -- usuario de MD Task que paga
  responsable_nombre  text,              -- copia para no perderla si se borra el usuario
  responsable_telefono text,             -- 10 digitos; por aqui llega el aviso
  activo              boolean not null default true,
  datos               jsonb not null default '{}'::jsonb,
  creado_en           bigint,
  creado_por          text,
  actualizado_en      bigint,
  eliminado           boolean not null default false
);

create index if not exists idx_servicios_sucursal on mdtask_servicios (sucursal);
create index if not exists idx_servicios_activo on mdtask_servicios (activo) where eliminado = false;

-- --------------------------------------------------------------------------
-- 2) Pagos: una fila por servicio y periodo
-- --------------------------------------------------------------------------
--  `periodo` es texto YYYY-MM (el mes que ampara el recibo). En los servicios
--  bimestrales se usa el mes en que vence; el rango legible queda en
--  `periodo_texto` ("Jul-Ago 2026") para no tener que recalcularlo al mostrar.
--
--  `estado`: 'pendiente' (aun no se paga) | 'pagado' | 'cancelado'. El
--  "vencido" NO se guarda: se deduce comparando fecha_limite contra hoy, para
--  que no exista el riesgo de una fila que diga "al corriente" solo porque
--  nadie corrio el proceso que la marcaba.
create table if not exists mdtask_pagos_servicios (
  id                text primary key,
  servicio_id       text not null,
  sucursal          text,               -- copia del servicio: el tablero filtra por aqui
  tipo              text,               -- copia del servicio
  periodo           text,               -- YYYY-MM
  periodo_texto     text,               -- "Julio 2026" / "Jul-Ago 2026"
  fecha_limite      text,               -- YYYY-MM-DD (mismo formato que los checklists)
  estado            text not null default 'pendiente',
  monto             numeric(14,2),      -- lo que realmente se pago
  forma_pago        text,               -- 'efectivo' | 'tarjeta' | 'transferencia'
  pagado_en         bigint,             -- cuando se registro el pago
  comprobante_url   text,               -- foto o PDF en Cloudinary
  comprobante_tipo  text,               -- 'imagen' | 'documento'
  registrado_por    text,               -- uid o nombre de quien lo reporto
  canal             text,               -- 'whatsapp' | 'app'
  avisos            jsonb not null default '{}'::jsonb,  -- bitacora del bot (ver pagos-notificar)
  datos             jsonb not null default '{}'::jsonb,
  creado_en         bigint,
  actualizado_en    bigint,
  eliminado         boolean not null default false
);

-- Idempotencia del generador: un servicio no puede tener dos pagos del mismo
-- periodo. Sin esto, cada arranque del servidor crearia una fila repetida.
create unique index if not exists idx_pagos_servicio_periodo
  on mdtask_pagos_servicios (servicio_id, periodo);

create index if not exists idx_pagos_estado on mdtask_pagos_servicios (estado) where eliminado = false;
create index if not exists idx_pagos_limite on mdtask_pagos_servicios (fecha_limite);
create index if not exists idx_pagos_sucursal on mdtask_pagos_servicios (sucursal);

-- --------------------------------------------------------------------------
-- 3) Hilo del bot: en que paso va quien esta reportando un pago
-- --------------------------------------------------------------------------
--  `paso`: 'elegir'  -> mando comprobante y tiene varios pagos abiertos
--          'monto'   -> ya se guardo el comprobante, falta cuanto y como pago
--          'comprobante' -> dijo que ya pago, falta que mande la foto
create table if not exists mdtask_pagos_espera (
  telefono       text primary key,   -- ultimos 10 digitos
  pago_id        text,
  paso           text,
  datos          jsonb not null default '{}'::jsonb,
  actualizado_en bigint
);
