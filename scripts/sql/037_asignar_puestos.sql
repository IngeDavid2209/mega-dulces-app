-- ============================================================================
--  ASIGNAR PUESTOS DEL ORGANIGRAMA A LA PLANTILLA
--  Pedido por David el 2026-08-28.
--
--  Fija `datos.puestoId` de cada persona a partir de la Lista de Raya del
--  periodo 35, ya traducida al Organigrama 2026. Sin esto, el robot depende de
--  que el `cargo` de texto libre coincida con un alias: funciona para muchos,
--  pero alguien reescribe un cargo y esa persona deja de recibir en silencio.
--
--  ─── EL CRUCE DE NOMBRES, Y POR QUE ES CONSERVADOR ────────────────────────
--  La nomina escribe APELLIDOS NOMBRES y la app escribe Nombre Apellidos, asi
--  que no hay texto igual que comparar: se comparan CONJUNTOS DE PALABRAS.
--  "Miriam Carrillo" comparte {miriam, carrillo} con "CARRILLO CONTRERAS MIRIAM
--  JAZMIN" y eso alcanza para reconocerla.
--
--  Pero dos palabras en comun pueden ser coincidencia. Por eso solo se asigna
--  cuando el mejor candidato GANA CON VENTAJA sobre el segundo. Un empate no se
--  resuelve: se deja sin tocar. Adivinar le cambiaria el puesto —y por lo tanto
--  las tareas del manual— a la persona equivocada.
--
--  Tampoco se asigna si dos filas de la nomina apuntan al mismo usuario
--  (homonimos): ninguna de las dos gana, porque la segunda pisaria a la primera.
--
--  ─── QUE NO TOCA ──────────────────────────────────────────────────────────
--   . Usuarios inactivos.
--   . Quien ya tenga un puestoId capturado a mano: se respeta.
--   . `sucursales`: SOLO se llena a quien no tiene ninguna. Sobrescribirla le
--     cambiaria a alguien lo que puede ver, y el centro de costo de la nomina no
--     es lo mismo que su sucursal operativa.
--
--  ─── PARA DESHACER ────────────────────────────────────────────────────────
--    update mdtask_usuarios
--       set datos = datos - 'puestoId'
--     where datos->>'_puestoAsignadoEn' = '2026-08-28';
--
--  El resumen de lo que movio queda en mdtask_asignacion_puestos_log.
-- ============================================================================

create table if not exists mdtask_asignacion_puestos_log (
  sello       text primary key,
  aplicado_en bigint,
  resumen     jsonb
);

-- Deja el nombre comparable: sin tildes, en minusculas y sin puntuacion.
create or replace function mdtask_tokens_nombre(t text)
returns text[] language sql immutable as $fn$
  select array(
    select w from unnest(string_to_array(
      regexp_replace(
        lower(translate(coalesce(t, ''),
          'ÁÉÍÓÚÜÑáéíóúüñÀÈÌÒÙàèìòù',
          'AEIOUUNaeiouunAEIOUaeiou')),
        '[^a-z0-9ñ ]', ' ', 'g'), ' ')) as w
    -- Palabras de 3+ letras, sin particulas que no distinguen a nadie.
    where length(w) >= 3
      and w not in ('de','del','las','los','san','santa')
  );
$fn$;

do $$
declare
  v_sello    text   := '2026-08-28';
  n_asignados bigint := 0;
  n_sucursal  bigint := 0;
  n_ambiguo   bigint := 0;
  n_sinmatch  bigint := 0;
  n_yatenian  bigint := 0;
begin

  -- ── La nomina, ya traducida al organigrama ──────────────────────────────
  create temporary table tmp_nomina (
    nombre   text,
    puesto   text,
    cargo    text,
    sucursal text
  ) on commit drop;

  insert into tmp_nomina (nombre, puesto, cargo, sucursal) values
    ('CARRILLO CONTRERAS MIRIAM JAZMIN', 'cajero-sucursal', 'Cajero(a) de Sucursal', '8 Esquinas'),
    ('NAVA TAFOYA MARIA DEL PILAR', 'promotora', 'Promotora', '8 Esquinas'),
    ('HERREJON MOLINA ROSARIO', 'cajero-sucursal', 'Cajero(a) de Sucursal', '8 Esquinas'),
    ('GOMEZ ZARATE YAZMIN SARAI', 'auxiliar-encargado', 'Auxiliar de Encargado', '8 Esquinas'),
    ('HERNANDEZ CHAVEZ LUIS ANGEL', 'almacenista-sucursal', 'Almacenista de Sucursal', '8 Esquinas'),
    ('MUÑOZ VENTURA ANGELICA MARIA', 'cajero-sucursal', 'Cajero(a) de Sucursal', '8 Esquinas'),
    ('BERMUDEZ HERRERA HECTOR', 'anaquelista', 'Anaquelista de Sucursal', '8 Esquinas'),
    ('CALLEJAS VACA LUIS FERNANDO', 'anaquelista', 'Anaquelista de Sucursal', '8 Esquinas'),
    ('VALADEZ MENDEZ JUANA', 'anaquelista', 'Anaquelista de Sucursal', '8 Esquinas'),
    ('ESPITIA VACA FERNANDO', 'anaquelista', 'Anaquelista de Sucursal', '8 Esquinas'),
    ('HERNANDEZ VILLANUEVA CLAUDIA GABRIELA', 'anaquelista', 'Anaquelista de Sucursal', '8 Esquinas'),
    ('MELGOZA ASCENCIO GUSTAVO ALEJANDRO', 'cajero-sucursal', 'Cajero(a) de Sucursal', 'La Piedad Abastos'),
    ('PALOMINO MEJIA MARIA SILVIA', 'anaquelista', 'Anaquelista de Sucursal', 'La Piedad Abastos'),
    ('NAVARRO ALVARADO LUIS DAVID', 'almacenista-sucursal', 'Almacenista de Sucursal', 'La Piedad Abastos'),
    ('PLASCENCIA BRAVO PAULINA MICHELLE', 'vendedor-vecinal', 'Vendedor Vecinal', 'La Piedad Abastos'),
    ('ALATORRE RUEDA DULCE MARIA', 'auxiliar-encargado', 'Auxiliar de Encargado', 'La Piedad Abastos'),
    ('VENEGAS ESTRADA DIANA ESTEFANIA', 'cajero-sucursal', 'Cajero(a) de Sucursal', 'La Piedad Abastos'),
    ('CABELLO RUIZ JOSE ARTURO', 'anaquelista', 'Anaquelista de Sucursal', 'La Piedad Abastos'),
    ('DURAN RIOS MARINA ISABEL', 'cajero-sucursal', 'Cajero(a) de Sucursal', 'La Piedad Abastos'),
    ('FLORES MARTINEZ ELIZABETH', 'cajero-sucursal', 'Cajero(a) de Sucursal', 'Morelia Abastos'),
    ('RUIZ CRUZ BIANCA ESTELA', 'recepcion-mercancia-sucursal', 'Recepción de Mercancía de Sucursal', 'Morelia Abastos'),
    ('RODRIGUEZ OJEDA IRVING VLADIMIR', 'bodeguero-sucursal', 'Bodeguero de Sucursal', 'Morelia Abastos'),
    ('SANDOVAL SANCHEZ VICTORIA', 'cajero-sucursal', 'Cajero(a) de Sucursal', 'Morelia Abastos'),
    ('ORTEGA CALDERON GLORIA', 'vendedora-piso', 'Vendedora de Piso', 'Morelia Abastos'),
    ('CAMPERO ORTIZ YADIRA', 'encargado-sucursal', 'Encargado(a) de Sucursal', 'Morelia Abastos'),
    ('AGUILAR MOLINERO ANDREA CRISTINA', 'anaquelista', 'Anaquelista de Sucursal', 'Morelia Abastos'),
    ('REYES CARRANZA NESTOR GERZAIN', 'almacenista-sucursal', 'Almacenista de Sucursal', 'Morelia Abastos'),
    ('ZACARIAS BAEZA MILAGROS', 'anaquelista', 'Anaquelista de Sucursal', 'Morelia Abastos'),
    ('GRANADOS LOPEZ MICHEL', 'empaque', 'Empaque', 'Morelia Abastos'),
    ('RENDON GUTIERREZ JOSE DAVID', 'vendedora-piso', 'Vendedora de Piso', 'Morelia Abastos'),
    ('MEDINA MENDOZA ALEJANDRA GUADALUPE', 'cajero-sucursal', 'Cajero(a) de Sucursal', 'Morelia Abastos'),
    ('BARRERA ALCANTAR MARIA SELENE', 'anaquelista', 'Anaquelista de Sucursal', 'Morelia Abastos'),
    ('GODINEZ PALMEÑO SANTIAGO KENNETH', 'bodeguero-sucursal', 'Bodeguero de Sucursal', 'Morelia Abastos'),
    ('FERREYRA CONTRERAS EDGAR JESUS', 'anaquelista', 'Anaquelista de Sucursal', 'Morelia Abastos'),
    ('RUIZ RODRIGUEZ CLAUDIA ANGELICA', 'cajero-sucursal', 'Cajero(a) de Sucursal', 'Morelia Abastos'),
    ('SALAS MADRIGAL JAVIER ALAN', 'cajero-sucursal', 'Cajero(a) de Sucursal', 'Morelia Abastos'),
    ('GONZALEZ MENDEZ MIGUEL ANGEL', 'almacenista-sucursal', 'Almacenista de Sucursal', 'Morelia Madero'),
    ('GUIZA RUFINO JORGE ANTONIO', 'anaquelista', 'Anaquelista de Sucursal', 'Morelia Madero'),
    ('PALMAR CARRERA VIOLETA', 'anaquelista', 'Anaquelista de Sucursal', 'Morelia Madero'),
    ('CASIAS GARCIA ROSAURA', 'encargado-sucursal', 'Encargado(a) de Sucursal', 'Morelia Madero'),
    ('CORNEJO CORNEJO ANA SARENNI', 'anaquelista', 'Anaquelista de Sucursal', 'Morelia Madero'),
    ('GARFIAS ZETINA WILDA LIZETH', 'anaquelista', 'Anaquelista de Sucursal', 'Morelia Madero'),
    ('ALANIZ JIMENEZ CARMEN ELIZABETH', 'cajero-sucursal', 'Cajero(a) de Sucursal', 'Morelia Madero'),
    ('PEREZ SANCHEZ CESAR JESUS', 'anaquelista', 'Anaquelista de Sucursal', 'Morelia Madero'),
    ('BUSTAMANTE GARCIA BRENDA SALUD', 'promotora', 'Promotora', 'Morelia Abastos'),
    ('ALEJO ASCENCIO AARON TZIHUARAN', 'gerencia-zona', 'Gerencia de Zona', 'Morelia Abastos'),
    ('REYES CARRANZA YOSELIN CINTHYA', 'promotora', 'Promotora', 'Morelia Abastos'),
    ('ALVAREZ HERNANDEZ JULISSA AIDEE', 'aux-administrativo-zona', 'Auxiliar Administrativo de Zona', 'Morelia Abastos'),
    ('GUTIERREZ RODRIGUEZ MARIBEL', 'intendencia', 'Intendencia', 'Morelia Abastos'),
    ('GARCIA GARCIA CHRISTIAN JANETTE', 'analista-ordenes-entrada', 'Analista de Órdenes de Entrada', 'Morelia Abastos'),
    ('LUNA RAMIREZ EDGAR', 'anaquelista', 'Anaquelista de Sucursal', 'Morelia Abastos'),
    ('BECERRA BUCIO HAROLD', 'chofer-zona', 'Chofer de Zona', 'Morelia Abastos'),
    ('HERRERA AGUILAR JULIO CESAR', 'surtidor-zona', 'Surtidor de Zona', 'Morelia Abastos'),
    ('PATRICIO CHAVEZ PEDRO PABLO', 'checador', 'Checador', 'Morelia Abastos'),
    ('CALDERON FRAGA YULIANA', 'checador', 'Checador', 'Morelia Abastos'),
    ('TAPIA PUENTE MARTIN ALEXIS', 'surtidor-zona', 'Surtidor de Zona', 'Morelia Abastos'),
    ('RODRIGUEZ FUERTE JORGE EMANUEL', 'chofer-zona', 'Chofer de Zona', 'Morelia Abastos'),
    ('PLASCENCIA RAZO CESAR RICARDO', 'vendedor-vecinal', 'Vendedor Vecinal', 'Morelia Abastos'),
    ('AVALOS GUZMAN MARCO ANTONIO', 'surtidor-zona', 'Surtidor de Zona', 'Morelia Abastos'),
    ('CHAVEZ OSORIO RICARDO ISSAC', 'surtidor-zona', 'Surtidor de Zona', 'Morelia Abastos'),
    ('HERNANDEZ ALMANZA GUILLERMO', 'vendedor-vecinal', 'Vendedor Vecinal', 'Morelia Abastos'),
    ('MIRANDA ROMERO EDUARDO', 'vendedor-rd', 'Vendedor Ruta Directa', 'Morelia Abastos'),
    ('CASTRO BERBER ALFREDO', 'recepcion-producto-cedis', 'Recepción de Producto CEDIS', 'CEDIS'),
    ('LANDEROS MONTEJANO RODOLFO', 'almacenista-cedis', 'Almacenista CEDIS', 'CEDIS'),
    ('RODRIGUEZ ANGUIANO DIEGO TORIBIO', 'embarques', 'Embarques', 'CEDIS'),
    ('MARTINEZ MATA JUANA LIZBETH', 'checador-cedis', 'Checador CEDIS', 'CEDIS'),
    ('VERA RIVERA MARIA ISABEL', 'anaquelista', 'Anaquelista de Sucursal', 'Padre Hidalgo'),
    ('LOPEZ GALVAN CYNTHIA JUDITH', 'encargado-sucursal', 'Encargado(a) de Sucursal', 'Padre Hidalgo'),
    ('MEJIA SANCHEZ MONICA', 'auxiliar-encargado', 'Auxiliar de Encargado', 'Padre Hidalgo'),
    ('PEREZ MAGDALENO MARIA GUADALUPE', 'empaque', 'Empaque', 'Padre Hidalgo'),
    ('FRAUSTO NAVA ANA PAOLA', 'cajero-sucursal', 'Cajero(a) de Sucursal', 'Padre Hidalgo'),
    ('NAVA TAFOYA BEATRIZ ADRIANA', 'promotora', 'Promotora', 'Padre Hidalgo'),
    ('VILLARREAL ESCAMILLA FATIMA', 'anaquelista', 'Anaquelista de Sucursal', 'Padre Hidalgo'),
    ('ESPINO JR LUIS ARTURO', 'almacenista-sucursal', 'Almacenista de Sucursal', 'Padre Hidalgo'),
    ('DUARTE VELAZQUEZ JORGE ALBERTO', 'bodeguero-sucursal', 'Bodeguero de Sucursal', 'Padre Hidalgo'),
    ('OCEGUERA SALAZAR BRENDA MARGARITA', 'cajero-sucursal', 'Cajero(a) de Sucursal', 'Padre Hidalgo'),
    ('LIMON FLORES JESSICA ABIGAIL', 'cajero-sucursal', 'Cajero(a) de Sucursal', 'Padre Hidalgo'),
    ('RUIZ MATA MA DE LOS ANGELES', 'anaquelista', 'Anaquelista de Sucursal', 'Padre Hidalgo'),
    ('RUIZ GUZMAN CAROLINA', 'anaquelista', 'Anaquelista de Sucursal', 'Padre Hidalgo'),
    ('MENDEZ ZAMBRANO MONICA', 'anaquelista', 'Anaquelista de Sucursal', 'Padre Hidalgo'),
    ('MORENO CARBAJAL CHRISTIAN ALEJANDRO', 'surtidor-sucursal', 'Surtidor de Sucursal', 'Padre Hidalgo'),
    ('MENDOZA PEREZ SERGIO FRANCISCO', 'vendedor-mayoreo', 'Vendedor Mayoreo', 'Padre Hidalgo'),
    ('FRAUSTO NAVA MONSERRATH', 'facturacion', 'Facturación', 'Padre Hidalgo'),
    ('VILLALOBOS CAZARES MARIA IRENE', 'checador', 'Checador', 'Padre Hidalgo'),
    ('TORRES ACEVES MARCO ANTONIO', 'surtidor-zona', 'Surtidor de Zona', 'Padre Hidalgo'),
    ('RIZO REA LUIS ALEJANDRO', 'surtidor-zona', 'Surtidor de Zona', 'Padre Hidalgo'),
    ('FLORES SALAZAR ALEXIS', 'surtidor-zona', 'Surtidor de Zona', 'Padre Hidalgo'),
    ('GUTIERREZ CASTILLO MAYRA LAURA', 'aux-caja-general-zona', 'Auxiliar de Caja General de Zona', 'FINANZAS'),
    ('CARRILLO CONTRERAS JUAN JESUS', 'gerencia-admin-financiera', 'Gerencia Administrativa y Financiera', 'FINANZAS'),
    ('GARCIA PEREZ PERLA DEL ROSARIO', 'credito-cobranza', 'Crédito y Cobranza', 'FINANZAS'),
    ('GUTIERREZ GUZMAN MARIA DE LA PAZ', 'jefe-tesoreria', 'Jefe de Tesorería', 'FINANZAS'),
    ('CARDENAS SALAS ANDREA DE JESUS', 'auxiliar-auditoria-prevencion', 'Auxiliar de Auditoría y Prevención', 'FINANZAS'),
    ('ZARATE PEREZ ERNESTO', 'presupuestos-compras-corporativas', 'Presupuestos y Compras Corporativas', 'FINANZAS'),
    ('VERDINES NARANJO CAMILA JUDITH', 'auxiliar-auditoria-prevencion', 'Auxiliar de Auditoría y Prevención', 'FINANZAS'),
    ('ALANIS CHAVEZ PAULA LISSETT', 'credito-cobranza', 'Crédito y Cobranza', 'FINANZAS'),
    ('SOLORIO SANCHEZ TANIA', 'servicios-al-personal', 'Servicios al Personal', 'RH'),
    ('BERBER BERBER LESLY ESTEFANIA', 'servicios-al-personal', 'Servicios al Personal', 'RH'),
    ('CISNEROS SALAZAR ANGEL DAVID', 'full-stack-developer', 'Full Stack Developer', 'SISTEMAS'),
    ('GALVAN CASTAÑON FELIPE DANIEL', 'infraestructura-seguridad', 'Infraestructura y Seguridad', 'SISTEMAS'),
    ('CORTES GARCIA EDGAR DAYAN', 'full-stack-developer', 'Full Stack Developer', 'SISTEMAS'),
    ('PATLAN ZAMBRANO FERNANDA GUADALUPE', 'coordinador-marketing-digital', 'Coordinador de Marketing Digital y Ecommerce', 'MKT'),
    ('GONZALEZ LOPEZ YAJAYRA ARIZBETH', 'coordinacion-compras', 'Coordinación de Compras', 'COMPRAS'),
    ('RAMIREZ CASTRO GERARDO', 'analista-ordenes-entrada', 'Analista de Órdenes de Entrada', 'COMPRAS'),
    ('VENTURA HERNANDEZ MARIO ANTONIO', 'analista-ordenes-entrada', 'Analista de Órdenes de Entrada', 'COMPRAS'),
    ('BARAJAS VALENCIA UBALDO', 'jefe-mantenimiento', 'Jefe de Mantenimiento', 'MANTENIMIENTO'),
    ('FUENTES MONTES ENRIQUE', 'vendedor-suplente', 'Vendedor Suplente', 'Padre Hidalgo'),
    ('HURTADO OROZCO JOAQUIN', 'vendedor-rd', 'Vendedor Ruta Directa', 'Padre Hidalgo'),
    ('TAFOYA VAZQUEZ MARIA EUGENIA', 'cajero-rd', 'Cajero Ruta Directa', 'Padre Hidalgo'),
    ('VAZQUEZ MEJIA ANGEL ALBERTO', 'vendedor-rd', 'Vendedor Ruta Directa', 'Padre Hidalgo'),
    ('URBANO OLIVARES VICTORINO', 'vendedor-rd', 'Vendedor Ruta Directa', 'Padre Hidalgo'),
    ('GARCIA HURTADO VICTOR HUGO', 'vendedor-rd', 'Vendedor Ruta Directa', 'Padre Hidalgo'),
    ('MUÑOZ MENDEZ JAIRO OSWALDO', 'surtidor-ventas', 'Surtidor de Ventas', 'Padre Hidalgo'),
    ('MARTINEZ PATLAN MARIANO', 'vendedor-rd', 'Vendedor Ruta Directa', 'Padre Hidalgo'),
    ('VALADEZ LIMON MARIA ELENA', 'vendedor-suplente', 'Vendedor Suplente', 'Padre Hidalgo'),
    ('ALVAREZ CRUZ JOSE JESUS', 'vendedor-suplente', 'Vendedor Suplente', 'Padre Hidalgo'),
    ('GARCIA BRAVO BERTHA', 'promotora', 'Promotora', null),
    ('CISNEROS MORENO CECILIA', 'promotora', 'Promotora', null),
    ('CAZARES BELMONTE JOSE ANTONIO SALOME', 'aux-logistica-flotilla', 'Auxiliar de Logística – Flotilla', 'CEDIS'),
    ('Arroyo Acosta Leonardo Daniel', 'chofer-cedis', 'Chofer', 'CEDIS'),
    ('MENDEZ VILLA JOSE ANTONIO', 'chofer-cedis', 'Chofer', 'CEDIS'),
    ('CAZARES NAVARRO JUAN LEONARDO', 'aux-administrativo-zona', 'Auxiliar Administrativo de Zona', 'CEDIS'),
    ('GARCIA LOPEZ JUAN FRANCISCO', 'coordinador-logistica', 'Coordinador de Logística', 'CEDIS'),
    ('GUZMAN HERRERA JUAN MAURILIO', 'auxiliar-chofer', 'Auxiliar de Chofer', 'CEDIS'),
    ('CORONA REA BRANDON ALEXIS', 'auxiliar-chofer', 'Auxiliar de Chofer', 'CEDIS'),
    ('GALVAN VILLEGAS JOSE RAUL', 'chofer-cedis', 'Chofer', 'CEDIS'),
    ('RIZO HERRERA CRISTIAN', 'chofer-cedis', 'Chofer', 'CEDIS'),
    ('GONZALEZ FARIAS RAFAEL', 'chofer-cedis', 'Chofer', 'CEDIS'),
    ('JUAREZ HERRERA LUIS FRANCISCO', 'auxiliar-chofer', 'Auxiliar de Chofer', 'CEDIS'),
    ('MENDEZ CAMARENA CARLOS MIGUEL', 'chofer-cedis', 'Chofer', 'CEDIS'),
    ('NUÑEZ ALCALA GLORIA ESTER', 'cajero-vecinal', 'Cajero Vecinal', 'Padre Hidalgo'),
    ('SALGADO MORALES MARIA CANDELARIA', 'vendedor-vecinal', 'Vendedor Vecinal', 'Padre Hidalgo'),
    ('HERRERA HERRERA FELIX ALEJANDRO', 'surtidor-ventas', 'Surtidor de Ventas', 'Padre Hidalgo'),
    ('VILLALOBOS CAMPOS RAFAEL', 'vendedor-vecinal', 'Vendedor Vecinal', 'Padre Hidalgo'),
    ('RODRIGUEZ RODRIGUEZ DIANA ISABEL', 'analista-contable', 'Analista Contable', 'CONTABILIDAD'),
    ('RODRIGUEZ SOLORIO CLAUDIA JANETH', 'analista-contable', 'Analista Contable', 'CONTABILIDAD'),
    ('TAFOYA TORRES JOHANNA PALMIRA', 'analista-contable', 'Analista Contable', 'CONTABILIDAD'),
    ('CANO TORRES VANESSA JUDITH', 'analista-contable', 'Analista Contable', 'CONTABILIDAD'),
    ('QUIRINO NAZARIO RAFAEL', 'analista-ordenes-entrada', 'Analista de Órdenes de Entrada', 'Padre Hidalgo'),
    ('ALVARADO RODRIGUEZ REYNA SARAI', 'aux-mercadotecnia-zona', 'Auxiliar de Mercadotecnia de Zona', 'Padre Hidalgo'),
    ('ELIZARRARAS ALANIS JUAN MANUEL', 'analista-abastecimiento-comercial', 'Analista de Abastecimiento Comercial', 'Padre Hidalgo'),
    ('BERBER TOVAR MARIA DOLORES', 'cajero-sucursal', 'Cajero(a) de Sucursal', 'Yurécuaro'),
    ('ALVAREZ MONTEJANO YESSICA GUADALUPE', 'anaquelista', 'Anaquelista de Sucursal', 'Yurécuaro'),
    ('OLIVARES GONZALEZ MARIA SELENE', 'cajero-sucursal', 'Cajero(a) de Sucursal', 'Yurécuaro'),
    ('HERNANDEZ GONZALEZ ANA PATRICIA', 'encargado-sucursal', 'Encargado(a) de Sucursal', 'Canindo'),
    ('ANTEMATE ZAPO YADIRA DEL ROSARIO', 'cajero-sucursal', 'Cajero(a) de Sucursal', 'Canindo'),
    ('FERREYRA JUAREZ JENNIFER', 'cajero-sucursal', 'Cajero(a) de Sucursal', 'Canindo'),
    ('CISNEROS GONZALEZ DULCE MARIA', 'cajero-sucursal', 'Cajero(a) de Sucursal', 'Canindo'),
    ('LINARES HERNANDEZ JUAN PABLO', 'almacenista-sucursal', 'Almacenista de Sucursal', 'Canindo'),
    ('RODRIGUEZ SANCHEZ MIRIAM JUDITH', 'anaquelista', 'Anaquelista de Sucursal', 'Canindo'),
    ('VERDUZCO AGUILERA MARIA FERNANDA', 'cajero-sucursal', 'Cajero(a) de Sucursal', 'Canindo'),
    ('ZAVALA SERVIN SILVIA', 'anaquelista', 'Anaquelista de Sucursal', 'Canindo'),
    ('MEJIA ZARATE ROSALINDA', 'anaquelista', 'Anaquelista de Sucursal', 'Canindo'),
    ('CERVANTES RAMIREZ JORGE ISRAEL', 'bodeguero-sucursal', 'Bodeguero de Sucursal', 'Canindo'),
    ('MACIEL FUENTES BERTHA PAULINA', 'anaquelista', 'Anaquelista de Sucursal', 'Canindo'),
    ('HERNANDEZ GARCIA LUISA RENATA', 'anaquelista', 'Anaquelista de Sucursal', 'Canindo'),
    ('HERRERA NAVARRO JUAN CARLOS', 'chofer-zona', 'Chofer de Zona', 'Canindo'),
    ('GARCIA MEJIA GLORIA PATRICIA', 'aux-mercadotecnia-zona', 'Auxiliar de Mercadotecnia de Zona', 'Canindo'),
    ('HERNANDEZ CUEVAS FERNANDA LIZBETH', 'analista-ordenes-entrada', 'Analista de Órdenes de Entrada', 'Canindo'),
    ('VAZQUEZ ORTIZ LUIS GERARDO', 'analista-egresos', 'Analista de Egresos', 'Canindo'),
    ('MARTINEZ RAZO FRANCISCO DE JESUS', 'supervisor-ventas-rd', 'Supervisor de Ventas Ruta Directa', 'Canindo'),
    ('CASILLAS GIL FELIPE DE JESUS', 'aux-administrativo-zona', 'Auxiliar Administrativo de Zona', 'Canindo'),
    ('ZAVALA VILLALOBOS JOSE DE JESUS', 'vendedor-rd', 'Vendedor Ruta Directa', 'Canindo'),
    ('PADILLA ROJANO DANIEL', 'vendedor-rd', 'Vendedor Ruta Directa', 'Canindo'),
    ('MUÑOZ MOTA JOSE LUIS', 'vendedor-rd', 'Vendedor Ruta Directa', 'Canindo'),
    ('BOLAÑOS MAGAÑA LAURA PATRICIA', 'cajero-rd', 'Cajero Ruta Directa', 'Canindo'),
    ('ZALAPA BARRIGA VICTOR MANUEL', 'vendedor-rd', 'Vendedor Ruta Directa', 'Canindo'),
    ('AYALA HERRERA DIEGO LISANDRO', 'surtidor-zona', 'Surtidor de Zona', 'Canindo'),
    ('ESPINOZA ALCARAZ JUAN MANUEL', 'coordinador-operaciones-zona', 'Coordinador de Operaciones de Zona', 'Canindo'),
    ('FRANCO MARTINEZ DANIEL FRANCISCO', 'vendedor-mayoreo', 'Vendedor Mayoreo', 'Canindo'),
    ('GARCIA MEJIA MARIA DEL CARMEN', 'facturacion', 'Facturación', 'Canindo'),
    ('RIOS CISNEROS ANA GABRIELA', 'checador', 'Checador', 'Canindo'),
    ('CASAS MENDOZA CESAR', 'auxiliar-chofer', 'Auxiliar de Chofer', 'Canindo'),
    ('GONZALEZ AYALA OSCAR DANIEL', 'surtidor-zona', 'Surtidor de Zona', 'Canindo'),
    ('MEDINA ESPINOZA MANUEL', 'auxiliar-chofer', 'Auxiliar de Chofer', 'Canindo'),
    ('CISNEROS OROZCO ANDRES', 'surtidor-zona', 'Surtidor de Zona', 'Canindo'),
    ('CHAVERO NIÑO JHAROL STED', 'auxiliar-chofer', 'Auxiliar de Chofer', 'Canindo'),
    ('SANCHEZ LEAL TANIA YAZMIN', 'auxiliar-encargado', 'Auxiliar de Encargado', null),
    ('GARCIA MEJIA CECILIA DEL PILAR', 'auxiliar-encargado', 'Auxiliar de Encargado', null),
    ('CISNEROS ZAVALA BRALLAN', 'almacenista-sucursal', 'Almacenista de Sucursal', null),
    ('MOLINA ESPINOZA BLANCA SOFIA', 'cajero-sucursal', 'Cajero(a) de Sucursal', null),
    ('SOTO MARTINEZ ROGELIO', 'anaquelista', 'Anaquelista de Sucursal', null),
    ('CORTES MOLINA DIANA ROCIO', 'vendedor-rd', 'Vendedor Ruta Directa', null),
    ('REYES RAMIREZ JUAN LUIS', 'chofer-zona', 'Chofer de Zona', null),
    ('ARREDONDO MORENO EDITH', 'cajero-sucursal', 'Cajero(a) de Sucursal', null),
    ('LUIS FRANCISCO LOPEZ GUTIERREZ', 'direccion-general', 'Dirección General', null),
    ('GUILLERMO LOPEZ GUTIERREZ', 'direccion-general', 'Dirección General', null);

  -- ── Candidatos: usuario x fila de nomina con 2+ palabras en comun ───────
  create temporary table tmp_cand on commit drop as
  select n.nombre as nom_nomina, n.puesto, n.cargo, n.sucursal,
         u.id as uid,
         cardinality(
           array(select unnest(mdtask_tokens_nombre(u.nombre))
                 intersect
                 select unnest(mdtask_tokens_nombre(n.nombre)))
         ) as comunes
    from tmp_nomina n
    join mdtask_usuarios u
      on u.activo is not false
     and coalesce(btrim(u.nombre), '') <> ''
   where cardinality(
           array(select unnest(mdtask_tokens_nombre(u.nombre))
                 intersect
                 select unnest(mdtask_tokens_nombre(n.nombre)))
         ) >= 2;

  -- ── Solo los que ganan CON VENTAJA sobre el segundo candidato ───────────
  create temporary table tmp_ganador on commit drop as
  with rank_por_fila as (
    select c.*,
           row_number() over (partition by c.nom_nomina order by c.comunes desc) as pos,
           count(*)    over (partition by c.nom_nomina, c.comunes)               as empatados
      from tmp_cand c
  )
  select * from rank_por_fila
   where pos = 1 and empatados = 1;

  -- Dos filas de nomina apuntando al MISMO usuario: ninguna gana.
  delete from tmp_ganador g
   where exists (select 1 from tmp_ganador o
                  where o.uid = g.uid and o.nom_nomina <> g.nom_nomina);

  select count(*) into n_sinmatch
    from tmp_nomina n
   where not exists (select 1 from tmp_cand c where c.nom_nomina = n.nombre);
  select count(*) into n_ambiguo
    from tmp_nomina n
   where exists (select 1 from tmp_cand c where c.nom_nomina = n.nombre)
     and not exists (select 1 from tmp_ganador g where g.nom_nomina = n.nombre);
  select count(*) into n_yatenian
    from tmp_ganador g join mdtask_usuarios u on u.id = g.uid
   where coalesce(u.datos->>'puestoId', '') <> '';

  -- ── 1. El puesto (y el cargo, que media app sigue leyendo) ──────────────
  -- No se pisa a quien ya tenga un puestoId capturado a mano.
  update mdtask_usuarios u
     set cargo = g.cargo,
         datos = coalesce(u.datos, '{}'::jsonb)
                 || jsonb_build_object('puestoId', g.puesto,
                                       '_puestoAsignadoEn', v_sello,
                                       '_puestoOrigen', 'nomina periodo 35')
    from tmp_ganador g
   where u.id = g.uid
     and coalesce(u.datos->>'puestoId', '') = '';
  get diagnostics n_asignados = row_count;

  -- ── 2. La sucursal, SOLO donde no hay ninguna ───────────────────────────
  update mdtask_usuarios u
     set datos = coalesce(u.datos, '{}'::jsonb)
                 || jsonb_build_object('sucursales', jsonb_build_array(g.sucursal))
    from tmp_ganador g
   where u.id = g.uid
     and g.sucursal is not null
     and coalesce(jsonb_array_length(
           case when jsonb_typeof(u.datos->'sucursales') = 'array'
                then u.datos->'sucursales' else '[]'::jsonb end), 0) = 0
     and coalesce(u.datos->>'sucursal', '') = '';
  get diagnostics n_sucursal = row_count;

  insert into mdtask_asignacion_puestos_log (sello, aplicado_en, resumen)
  values (v_sello, (extract(epoch from now()) * 1000)::bigint,
          jsonb_build_object(
            'filasNomina',      (select count(*) from tmp_nomina),
            'puestosAsignados', n_asignados,
            'sucursalesLlenadas', n_sucursal,
            'yaTenianPuesto',   n_yatenian,
            'ambiguos',         n_ambiguo,
            'sinCoincidencia',  n_sinmatch))
  on conflict (sello) do update
     set aplicado_en = excluded.aplicado_en, resumen = excluded.resumen;

  raise notice 'PUESTOS % -> asignados:%, sucursales:%, ya tenian:%, ambiguos:%, sin match:%',
    v_sello, n_asignados, n_sucursal, n_yatenian, n_ambiguo, n_sinmatch;
end $$;
