/**
 * 📋 NÓMINA → PUESTO DEL ORGANIGRAMA  (tabla de importación, un solo uso)
 *
 * Sale de la Lista de Raya del período semanal 35 (22–28/Ago/2026), entregada
 * por David el 2026-08-28. Del documento se tomó ÚNICAMENTE nombre, puesto y
 * centro de costo: la lista de raya trae además RFC, CURP, número de afiliación
 * al IMSS y salarios, y nada de eso se extrajo ni se guarda aquí.
 *
 * PARA QUÉ SIRVE
 * La usa la acción "Asignar puestos desde nómina" de la pantalla de Usuarios,
 * que cruza estos nombres contra la plantilla de la app y propone el puesto de
 * cada quien. Es de UN SOLO USO: una vez que los puestos quedaron capturados,
 * este archivo se puede borrar sin que nada deje de funcionar.
 *
 * CÓMO SE RESOLVIÓ CADA PUESTO
 * Los nombres de puesto de la nómina no son los del organigrama, así que se
 * mapearon a mano. Tres reglas guiaron las decisiones:
 *
 *   · El centro de costo desambigua. "Surtidor" existe en cuatro lugares del
 *     organigrama; el centro dice cuál: Tlmkt/Rutas → Surtidor de Zona,
 *     RD/RV → Surtidor de Ventas, Cedis → Surtidor CEDIS, sucursal → Surtidor
 *     de Sucursal. Igual con Checador, Chofer y Recepción de Mercancía.
 *   · Lo que no existe en el organigrama NO se inventa. 5 personas quedaron
 *     con `puestoId: null` a propósito (Ayudante General, Cargador,
 *     Implementación Kepler, Diseñador UX UY, Auxiliar de TLMK). Inventarles un
 *     puesto sería entregarles obligaciones que no les tocan y esconderle a
 *     Capital Humano que falta definirlos.
 *   · La sucursal solo se propone cuando el centro de costo tiene equivalente
 *     REAL en el catálogo de la app. 10 personas quedaron sin sucursal porque
 *     su centro no existe ahí: Damaso y Promotoras Santa Ana.
 *
 * OJO CON EL NOMBRE: la nómina escribe APELLIDOS NOMBRES y la app escribe
 * Nombre Apellidos. El cruce NO puede ser por texto igual; va por coincidencia
 * de palabras, y la pantalla muestra el resultado antes de escribir nada.
 *
 * Totales: 189 personas · 184 con puesto del organigrama · 5 sin puesto ·
 * 10 sin sucursal · 29 centros de costo.
 */

/** Una persona de la nómina, ya traducida al organigrama. */
export interface FilaNomina {
  /** Nombre tal como lo escribe la nómina (APELLIDOS NOMBRES). */
  nombre: string;
  /** El puesto tal como lo escribe la nómina, para poder auditar el mapeo. */
  puestoNomina: string;
  /** El centro de costo de la nómina. */
  centro: string;
  /** Puesto del organigrama 2026. null = no tiene equivalente. */
  puestoId: string | null;
  /** Sucursal del catálogo de la app. null = su centro no existe ahí. */
  sucursal: string | null;
  /**
   * Si una persona corrigió el puesto que decía la nómina, aquí queda el
   * motivo. La pantalla lo muestra para que se vea que NO es inferencia del
   * documento sino una decisión tomada a mano.
   */
  corregido?: string;
}

import { correccionDe, ALTAS_MANUALES, sucursalPorCentro } from './nomina-correcciones';

export const NOMINA_PUESTOS: FilaNomina[] = [
  { nombre: 'CARRILLO CONTRERAS MIRIAM JAZMIN', puestoNomina: 'Cajera', centro: '8 Esquinas', puestoId: 'cajero-sucursal', sucursal: '8 Esquinas' },
  { nombre: 'NAVA TAFOYA MARIA DEL PILAR', puestoNomina: 'Auxiliar de Promociones', centro: '8 Esquinas', puestoId: 'promotora', sucursal: '8 Esquinas' },
  { nombre: 'HERREJON MOLINA ROSARIO', puestoNomina: 'Cajera', centro: '8 Esquinas', puestoId: 'cajero-sucursal', sucursal: '8 Esquinas' },
  { nombre: 'GOMEZ ZARATE YAZMIN SARAI', puestoNomina: 'Auxiliar de Encargado', centro: '8 Esquinas', puestoId: 'auxiliar-encargado', sucursal: '8 Esquinas' },
  { nombre: 'HERNANDEZ CHAVEZ LUIS ANGEL', puestoNomina: 'Almacenista', centro: '8 Esquinas', puestoId: 'almacenista-sucursal', sucursal: '8 Esquinas' },
  { nombre: 'MUÑOZ VENTURA ANGELICA MARIA', puestoNomina: 'Cajera', centro: '8 Esquinas', puestoId: 'cajero-sucursal', sucursal: '8 Esquinas' },
  { nombre: 'BERMUDEZ HERRERA HECTOR', puestoNomina: 'Anaquelista', centro: '8 Esquinas', puestoId: 'anaquelista', sucursal: '8 Esquinas' },
  { nombre: 'CALLEJAS VACA LUIS FERNANDO', puestoNomina: 'Anaquelista', centro: '8 Esquinas', puestoId: 'anaquelista', sucursal: '8 Esquinas' },
  { nombre: 'VALADEZ MENDEZ JUANA', puestoNomina: 'Anaquelista', centro: '8 Esquinas', puestoId: 'anaquelista', sucursal: '8 Esquinas' },
  { nombre: 'ESPITIA VACA FERNANDO', puestoNomina: 'Anaquelista', centro: '8 Esquinas', puestoId: 'anaquelista', sucursal: '8 Esquinas' },
  { nombre: 'HERNANDEZ VILLANUEVA CLAUDIA GABRIELA', puestoNomina: 'Anaquelista', centro: '8 Esquinas', puestoId: 'anaquelista', sucursal: '8 Esquinas' },
  { nombre: 'MELGOZA ASCENCIO GUSTAVO ALEJANDRO', puestoNomina: 'Cajero', centro: 'La Piedad Abastos', puestoId: 'cajero-sucursal', sucursal: 'La Piedad Abastos' },
  { nombre: 'PALOMINO MEJIA MARIA SILVIA', puestoNomina: 'Anaquelista', centro: 'La Piedad Abastos', puestoId: 'anaquelista', sucursal: 'La Piedad Abastos' },
  { nombre: 'NAVARRO ALVARADO LUIS DAVID', puestoNomina: 'Almacenista', centro: 'La Piedad Abastos', puestoId: 'almacenista-sucursal', sucursal: 'La Piedad Abastos' },
  { nombre: 'PLASCENCIA BRAVO PAULINA MICHELLE', puestoNomina: 'Vendora Vecinal', centro: 'La Piedad Abastos', puestoId: 'vendedor-vecinal', sucursal: 'La Piedad Abastos' },
  { nombre: 'ALATORRE RUEDA DULCE MARIA', puestoNomina: 'Cajera', centro: 'La Piedad Abastos', puestoId: 'cajero-sucursal', sucursal: 'La Piedad Abastos' },
  { nombre: 'VENEGAS ESTRADA DIANA ESTEFANIA', puestoNomina: 'Cajera', centro: 'La Piedad Abastos', puestoId: 'cajero-sucursal', sucursal: 'La Piedad Abastos' },
  { nombre: 'CABELLO RUIZ JOSE ARTURO', puestoNomina: 'Anaquelista', centro: 'La Piedad Abastos', puestoId: 'anaquelista', sucursal: 'La Piedad Abastos' },
  { nombre: 'DURAN RIOS MARINA ISABEL', puestoNomina: 'Cajera', centro: 'La Piedad Abastos', puestoId: 'cajero-sucursal', sucursal: 'La Piedad Abastos' },
  { nombre: 'FLORES MARTINEZ ELIZABETH', puestoNomina: 'Cajera', centro: 'Morelia Abastos', puestoId: 'cajero-sucursal', sucursal: 'Morelia Abastos' },
  { nombre: 'RUIZ CRUZ BIANCA ESTELA', puestoNomina: 'Recepcion de Mercancía', centro: 'Morelia Abastos', puestoId: 'recepcion-mercancia-sucursal', sucursal: 'Morelia Abastos' },
  { nombre: 'RODRIGUEZ OJEDA IRVING VLADIMIR', puestoNomina: 'Bodeguero', centro: 'Morelia Abastos', puestoId: 'bodeguero-sucursal', sucursal: 'Morelia Abastos' },
  { nombre: 'SANDOVAL SANCHEZ VICTORIA', puestoNomina: 'Cajera', centro: 'Morelia Abastos', puestoId: 'cajero-sucursal', sucursal: 'Morelia Abastos' },
  { nombre: 'ORTEGA CALDERON GLORIA', puestoNomina: 'Vendedor', centro: 'Morelia Abastos', puestoId: 'vendedora-piso', sucursal: 'Morelia Abastos' },
  { nombre: 'CAMPERO ORTIZ YADIRA', puestoNomina: 'Encargada de sucursal', centro: 'Morelia Abastos', puestoId: 'encargado-sucursal', sucursal: 'Morelia Abastos' },
  { nombre: 'AGUILAR MOLINERO ANDREA CRISTINA', puestoNomina: 'Anaquelista', centro: 'Morelia Abastos', puestoId: 'anaquelista', sucursal: 'Morelia Abastos' },
  { nombre: 'REYES CARRANZA NESTOR GERZAIN', puestoNomina: 'Almacenista', centro: 'Morelia Abastos', puestoId: 'almacenista-sucursal', sucursal: 'Morelia Abastos' },
  { nombre: 'GARCIA ORTEGA LUIS ANGEL', puestoNomina: 'Ayudante General', centro: 'Morelia Abastos', puestoId: null, sucursal: 'Morelia Abastos' },
  { nombre: 'ZACARIAS BAEZA MILAGROS', puestoNomina: 'Anaquelista', centro: 'Morelia Abastos', puestoId: 'anaquelista', sucursal: 'Morelia Abastos' },
  { nombre: 'GRANADOS LOPEZ MICHEL', puestoNomina: 'Empaque', centro: 'Morelia Abastos', puestoId: 'empaque', sucursal: 'Morelia Abastos' },
  { nombre: 'RENDON GUTIERREZ JOSE DAVID', puestoNomina: 'Auxiliar Piso de Venta', centro: 'Morelia Abastos', puestoId: 'vendedora-piso', sucursal: 'Morelia Abastos' },
  { nombre: 'MEDINA MENDOZA ALEJANDRA GUADALUPE', puestoNomina: 'Cajera', centro: 'Morelia Abastos', puestoId: 'cajero-sucursal', sucursal: 'Morelia Abastos' },
  { nombre: 'BARRERA ALCANTAR MARIA SELENE', puestoNomina: 'Anaquelista', centro: 'Morelia Abastos', puestoId: 'anaquelista', sucursal: 'Morelia Abastos' },
  { nombre: 'GODINEZ PALMEÑO SANTIAGO KENNETH', puestoNomina: 'Bodeguero', centro: 'Morelia Abastos', puestoId: 'bodeguero-sucursal', sucursal: 'Morelia Abastos' },
  { nombre: 'FERREYRA CONTRERAS EDGAR JESUS', puestoNomina: 'Anaquelista', centro: 'Morelia Abastos', puestoId: 'anaquelista', sucursal: 'Morelia Abastos' },
  { nombre: 'RUIZ RODRIGUEZ CLAUDIA ANGELICA', puestoNomina: 'Cajera', centro: 'Morelia Abastos', puestoId: 'cajero-sucursal', sucursal: 'Morelia Abastos' },
  { nombre: 'SALAS MADRIGAL JAVIER ALAN', puestoNomina: 'Cajero', centro: 'Morelia Abastos', puestoId: 'cajero-sucursal', sucursal: 'Morelia Abastos' },
  { nombre: 'GONZALEZ MENDEZ MIGUEL ANGEL', puestoNomina: 'Almacenista', centro: 'Morelia Madero', puestoId: 'almacenista-sucursal', sucursal: 'Morelia Madero' },
  { nombre: 'GUIZA RUFINO JORGE ANTONIO', puestoNomina: 'Anaquelista', centro: 'Morelia Madero', puestoId: 'anaquelista', sucursal: 'Morelia Madero' },
  { nombre: 'PALMAR CARRERA VIOLETA', puestoNomina: 'Anaquelista', centro: 'Morelia Madero', puestoId: 'anaquelista', sucursal: 'Morelia Madero' },
  { nombre: 'CASIAS GARCIA ROSAURA', puestoNomina: 'Encargado de sucursal', centro: 'Morelia Madero', puestoId: 'encargado-sucursal', sucursal: 'Morelia Madero' },
  { nombre: 'CORNEJO CORNEJO ANA SARENNI', puestoNomina: 'Anaquelista', centro: 'Morelia Madero', puestoId: 'anaquelista', sucursal: 'Morelia Madero' },
  { nombre: 'GARFIAS ZETINA WILDA LIZETH', puestoNomina: 'Anaquelista', centro: 'Morelia Madero', puestoId: 'anaquelista', sucursal: 'Morelia Madero' },
  { nombre: 'ALANIZ JIMENEZ CARMEN ELIZABETH', puestoNomina: 'Cajera', centro: 'Morelia Madero', puestoId: 'cajero-sucursal', sucursal: 'Morelia Madero' },
  { nombre: 'PEREZ SANCHEZ CESAR JESUS', puestoNomina: 'Anaquelista', centro: 'Morelia Madero', puestoId: 'anaquelista', sucursal: 'Morelia Madero' },
  { nombre: 'BUSTAMANTE GARCIA BRENDA SALUD', puestoNomina: 'Promotora', centro: 'Promotoras Morelia', puestoId: 'promotora', sucursal: 'Morelia Abastos' },
  { nombre: 'ALEJO ASCENCIO AARON TZIHUARAN', puestoNomina: 'Jefe Zona Morelia', centro: 'Staff Morelia', puestoId: 'gerencia-zona', sucursal: 'Morelia Abastos' },
  { nombre: 'REYES CARRANZA YOSELIN CINTHYA', puestoNomina: 'Vendedor de Promociones', centro: 'Staff Morelia', puestoId: 'promotora', sucursal: 'Morelia Abastos' },
  { nombre: 'ALVAREZ HERNANDEZ JULISSA AIDEE', puestoNomina: 'Auxiliar administrativo', centro: 'Staff Morelia', puestoId: 'aux-administrativo-zona', sucursal: 'Morelia Abastos' },
  { nombre: 'GUTIERREZ RODRIGUEZ MARIBEL', puestoNomina: 'Intendencia', centro: 'Staff Morelia', puestoId: 'intendencia', sucursal: 'Morelia Abastos' },
  { nombre: 'GARCIA GARCIA CHRISTIAN JANETTE', puestoNomina: 'Auxiliar de Compras', centro: 'Staff Morelia', puestoId: 'analista-ordenes-entrada', sucursal: 'Morelia Abastos' },
  { nombre: 'LUNA RAMIREZ EDGAR', puestoNomina: 'Anaquelista', centro: 'Staff Morelia', puestoId: 'anaquelista', sucursal: 'Morelia Abastos' },
  { nombre: 'PATIÑO OROZCO ARACELI', puestoNomina: 'Auxiliar de TLMK', centro: 'Tlmkt Morelia', puestoId: null, sucursal: 'Morelia Abastos' },
  { nombre: 'BECERRA BUCIO HAROLD', puestoNomina: 'Chofer Local', centro: 'Tlmkt Morelia', puestoId: 'chofer-zona', sucursal: 'Morelia Abastos' },
  { nombre: 'HERRERA AGUILAR JULIO CESAR', puestoNomina: 'Surtidor', centro: 'Tlmkt Morelia', puestoId: 'surtidor-zona', sucursal: 'Morelia Abastos' },
  { nombre: 'PATRICIO CHAVEZ PEDRO PABLO', puestoNomina: 'Checador', centro: 'Tlmkt Morelia', puestoId: 'checador', sucursal: 'Morelia Abastos' },
  { nombre: 'CALDERON FRAGA YULIANA', puestoNomina: 'Checadora', centro: 'Tlmkt Morelia', puestoId: 'checador', sucursal: 'Morelia Abastos' },
  { nombre: 'TAPIA PUENTE MARTIN ALEXIS', puestoNomina: 'Surtidor', centro: 'Tlmkt Morelia', puestoId: 'surtidor-zona', sucursal: 'Morelia Abastos' },
  { nombre: 'RODRIGUEZ FUERTE JORGE EMANUEL', puestoNomina: 'Chofer Foraneo', centro: 'Tlmkt Morelia', puestoId: 'chofer-zona', sucursal: 'Morelia Abastos' },
  { nombre: 'PLASCENCIA RAZO CESAR RICARDO', puestoNomina: 'Vendedor Vecinal Sucursal', centro: 'Rutas Morelia', puestoId: 'vendedor-vecinal', sucursal: 'Morelia Abastos' },
  { nombre: 'AVALOS GUZMAN MARCO ANTONIO', puestoNomina: 'Surtidor', centro: 'Rutas Morelia', puestoId: 'surtidor-zona', sucursal: 'Morelia Abastos' },
  { nombre: 'CHAVEZ OSORIO RICARDO ISSAC', puestoNomina: 'Surtidor', centro: 'Rutas Morelia', puestoId: 'surtidor-zona', sucursal: 'Morelia Abastos' },
  { nombre: 'HERNANDEZ ALMANZA GUILLERMO', puestoNomina: 'Vendedor Vecinal Sucursal', centro: 'Rutas Morelia', puestoId: 'vendedor-vecinal', sucursal: 'Morelia Abastos' },
  { nombre: 'MIRANDA ROMERO EDUARDO', puestoNomina: 'Vendedor RD', centro: 'Rutas Morelia', puestoId: 'vendedor-rd', sucursal: 'Morelia Abastos' },
  { nombre: 'CASTRO BERBER ALFREDO', puestoNomina: 'Recepción de Mercancía', centro: 'Cedis', puestoId: 'recepcion-producto-cedis', sucursal: 'CEDIS' },
  { nombre: 'LANDEROS MONTEJANO RODOLFO', puestoNomina: 'Auxiliar Bodega', centro: 'Cedis', puestoId: 'almacenista-cedis', sucursal: 'CEDIS' },
  { nombre: 'RODRIGUEZ ANGUIANO DIEGO TORIBIO', puestoNomina: 'Embarques', centro: 'Cedis', puestoId: 'embarques', sucursal: 'CEDIS' },
  { nombre: 'AGUILAR ENRIQUEZ CARLOS ALBERTO', puestoNomina: 'Cargador', centro: 'Cedis', puestoId: null, sucursal: 'CEDIS' },
  { nombre: 'MARTINEZ MATA JUANA LIZBETH', puestoNomina: 'Checadora', centro: 'Cedis', puestoId: 'checador-cedis', sucursal: 'CEDIS' },
  { nombre: 'VERA RIVERA MARIA ISABEL', puestoNomina: 'Anaquelista', centro: 'Padre Hidalgo', puestoId: 'anaquelista', sucursal: 'Padre Hidalgo' },
  { nombre: 'LOPEZ GALVAN CYNTHIA JUDITH', puestoNomina: 'Encargada de sucursal', centro: 'Padre Hidalgo', puestoId: 'encargado-sucursal', sucursal: 'Padre Hidalgo' },
  { nombre: 'MEJIA SANCHEZ MONICA', puestoNomina: 'Auxiliar de Encargado', centro: 'Padre Hidalgo', puestoId: 'auxiliar-encargado', sucursal: 'Padre Hidalgo' },
  { nombre: 'PEREZ MAGDALENO MARIA GUADALUPE', puestoNomina: 'Empaque', centro: 'Padre Hidalgo', puestoId: 'empaque', sucursal: 'Padre Hidalgo' },
  { nombre: 'FRAUSTO NAVA ANA PAOLA', puestoNomina: 'Cajera', centro: 'Padre Hidalgo', puestoId: 'cajero-sucursal', sucursal: 'Padre Hidalgo' },
  { nombre: 'NAVA TAFOYA BEATRIZ ADRIANA', puestoNomina: 'Encargada de promociones', centro: 'Padre Hidalgo', puestoId: 'promotora', sucursal: 'Padre Hidalgo' },
  { nombre: 'VILLARREAL ESCAMILLA FATIMA', puestoNomina: 'Anaquelista', centro: 'Padre Hidalgo', puestoId: 'anaquelista', sucursal: 'Padre Hidalgo' },
  { nombre: 'ESPINO JR LUIS ARTURO', puestoNomina: 'Almacenista', centro: 'Padre Hidalgo', puestoId: 'almacenista-sucursal', sucursal: 'Padre Hidalgo' },
  { nombre: 'DUARTE VELAZQUEZ JORGE ALBERTO', puestoNomina: 'Bodeguero', centro: 'Padre Hidalgo', puestoId: 'bodeguero-sucursal', sucursal: 'Padre Hidalgo' },
  { nombre: 'OCEGUERA SALAZAR BRENDA MARGARITA', puestoNomina: 'Cajera', centro: 'Padre Hidalgo', puestoId: 'cajero-sucursal', sucursal: 'Padre Hidalgo' },
  { nombre: 'LIMON FLORES JESSICA ABIGAIL', puestoNomina: 'Cajera', centro: 'Padre Hidalgo', puestoId: 'cajero-sucursal', sucursal: 'Padre Hidalgo' },
  { nombre: 'RUIZ MATA MA DE LOS ANGELES', puestoNomina: 'Anaquelista', centro: 'Padre Hidalgo', puestoId: 'anaquelista', sucursal: 'Padre Hidalgo' },
  { nombre: 'RUIZ GUZMAN CAROLINA', puestoNomina: 'Anaquelista', centro: 'Padre Hidalgo', puestoId: 'anaquelista', sucursal: 'Padre Hidalgo' },
  { nombre: 'MENDEZ ZAMBRANO MONICA', puestoNomina: 'Anaquelista', centro: 'Padre Hidalgo', puestoId: 'anaquelista', sucursal: 'Padre Hidalgo' },
  { nombre: 'MORENO CARBAJAL CHRISTIAN ALEJANDRO', puestoNomina: 'Surtidor De Pasillo', centro: 'Padre Hidalgo', puestoId: 'surtidor-sucursal', sucursal: 'Padre Hidalgo' },
  { nombre: 'MENDOZA PEREZ SERGIO FRANCISCO', puestoNomina: 'Vendedor de Telemarketing', centro: 'Tlmkt Padre Hidalgo', puestoId: 'vendedor-mayoreo', sucursal: 'Padre Hidalgo' },
  { nombre: 'FRAUSTO NAVA MONSERRATH', puestoNomina: 'Facturación', centro: 'Tlmkt Padre Hidalgo', puestoId: 'facturacion', sucursal: 'Padre Hidalgo' },
  { nombre: 'VILLALOBOS CAZARES MARIA IRENE', puestoNomina: 'Checadora', centro: 'Tlmkt Padre Hidalgo', puestoId: 'checador', sucursal: 'Padre Hidalgo' },
  { nombre: 'TORRES ACEVES MARCO ANTONIO', puestoNomina: 'Surtidor', centro: 'Tlmkt Padre Hidalgo', puestoId: 'surtidor-zona', sucursal: 'Padre Hidalgo' },
  { nombre: 'RIZO REA LUIS ALEJANDRO', puestoNomina: 'Surtidor', centro: 'Tlmkt Padre Hidalgo', puestoId: 'surtidor-zona', sucursal: 'Padre Hidalgo' },
  { nombre: 'FLORES SALAZAR ALEXIS', puestoNomina: 'Surtidor', centro: 'Tlmkt Padre Hidalgo', puestoId: 'surtidor-zona', sucursal: 'Padre Hidalgo' },
  { nombre: 'GUTIERREZ CASTILLO MAYRA LAURA', puestoNomina: 'Auxiliar de Caja General', centro: 'Finanzas', puestoId: 'aux-caja-general-zona', sucursal: 'FINANZAS' },
  { nombre: 'CARRILLO CONTRERAS JUAN JESUS', puestoNomina: 'Jefe de Finanzas', centro: 'Finanzas', puestoId: 'gerencia-admin-financiera', sucursal: 'FINANZAS' },
  { nombre: 'GARCIA PEREZ PERLA DEL ROSARIO', puestoNomina: 'Analista de Crédito y Cobranza', centro: 'Finanzas', puestoId: 'credito-cobranza', sucursal: 'FINANZAS' },
  { nombre: 'GUTIERREZ GUZMAN MARIA DE LA PAZ', puestoNomina: 'Jefatura de Tesorería', centro: 'Finanzas', puestoId: 'jefe-tesoreria', sucursal: 'FINANZAS' },
  { nombre: 'CARDENAS SALAS ANDREA DE JESUS', puestoNomina: 'Auxiliar Prevencion', centro: 'Finanzas', puestoId: 'auxiliar-auditoria-prevencion', sucursal: 'FINANZAS' },
  { nombre: 'ZARATE PEREZ ERNESTO', puestoNomina: 'Analista de Compras y Activos', centro: 'Finanzas', puestoId: 'presupuestos-compras-corporativas', sucursal: 'FINANZAS' },
  { nombre: 'VERDINES NARANJO CAMILA JUDITH', puestoNomina: 'Auxiliar auditoria y prevencion', centro: 'Finanzas', puestoId: 'auxiliar-auditoria-prevencion', sucursal: 'FINANZAS' },
  { nombre: 'ALANIS CHAVEZ PAULA LISSETT', puestoNomina: 'Auxiliar de Credito y Cobranza', centro: 'Finanzas', puestoId: 'credito-cobranza', sucursal: 'FINANZAS' },
  { nombre: 'SOLORIO SANCHEZ TANIA', puestoNomina: 'Auxiliar RRHH', centro: 'RRHH', puestoId: 'servicios-al-personal', sucursal: 'RH' },
  { nombre: 'BERBER BERBER LESLY ESTEFANIA', puestoNomina: 'Auxiliar RRHH', centro: 'RRHH', puestoId: 'servicios-al-personal', sucursal: 'RH' },
  { nombre: 'CISNEROS SALAZAR ANGEL DAVID', puestoNomina: 'Desarrollador de Aplicaciones Web', centro: 'Sistemas', puestoId: 'full-stack-developer', sucursal: 'SISTEMAS' },
  { nombre: 'GALVAN CASTAÑON FELIPE DANIEL', puestoNomina: 'Auxiliar de Sistemas', centro: 'Sistemas', puestoId: 'infraestructura-seguridad', sucursal: 'SISTEMAS' },
  { nombre: 'CORTES GARCIA EDGAR DAYAN', puestoNomina: 'Desarrollador de Aplicaciones Web', centro: 'Sistemas', puestoId: 'full-stack-developer', sucursal: 'SISTEMAS' },
  { nombre: 'PATLAN ZAMBRANO FERNANDA GUADALUPE', puestoNomina: 'Coordinador de Mercadotecnia', centro: 'Mercadotecnia', puestoId: 'coordinador-marketing-digital', sucursal: 'MKT' },
  { nombre: 'ORTIZ AVILA SALVADOR RODRIGO', puestoNomina: 'Diseñador UX UY', centro: 'Mercadotecnia', puestoId: null, sucursal: 'MKT' },
  { nombre: 'GONZALEZ LOPEZ YAJAYRA ARIZBETH', puestoNomina: 'Jefe de Compras', centro: 'Compras', puestoId: 'coordinacion-compras', sucursal: 'COMPRAS' },
  { nombre: 'RAMIREZ CASTRO GERARDO', puestoNomina: 'Auxiliar de Compras', centro: 'Compras', puestoId: 'analista-ordenes-entrada', sucursal: 'COMPRAS' },
  { nombre: 'VENTURA HERNANDEZ MARIO ANTONIO', puestoNomina: 'Auxiliar Compras', centro: 'Compras', puestoId: 'analista-ordenes-entrada', sucursal: 'COMPRAS' },
  { nombre: 'BARAJAS VALENCIA UBALDO', puestoNomina: 'Jefe Mantenimiento', centro: 'Mantenimiento', puestoId: 'jefe-mantenimiento', sucursal: 'MANTENIMIENTO' },
  { nombre: 'FUENTES MONTES ENRIQUE', puestoNomina: 'Vendedor Sombra', centro: 'RD Padre Hidalgo', puestoId: 'vendedor-suplente', sucursal: 'Padre Hidalgo' },
  { nombre: 'HURTADO OROZCO JOAQUIN', puestoNomina: 'Vendedor RD', centro: 'RD Padre Hidalgo', puestoId: 'vendedor-rd', sucursal: 'Padre Hidalgo' },
  { nombre: 'TAFOYA VAZQUEZ MARIA EUGENIA', puestoNomina: 'Cajera RD', centro: 'RD Padre Hidalgo', puestoId: 'cajero-rd', sucursal: 'Padre Hidalgo' },
  { nombre: 'VAZQUEZ MEJIA ANGEL ALBERTO', puestoNomina: 'Vendedor RD', centro: 'RD Padre Hidalgo', puestoId: 'vendedor-rd', sucursal: 'Padre Hidalgo' },
  { nombre: 'URBANO OLIVARES VICTORINO', puestoNomina: 'Vendedor RD', centro: 'RD Padre Hidalgo', puestoId: 'vendedor-rd', sucursal: 'Padre Hidalgo' },
  { nombre: 'GARCIA HURTADO VICTOR HUGO', puestoNomina: 'Vendedor RD', centro: 'RD Padre Hidalgo', puestoId: 'vendedor-rd', sucursal: 'Padre Hidalgo' },
  { nombre: 'MUÑOZ MENDEZ JAIRO OSWALDO', puestoNomina: 'Surtidor', centro: 'RD Padre Hidalgo', puestoId: 'surtidor-ventas', sucursal: 'Padre Hidalgo' },
  { nombre: 'MARTINEZ PATLAN MARIANO', puestoNomina: 'Vendedor RD', centro: 'RD Padre Hidalgo', puestoId: 'vendedor-rd', sucursal: 'Padre Hidalgo' },
  { nombre: 'VALADEZ LIMON MARIA ELENA', puestoNomina: 'Vendedor Sombra', centro: 'RD Padre Hidalgo', puestoId: 'vendedor-suplente', sucursal: 'Padre Hidalgo' },
  { nombre: 'ALVAREZ CRUZ JOSE JESUS', puestoNomina: 'Vendedor Sombra', centro: 'RD Padre Hidalgo', puestoId: 'vendedor-suplente', sucursal: 'Padre Hidalgo' },
  { nombre: 'GARCIA BRAVO BERTHA', puestoNomina: 'Promotora', centro: 'Promotoras Santa Ana', puestoId: 'promotora', sucursal: null },
  { nombre: 'CISNEROS MORENO CECILIA', puestoNomina: 'Promotora', centro: 'Promotoras Santa Ana', puestoId: 'promotora', sucursal: null },
  { nombre: 'CAZARES BELMONTE JOSE ANTONIO SALOME', puestoNomina: 'Auxiliar de Logística', centro: 'Logística', puestoId: 'aux-logistica-flotilla', sucursal: 'CEDIS' },
  { nombre: 'Arroyo Acosta Leonardo Daniel', puestoNomina: 'Chofer', centro: 'Logística', puestoId: 'chofer-cedis', sucursal: 'CEDIS' },
  { nombre: 'MENDEZ VILLA JOSE ANTONIO', puestoNomina: 'Chofer', centro: 'Logística', puestoId: 'chofer-cedis', sucursal: 'CEDIS' },
  { nombre: 'CAZARES NAVARRO JUAN LEONARDO', puestoNomina: 'Auxiliar administrativo', centro: 'Logística', puestoId: 'aux-administrativo-zona', sucursal: 'CEDIS' },
  { nombre: 'GARCIA LOPEZ JUAN FRANCISCO', puestoNomina: 'Encargado de Transportes', centro: 'Logística', puestoId: 'coordinador-logistica', sucursal: 'CEDIS' },
  { nombre: 'GUZMAN HERRERA JUAN MAURILIO', puestoNomina: 'Auxiliar de Chofer', centro: 'Logística', puestoId: 'auxiliar-chofer', sucursal: 'CEDIS' },
  { nombre: 'CORONA REA BRANDON ALEXIS', puestoNomina: 'Auxiliar de Chofer', centro: 'Logística', puestoId: 'auxiliar-chofer', sucursal: 'CEDIS' },
  { nombre: 'GALVAN VILLEGAS JOSE RAUL', puestoNomina: 'Chofer', centro: 'Logística', puestoId: 'chofer-cedis', sucursal: 'CEDIS' },
  { nombre: 'RIZO HERRERA CRISTIAN', puestoNomina: 'Chofer', centro: 'Logística', puestoId: 'chofer-cedis', sucursal: 'CEDIS' },
  { nombre: 'GONZALEZ FARIAS RAFAEL', puestoNomina: 'Chofer', centro: 'Logística', puestoId: 'chofer-cedis', sucursal: 'CEDIS' },
  { nombre: 'JUAREZ HERRERA LUIS FRANCISCO', puestoNomina: 'Auxiliar de Chofer', centro: 'Logística', puestoId: 'auxiliar-chofer', sucursal: 'CEDIS' },
  { nombre: 'MENDEZ CAMARENA CARLOS MIGUEL', puestoNomina: 'Chofer', centro: 'Logística', puestoId: 'chofer-cedis', sucursal: 'CEDIS' },
  { nombre: 'NUÑEZ ALCALA GLORIA ESTER', puestoNomina: 'Cajera RV', centro: 'RV Padre Hidalgo', puestoId: 'cajero-vecinal', sucursal: 'Padre Hidalgo' },
  { nombre: 'SALGADO MORALES MARIA CANDELARIA', puestoNomina: 'Vendedora', centro: 'RV Padre Hidalgo', puestoId: 'vendedor-vecinal', sucursal: 'Padre Hidalgo' },
  { nombre: 'HERRERA HERRERA FELIX ALEJANDRO', puestoNomina: 'Surtidor', centro: 'RV Padre Hidalgo', puestoId: 'surtidor-ventas', sucursal: 'Padre Hidalgo' },
  { nombre: 'VILLALOBOS CAMPOS RAFAEL', puestoNomina: 'Vendedor RV', centro: 'RV Padre Hidalgo', puestoId: 'vendedor-vecinal', sucursal: 'Padre Hidalgo' },
  { nombre: 'RODRIGUEZ RODRIGUEZ DIANA ISABEL', puestoNomina: 'Auxiliar de Contabilidad', centro: 'Contabilidad', puestoId: 'analista-contable', sucursal: 'CONTABILIDAD' },
  { nombre: 'RODRIGUEZ SOLORIO CLAUDIA JANETH', puestoNomina: 'Auxiliar de Contabilidad', centro: 'Contabilidad', puestoId: 'analista-contable', sucursal: 'CONTABILIDAD' },
  { nombre: 'TAFOYA TORRES JOHANNA PALMIRA', puestoNomina: 'Auxiliar contable', centro: 'Contabilidad', puestoId: 'analista-contable', sucursal: 'CONTABILIDAD' },
  { nombre: 'CANO TORRES VANESSA JUDITH', puestoNomina: 'Auxiliar contable', centro: 'Contabilidad', puestoId: 'analista-contable', sucursal: 'CONTABILIDAD' },
  { nombre: 'QUIRINO NAZARIO RAFAEL', puestoNomina: 'Auxiliar de Compras', centro: 'Staff Padre Hidalgo', puestoId: 'analista-ordenes-entrada', sucursal: 'Padre Hidalgo' },
  { nombre: 'ALVARADO RODRIGUEZ REYNA SARAI', puestoNomina: 'Auxiliar MKT', centro: 'Staff Padre Hidalgo', puestoId: 'aux-mercadotecnia-zona', sucursal: 'Padre Hidalgo' },
  { nombre: 'FLORES AGUIRRE VIVIANA GUADALUPE', puestoNomina: 'Implementacion Kepler', centro: 'Staff Padre Hidalgo', puestoId: null, sucursal: 'Padre Hidalgo' },
  { nombre: 'ELIZARRARAS ALANIS JUAN MANUEL', puestoNomina: 'Analista de Abasto de Mercancía', centro: 'Staff Padre Hidalgo', puestoId: 'analista-abastecimiento-comercial', sucursal: 'Padre Hidalgo' },
  { nombre: 'BERBER TOVAR MARIA DOLORES', puestoNomina: 'Cajera', centro: 'Yurécuaro', puestoId: 'cajero-sucursal', sucursal: 'Yurécuaro' },
  { nombre: 'ALVAREZ MONTEJANO YESSICA GUADALUPE', puestoNomina: 'Anaquelista', centro: 'Yurécuaro', puestoId: 'anaquelista', sucursal: 'Yurécuaro' },
  { nombre: 'OLIVARES GONZALEZ MARIA SELENE', puestoNomina: 'Cajera', centro: 'Yurécuaro', puestoId: 'cajero-sucursal', sucursal: 'Yurécuaro' },
  { nombre: 'HERNANDEZ GONZALEZ ANA PATRICIA', puestoNomina: 'Encargado de sucursal', centro: 'Canindo', puestoId: 'encargado-sucursal', sucursal: 'Canindo' },
  { nombre: 'ANTEMATE ZAPO YADIRA DEL ROSARIO', puestoNomina: 'Cajera', centro: 'Canindo', puestoId: 'cajero-sucursal', sucursal: 'Canindo' },
  { nombre: 'FERREYRA JUAREZ JENNIFER', puestoNomina: 'Cajera', centro: 'Canindo', puestoId: 'cajero-sucursal', sucursal: 'Canindo' },
  { nombre: 'CISNEROS GONZALEZ DULCE MARIA', puestoNomina: 'Cajera', centro: 'Canindo', puestoId: 'cajero-sucursal', sucursal: 'Canindo' },
  { nombre: 'LINARES HERNANDEZ JUAN PABLO', puestoNomina: 'Almacenista', centro: 'Canindo', puestoId: 'almacenista-sucursal', sucursal: 'Canindo' },
  { nombre: 'RODRIGUEZ SANCHEZ MIRIAM JUDITH', puestoNomina: 'Anaquelista', centro: 'Canindo', puestoId: 'anaquelista', sucursal: 'Canindo' },
  { nombre: 'VERDUZCO AGUILERA MARIA FERNANDA', puestoNomina: 'Cajera', centro: 'Canindo', puestoId: 'cajero-sucursal', sucursal: 'Canindo' },
  { nombre: 'ZAVALA SERVIN SILVIA', puestoNomina: 'Anaquelista', centro: 'Canindo', puestoId: 'anaquelista', sucursal: 'Canindo' },
  { nombre: 'MEJIA ZARATE ROSALINDA', puestoNomina: 'Anaquelista', centro: 'Canindo', puestoId: 'anaquelista', sucursal: 'Canindo' },
  { nombre: 'CERVANTES RAMIREZ JORGE ISRAEL', puestoNomina: 'Bodeguero', centro: 'Canindo', puestoId: 'bodeguero-sucursal', sucursal: 'Canindo' },
  { nombre: 'MACIEL FUENTES BERTHA PAULINA', puestoNomina: 'Anaquelista', centro: 'Canindo', puestoId: 'anaquelista', sucursal: 'Canindo' },
  { nombre: 'HERNANDEZ GARCIA LUISA RENATA', puestoNomina: 'Anaquelista', centro: 'Canindo', puestoId: 'anaquelista', sucursal: 'Canindo' },
  { nombre: 'HERRERA NAVARRO JUAN CARLOS', puestoNomina: 'Chofer', centro: 'Canindo', puestoId: 'chofer-zona', sucursal: 'Canindo' },
  { nombre: 'GARCIA MEJIA GLORIA PATRICIA', puestoNomina: 'Auxiliar MKT', centro: 'Sfaff Canindo', puestoId: 'aux-mercadotecnia-zona', sucursal: 'Canindo' },
  { nombre: 'HERNANDEZ CUEVAS FERNANDA LIZBETH', puestoNomina: 'Auxiliar de Compras', centro: 'Sfaff Canindo', puestoId: 'analista-ordenes-entrada', sucursal: 'Canindo' },
  { nombre: 'VAZQUEZ ORTIZ LUIS GERARDO', puestoNomina: 'Auxiliar Finanzas', centro: 'Sfaff Canindo', puestoId: 'analista-egresos', sucursal: 'Canindo' },
  { nombre: 'MARTINEZ RAZO FRANCISCO DE JESUS', puestoNomina: 'Supervisor RD', centro: 'RD Canindo', puestoId: 'supervisor-ventas-rd', sucursal: 'Canindo' },
  { nombre: 'CASILLAS GIL FELIPE DE JESUS', puestoNomina: 'Auxiliar administrativo', centro: 'RD Canindo', puestoId: 'aux-administrativo-zona', sucursal: 'Canindo' },
  { nombre: 'ZAVALA VILLALOBOS JOSE DE JESUS', puestoNomina: 'Vendedor RD', centro: 'RD Canindo', puestoId: 'vendedor-rd', sucursal: 'Canindo' },
  { nombre: 'PADILLA ROJANO DANIEL', puestoNomina: 'Vendedor RD', centro: 'RD Canindo', puestoId: 'vendedor-rd', sucursal: 'Canindo' },
  { nombre: 'MUÑOZ MOTA JOSE LUIS', puestoNomina: 'Vendedor de RD', centro: 'RD Canindo', puestoId: 'vendedor-rd', sucursal: 'Canindo' },
  { nombre: 'BOLAÑOS MAGAÑA LAURA PATRICIA', puestoNomina: 'Cajera RD', centro: 'RD Canindo', puestoId: 'cajero-rd', sucursal: 'Canindo' },
  { nombre: 'ZALAPA BARRIGA VICTOR MANUEL', puestoNomina: 'Vendedor RD', centro: 'RD Canindo', puestoId: 'vendedor-rd', sucursal: 'Canindo' },
  { nombre: 'AYALA HERRERA DIEGO LISANDRO', puestoNomina: 'Surtidor', centro: 'Tlmkt Canindo', puestoId: 'surtidor-zona', sucursal: 'Canindo' },
  { nombre: 'ESPINOZA ALCARAZ JUAN MANUEL', puestoNomina: 'Supervisor Tlmkt', centro: 'Tlmkt Canindo', puestoId: 'coordinador-operaciones-zona', sucursal: 'Canindo' },
  { nombre: 'FRANCO MARTINEZ DANIEL FRANCISCO', puestoNomina: 'Vendedor de Telemarketing', centro: 'Tlmkt Canindo', puestoId: 'vendedor-mayoreo', sucursal: 'Canindo' },
  { nombre: 'GARCIA MEJIA MARIA DEL CARMEN', puestoNomina: 'Facturación', centro: 'Tlmkt Canindo', puestoId: 'facturacion', sucursal: 'Canindo' },
  { nombre: 'RIOS CISNEROS ANA GABRIELA', puestoNomina: 'Checadora', centro: 'Tlmkt Canindo', puestoId: 'checador', sucursal: 'Canindo' },
  { nombre: 'CASAS MENDOZA CESAR', puestoNomina: 'Auxiliar de Chofer', centro: 'Tlmkt Canindo', puestoId: 'auxiliar-chofer', sucursal: 'Canindo' },
  { nombre: 'GONZALEZ AYALA OSCAR DANIEL', puestoNomina: 'Surtidor', centro: 'Tlmkt Canindo', puestoId: 'surtidor-zona', sucursal: 'Canindo' },
  { nombre: 'MEDINA ESPINOZA MANUEL', puestoNomina: 'Auxiliar de Chofer', centro: 'Tlmkt Canindo', puestoId: 'auxiliar-chofer', sucursal: 'Canindo' },
  { nombre: 'CISNEROS OROZCO ANDRES', puestoNomina: 'Surtidor', centro: 'Tlmkt Canindo', puestoId: 'surtidor-zona', sucursal: 'Canindo' },
  { nombre: 'CHAVERO NIÑO JHAROL STED', puestoNomina: 'Auxiliar de Chofer', centro: 'Tlmkt Canindo', puestoId: 'auxiliar-chofer', sucursal: 'Canindo' },
  { nombre: 'SANCHEZ LEAL TANIA YAZMIN', puestoNomina: 'Auxiliar de Encargado', centro: 'Damaso', puestoId: 'auxiliar-encargado', sucursal: null },
  { nombre: 'GARCIA MEJIA CECILIA DEL PILAR', puestoNomina: 'Auxiliar de Encargado', centro: 'Damaso', puestoId: 'auxiliar-encargado', sucursal: null },
  { nombre: 'CISNEROS ZAVALA BRALLAN', puestoNomina: 'Almacenista', centro: 'Damaso', puestoId: 'almacenista-sucursal', sucursal: null },
  { nombre: 'MOLINA ESPINOZA BLANCA SOFIA', puestoNomina: 'Cajera', centro: 'Damaso', puestoId: 'cajero-sucursal', sucursal: null },
  { nombre: 'SOTO MARTINEZ ROGELIO', puestoNomina: 'Anaquelista', centro: 'Damaso', puestoId: 'anaquelista', sucursal: null },
  { nombre: 'CORTES MOLINA DIANA ROCIO', puestoNomina: 'Vendedor de RD', centro: 'Damaso', puestoId: 'vendedor-rd', sucursal: null },
  { nombre: 'REYES RAMIREZ JUAN LUIS', puestoNomina: 'Chofer', centro: 'Damaso', puestoId: 'chofer-zona', sucursal: null },
  { nombre: 'ARREDONDO MORENO EDITH', puestoNomina: 'Cajera', centro: 'Damaso', puestoId: 'cajero-sucursal', sucursal: null },
];

/**
 * La nómina con las correcciones ya encimadas. ES LA QUE HAY QUE USAR.
 *
 * `NOMINA_PUESTOS` es el PDF tal cual, y se conserva sin tocar para poder
 * auditar qué decía el documento. Lo que se aplica sale de aquí.
 */
export function nominaEfectiva(): FilaNomina[] {
  const delPdf = NOMINA_PUESTOS.map(f => {
    // La sucursal solo se rellena si el documento la dejo vacia: lo que el PDF
    // ya resolvio manda sobre el mapa de centros.
    const suc = f.sucursal || sucursalPorCentro(f.centro);
    const base = suc === f.sucursal ? f : { ...f, sucursal: suc };

    const c = correccionDe(f.nombre);
    if (!c) return base;
    return { ...base, puestoId: c.puestoId, corregido: `${c.motivo} (${c.quien})` };
  });

  // Las altas manuales van al final, marcadas para que se vea que no salieron
  // del PDF sino que alguien las agregó.
  const aMano: FilaNomina[] = ALTAS_MANUALES.map(a => ({
    nombre: a.nombre,
    puestoNomina: '(alta manual)',
    centro: 'alta manual',
    puestoId: a.puestoId,
    sucursal: a.sucursal,
    corregido: `${a.motivo} (${a.quien})`,
  }));

  return [...delPdf, ...aMano];
}

/** Cuántas filas traen puesto del organigrama (ya corregidas). */
export function nominaConPuesto(): number {
  return nominaEfectiva().filter(f => !!f.puestoId).length;
}

/** Las filas que quedaron sin puesto, para poder reportarlas. */
export function nominaSinPuesto(): FilaNomina[] {
  return nominaEfectiva().filter(f => !f.puestoId);
}
