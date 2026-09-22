/**
 * 🏛️ CATÁLOGO DE PUESTOS — ORGANIGRAMA 2026
 *
 * Transcripción del organigrama corporativo vigente (ORGANIGRAMA 2026). Es la
 * ÚNICA fuente de verdad de qué puestos existen en la empresa.
 *
 * ¿Por qué vive en código y no en la base de datos?
 * ---------------------------------------------------
 * Porque el organigrama y los manuales son DOCUMENTOS CONTROLADOS: cambian por
 * autorización de Dirección y Capital Humano, con una nueva versión firmada, no
 * porque alguien mueva algo desde una pantalla. Tenerlo en código garantiza que
 * nadie pueda inventar un puesto ni renombrarlo desde la app, y que el cambio
 * quede en el historial de git junto a la versión del organigrama que lo motivó.
 *
 * OJO con los ids: son la llave que amarra usuario -> puesto -> tareas del
 * manual. Un id ya publicado NO se renombra (dejaría a esa gente sin sus
 * tareas). Si un puesto desaparece del organigrama se marca `vigente: false` y
 * se conserva.
 *
 * El organigrama lista el mismo puesto muchas veces (hay Anaquelistas en ocho
 * sucursales). Aquí cada puesto aparece UNA vez: la sucursal o zona concreta
 * sale de los campos `sucursales`/`areas` del usuario, no del catálogo.
 */

/** Bloque de primer nivel del organigrama, para agrupar en las pantallas. */
export type UnidadOrganigrama =
  | 'direccion'
  | 'zona'                  // Gerencias de Zona: La Piedad, Morelia, Zamora,
                            // Padre Hidalgo y Yurecuaro. Son CINCO. Aqui decia
                            // solo las tres primeras, y esa lista incompleta hizo
                            // que el filtro de zonas naciera sin las otras dos
                            // (corregido por David el 2026-08-31).
  | 'staff-zona'
  | 'ventas'
  | 'sucursal'
  | 'operaciones-zona'
  | 'cedis'
  | 'administrativa'
  | 'capital-humano'
  | 'comercial-marketing'
  | 'sistemas';

/**
 * Nivel de mando. Se usa para ordenar y para saber a quién se escala; NO para
 * permisos (esos siguen viviendo en el rol del usuario).
 */
export type NivelPuesto =
  | 'direccion'
  | 'gerencia'
  | 'jefatura'
  | 'coordinacion'
  | 'supervision'
  | 'operativo'
  | 'practicante';

export interface PuestoOrganigrama {
  /** Llave estable. No se renombra nunca una vez publicada. */
  id: string;
  /** Nombre como aparece en el organigrama. */
  nombre: string;
  unidad: UnidadOrganigrama;
  nivel: NivelPuesto;
  /** Id del puesto al que reporta (null en Dirección General). */
  reportaA: string | null;
  /**
   * Cargos históricos con los que este puesto pudo haberse capturado antes de
   * que existiera el catálogo. Sirven para migrar sin volver a teclear a nadie
   * (ver `resolverPuesto()` en puesto.util.ts). Se comparan normalizados.
   */
  aliasCargos?: string[];
  /** Un puesto retirado del organigrama se marca aquí; no se borra. */
  vigente?: boolean;
}

export const PUESTOS_ORGANIGRAMA: PuestoOrganigrama[] = [
  // ============================ DIRECCIÓN =================================
  { id: 'direccion-general', nombre: 'Dirección General', unidad: 'direccion', nivel: 'direccion', reportaA: null,
    aliasCargos: ['Director General'] },

  // ======================== GERENCIAS DE ZONA =============================
  // Una sola entrada para las tres zonas (La Piedad, Morelia, Zamora): la zona
  // concreta la da la sucursal o el área del usuario.
  { id: 'gerencia-zona', nombre: 'Gerencia de Zona', unidad: 'zona', nivel: 'gerencia', reportaA: 'direccion-general',
    aliasCargos: ['Jefe de zona', 'Jefe Regional', 'Jefatura de Zona', 'Gerente de Zona'] },

  // ==================== STAFF ADMINISTRATIVO DE ZONA ======================
  { id: 'aux-mercadotecnia-zona', nombre: 'Auxiliar de Mercadotecnia de Zona', unidad: 'staff-zona', nivel: 'operativo', reportaA: 'gerencia-zona',
    aliasCargos: ['Aux Mercadotecnia', 'Auxiliar de mercadotecnia'] },
  { id: 'aux-caja-general-zona', nombre: 'Auxiliar de Caja General de Zona', unidad: 'staff-zona', nivel: 'operativo', reportaA: 'gerencia-zona',
    aliasCargos: ['Aux Caja general', 'Auxiliar Caja General'] },
  { id: 'aux-administrativo-zona', nombre: 'Auxiliar Administrativo de Zona', unidad: 'staff-zona', nivel: 'operativo', reportaA: 'gerencia-zona',
    aliasCargos: ['Aux Administrativo', 'Auxiliar Administrativo'] },
  { id: 'analista-abastecimiento-regional', nombre: 'Analista Regional de Abastecimiento Comercial', unidad: 'staff-zona', nivel: 'operativo', reportaA: 'gerencia-zona',
    aliasCargos: ['Analista de abastecimiento comercial regional'] },
  { id: 'promotora', nombre: 'Promotora', unidad: 'staff-zona', nivel: 'operativo', reportaA: 'gerencia-zona',
    aliasCargos: ['Promotoras'] },

  // ============================== VENTAS ==================================
  { id: 'supervisor-ventas-rd', nombre: 'Supervisor de Ventas Ruta Directa', unidad: 'ventas', nivel: 'supervision', reportaA: 'gerencia-zona',
    aliasCargos: ['Supervisor de Ventas RD', 'Supervisor RD'] },
  { id: 'supervisor-ventas-vecinal', nombre: 'Supervisor de Ventas Vecinal', unidad: 'ventas', nivel: 'supervision', reportaA: 'gerencia-zona',
    aliasCargos: ['Supervisor Vecinal'] },
  { id: 'vendedor-rd', nombre: 'Vendedor Ruta Directa', unidad: 'ventas', nivel: 'operativo', reportaA: 'supervisor-ventas-rd',
    aliasCargos: ['Vendedor RD', 'Vendedores RD'] },
  { id: 'vendedor-vecinal', nombre: 'Vendedor Vecinal', unidad: 'ventas', nivel: 'operativo', reportaA: 'supervisor-ventas-vecinal',
    aliasCargos: ['Vendedores Vecinal', 'Vendedor de Vecinal'] },
  { id: 'vendedor-suplente', nombre: 'Vendedor Suplente', unidad: 'ventas', nivel: 'operativo', reportaA: 'supervisor-ventas-rd',
    aliasCargos: ['Vendedores Suplente'] },
  { id: 'vendedor-mayoreo', nombre: 'Vendedor Mayoreo', unidad: 'ventas', nivel: 'operativo', reportaA: 'gerencia-zona',
    aliasCargos: ['Vendedores Mayoreo', 'Vendedor de Mayoreo'] },
  { id: 'ejecutivo-trade-marketing', nombre: 'Ejecutivo de Trade Marketing', unidad: 'ventas', nivel: 'operativo', reportaA: 'supervisor-ventas-rd' },
  { id: 'cajero-rd', nombre: 'Cajero Ruta Directa', unidad: 'ventas', nivel: 'operativo', reportaA: 'supervisor-ventas-rd',
    aliasCargos: ['Cajero RD'] },
  { id: 'cajero-vecinal', nombre: 'Cajero Vecinal', unidad: 'ventas', nivel: 'operativo', reportaA: 'supervisor-ventas-vecinal' },
  { id: 'surtidor-ventas', nombre: 'Surtidor de Ventas', unidad: 'ventas', nivel: 'operativo', reportaA: 'supervisor-ventas-rd' },
  { id: 'repartidor-vecinal', nombre: 'Repartidor Vecinal', unidad: 'ventas', nivel: 'operativo', reportaA: 'supervisor-ventas-vecinal' },

  // ============================= SUCURSAL =================================
  { id: 'encargado-sucursal', nombre: 'Encargado(a) de Sucursal', unidad: 'sucursal', nivel: 'coordinacion', reportaA: 'gerencia-zona',
    aliasCargos: ['Encargado(a) de tienda', 'Encargada de Sucursal', 'Encargado de Sucursal'] },
  { id: 'auxiliar-encargado', nombre: 'Auxiliar de Encargado', unidad: 'sucursal', nivel: 'operativo', reportaA: 'encargado-sucursal' },
  { id: 'almacenista-sucursal', nombre: 'Almacenista de Sucursal', unidad: 'sucursal', nivel: 'operativo', reportaA: 'encargado-sucursal',
    aliasCargos: ['Almacenista', 'Encargada de operaciones y almacén'] },
  { id: 'bodeguero-sucursal', nombre: 'Bodeguero de Sucursal', unidad: 'sucursal', nivel: 'operativo', reportaA: 'encargado-sucursal',
    aliasCargos: ['Bodeguero'] },
  { id: 'anaquelista', nombre: 'Anaquelista de Sucursal', unidad: 'sucursal', nivel: 'operativo', reportaA: 'encargado-sucursal',
    aliasCargos: ['Anaquelista'] },
  { id: 'cajero-sucursal', nombre: 'Cajero(a) de Sucursal', unidad: 'sucursal', nivel: 'operativo', reportaA: 'encargado-sucursal',
    aliasCargos: ['Cajera', 'Cajero', 'Auxiliar de cajas'] },
  { id: 'coordinador-cajas', nombre: 'Coordinador de Cajas', unidad: 'sucursal', nivel: 'coordinacion', reportaA: 'encargado-sucursal' },
  { id: 'coordinador-piso-ventas', nombre: 'Coordinador de Piso de Ventas', unidad: 'sucursal', nivel: 'coordinacion', reportaA: 'encargado-sucursal',
    aliasCargos: ['Coordinador Piso de ventas'] },
  { id: 'vendedora-piso', nombre: 'Vendedora de Piso', unidad: 'sucursal', nivel: 'operativo', reportaA: 'encargado-sucursal',
    aliasCargos: ['Vendedoras de Piso'] },
  { id: 'surtidor-sucursal', nombre: 'Surtidor de Sucursal', unidad: 'sucursal', nivel: 'operativo', reportaA: 'encargado-sucursal' },
  { id: 'multifuncional', nombre: 'Multifuncional', unidad: 'sucursal', nivel: 'operativo', reportaA: 'encargado-sucursal' },
  // KILEADORA — declarada el 22/sep/2026 por instrucción de David.
  //
  // El puesto NO EXISTÍA como dato y la operación sí: lo único que había en
  // todo el repo era la palabra `kileado`, en el vocabulario del dictado por
  // voz (`api/transcribir.js`). Medido antes de declararlo: 0 apariciones en
  // el organigrama, 0 en la nómina de agosto y 0 de las 149 fichas activas.
  //
  // Los alias existen porque la ficha se captura a mano: `resolverPuesto` cruza
  // por `cargo` de texto libre cuando no hay `puestoId`, y sin ellos una ficha
  // que diga «Kileadora» no emparejaría con nada y esa persona se quedaría sin
  // tareas EN SILENCIO, que es el hallazgo 1 de este proyecto.
  { id: 'kileadora', nombre: 'Kileadora de Sucursal', unidad: 'sucursal', nivel: 'operativo', reportaA: 'encargado-sucursal',
    aliasCargos: ['Kileadora', 'Kileador', 'Kileadoras', 'Kileadores'] },
  { id: 'recepcion-mercancia-sucursal', nombre: 'Recepción de Mercancía de Sucursal', unidad: 'sucursal', nivel: 'operativo', reportaA: 'encargado-sucursal' },
  { id: 'vigilancia', nombre: 'Vigilancia', unidad: 'sucursal', nivel: 'operativo', reportaA: 'encargado-sucursal' },
  { id: 'intendencia', nombre: 'Intendencia', unidad: 'sucursal', nivel: 'operativo', reportaA: 'encargado-sucursal' },

  // ==================== OPERACIONES DE ZONA (TLMK) ========================
  // Los tres ultimos alias son como le dicen en la empresa (David, 2026-08-29).
  // El comentario va AQUI y no dentro del arreglo: dentro, corta los bloques de
  // los scripts que leen este archivo y la comprobacion de colisiones da un
  // falso negativo justo sobre lo que se acaba de agregar.
  { id: 'coordinador-operaciones-zona', nombre: 'Coordinador de Operaciones de Zona', unidad: 'operaciones-zona', nivel: 'coordinacion', reportaA: 'gerencia-zona',
    aliasCargos: ['Supervisor Operativo TLMK', 'Coordinador de Operaciones',
                  'Encargado de TLMK', 'Encargado TLMK', 'Supervisor Tlmkt'] },
  { id: 'recepcion-mercancia-zona', nombre: 'Recepción de Mercancía de Zona', unidad: 'operaciones-zona', nivel: 'operativo', reportaA: 'coordinador-operaciones-zona' },
  { id: 'empaque', nombre: 'Empaque', unidad: 'operaciones-zona', nivel: 'operativo', reportaA: 'coordinador-operaciones-zona' },
  { id: 'surtidor-zona', nombre: 'Surtidor de Zona', unidad: 'operaciones-zona', nivel: 'operativo', reportaA: 'coordinador-operaciones-zona' },
  { id: 'checador', nombre: 'Checador', unidad: 'operaciones-zona', nivel: 'operativo', reportaA: 'coordinador-operaciones-zona',
    aliasCargos: ['Checadora'] },
  { id: 'embarques', nombre: 'Embarques', unidad: 'operaciones-zona', nivel: 'operativo', reportaA: 'coordinador-operaciones-zona' },
  { id: 'facturacion', nombre: 'Facturación', unidad: 'operaciones-zona', nivel: 'operativo', reportaA: 'coordinador-operaciones-zona',
    aliasCargos: ['Analista de Facturación', 'Analista de Facturación y Control Documental'] },
  { id: 'chofer-zona', nombre: 'Chofer de Zona', unidad: 'operaciones-zona', nivel: 'operativo', reportaA: 'coordinador-operaciones-zona' },
  { id: 'aux-reparto', nombre: 'Auxiliar de Reparto', unidad: 'operaciones-zona', nivel: 'operativo', reportaA: 'coordinador-operaciones-zona',
    aliasCargos: ['Aux Reparto'] },

  // ============= JEFATURA CEDIS Y OPERACIONES LOGÍSTICAS ==================
  { id: 'jefatura-cedis', nombre: 'Jefatura de CEDIS y Operaciones Logísticas', unidad: 'cedis', nivel: 'jefatura', reportaA: 'direccion-general',
    aliasCargos: ['Jefatura CEDIS', 'Jefe de CEDIS'] },
  { id: 'encargado-almacen-cedis', nombre: 'Encargado de Almacén CEDIS', unidad: 'cedis', nivel: 'coordinacion', reportaA: 'jefatura-cedis',
    aliasCargos: ['Encargado de Almacén'] },
  { id: 'auxiliar-cedis', nombre: 'Auxiliar de CEDIS', unidad: 'cedis', nivel: 'operativo', reportaA: 'jefatura-cedis' },
  { id: 'surtidor-cedis', nombre: 'Surtidor CEDIS', unidad: 'cedis', nivel: 'operativo', reportaA: 'encargado-almacen-cedis' },
  { id: 'checador-cedis', nombre: 'Checador CEDIS', unidad: 'cedis', nivel: 'operativo', reportaA: 'encargado-almacen-cedis',
    aliasCargos: ['Checador de CEDIS'] },
  { id: 'almacenista-cedis', nombre: 'Almacenista CEDIS', unidad: 'cedis', nivel: 'operativo', reportaA: 'encargado-almacen-cedis' },
  { id: 'recepcion-producto-cedis', nombre: 'Recepción de Producto CEDIS', unidad: 'cedis', nivel: 'operativo', reportaA: 'encargado-almacen-cedis' },
  { id: 'entradas-salidas-cedis', nombre: 'Entradas y Salidas de Almacén CEDIS', unidad: 'cedis', nivel: 'operativo', reportaA: 'encargado-almacen-cedis' },
  { id: 'facturacion-cedis', nombre: 'Facturación CEDIS', unidad: 'cedis', nivel: 'operativo', reportaA: 'encargado-almacen-cedis' },
  { id: 'coordinador-logistica', nombre: 'Coordinador de Logística', unidad: 'cedis', nivel: 'coordinacion', reportaA: 'jefatura-cedis' },
  { id: 'aux-administrativo-logistica', nombre: 'Auxiliar Administrativo de Logística', unidad: 'cedis', nivel: 'operativo', reportaA: 'coordinador-logistica' },
  { id: 'aux-logistica-flotilla', nombre: 'Auxiliar de Logística – Flotilla', unidad: 'cedis', nivel: 'operativo', reportaA: 'coordinador-logistica' },
  { id: 'chofer-cedis', nombre: 'Chofer', unidad: 'cedis', nivel: 'operativo', reportaA: 'coordinador-logistica' },
  { id: 'auxiliar-chofer', nombre: 'Auxiliar de Chofer', unidad: 'cedis', nivel: 'operativo', reportaA: 'coordinador-logistica',
    aliasCargos: ['Auxiliares de Chofer'] },
  { id: 'repartidor-cedis', nombre: 'Repartidor', unidad: 'cedis', nivel: 'operativo', reportaA: 'coordinador-logistica' },

  // ============= GERENCIA ADMINISTRATIVA Y FINANCIERA =====================
  { id: 'gerencia-admin-financiera', nombre: 'Gerencia Administrativa y Financiera', unidad: 'administrativa', nivel: 'gerencia', reportaA: 'direccion-general',
    aliasCargos: ['Administrador Megadulces', 'Jefatura Finanzas'] },
  { id: 'encargado-contabilidad', nombre: 'Encargado de Contabilidad', unidad: 'administrativa', nivel: 'coordinacion', reportaA: 'gerencia-admin-financiera',
    aliasCargos: ['Coordinador Contabilidad'] },
  { id: 'analista-contable', nombre: 'Analista Contable', unidad: 'administrativa', nivel: 'operativo', reportaA: 'encargado-contabilidad',
    aliasCargos: ['Auxiliar de Contabilidad'] },
  { id: 'jefe-tesoreria', nombre: 'Jefe de Tesorería', unidad: 'administrativa', nivel: 'jefatura', reportaA: 'gerencia-admin-financiera',
    aliasCargos: ['Jefatura Tesorería'] },
  { id: 'credito-cobranza', nombre: 'Crédito y Cobranza', unidad: 'administrativa', nivel: 'operativo', reportaA: 'jefe-tesoreria' },
  { id: 'analista-ingresos', nombre: 'Analista de Ingresos', unidad: 'administrativa', nivel: 'operativo', reportaA: 'jefe-tesoreria' },
  { id: 'caja-general', nombre: 'Caja General', unidad: 'administrativa', nivel: 'operativo', reportaA: 'jefe-tesoreria' },
  { id: 'practicante-caja-general', nombre: 'Practicante Administrativo de Caja General', unidad: 'administrativa', nivel: 'practicante', reportaA: 'caja-general' },
  { id: 'analista-egresos', nombre: 'Analista de Egresos', unidad: 'administrativa', nivel: 'operativo', reportaA: 'jefe-tesoreria',
    aliasCargos: ['Auxiliar Finanzas'] },
  { id: 'presupuestos-compras-corporativas', nombre: 'Presupuestos y Compras Corporativas', unidad: 'administrativa', nivel: 'operativo', reportaA: 'gerencia-admin-financiera' },
  { id: 'coordinacion-auditoria-prevencion', nombre: 'Coordinación de Auditoría Operativa y Prevención de Pérdidas', unidad: 'administrativa', nivel: 'coordinacion', reportaA: 'gerencia-admin-financiera',
    aliasCargos: ['Coordinador de Prevención', 'Auditoría Interna', 'Coordinadora de Auditoría y Prevención'] },
  { id: 'auxiliar-auditoria-prevencion', nombre: 'Auxiliar de Auditoría y Prevención', unidad: 'administrativa', nivel: 'operativo', reportaA: 'coordinacion-auditoria-prevencion',
    aliasCargos: ['Auxiliar de Prevención', 'Auxiliar Prevención'] },
  { id: 'encargado-activos-insumos', nombre: 'Encargado de Activos e Insumos', unidad: 'administrativa', nivel: 'operativo', reportaA: 'gerencia-admin-financiera' },
  { id: 'jefe-mantenimiento', nombre: 'Jefe de Mantenimiento', unidad: 'administrativa', nivel: 'jefatura', reportaA: 'gerencia-admin-financiera',
    aliasCargos: ['Jefe Mantenimiento'] },

  // ===================== JEFATURA CAPITAL HUMANO ==========================
  { id: 'jefatura-capital-humano', nombre: 'Jefatura de Capital Humano', unidad: 'capital-humano', nivel: 'jefatura', reportaA: 'direccion-general',
    aliasCargos: ['Jefatura RRHH'] },
  { id: 'servicios-al-personal', nombre: 'Servicios al Personal', unidad: 'capital-humano', nivel: 'operativo', reportaA: 'jefatura-capital-humano',
    aliasCargos: ['Auxiliar RRHH'] },
  { id: 'practicante-control-documental-rh', nombre: 'Practicante de Control Documental de RH', unidad: 'capital-humano', nivel: 'practicante', reportaA: 'servicios-al-personal' },
  { id: 'reclutamiento-onboarding', nombre: 'Reclutamiento y Onboarding', unidad: 'capital-humano', nivel: 'operativo', reportaA: 'jefatura-capital-humano' },
  { id: 'practicante-atraccion-talento', nombre: 'Practicante de Atracción de Talento y Selección', unidad: 'capital-humano', nivel: 'practicante', reportaA: 'reclutamiento-onboarding' },

  // ================= DIRECCIÓN COMERCIAL Y MARKETING ======================
  { id: 'direccion-comercial-marketing', nombre: 'Dirección Comercial y Marketing', unidad: 'comercial-marketing', nivel: 'direccion', reportaA: 'direccion-general' },
  { id: 'coordinacion-compras', nombre: 'Coordinación de Compras', unidad: 'comercial-marketing', nivel: 'coordinacion', reportaA: 'direccion-comercial-marketing',
    aliasCargos: ['Jefatura Compras', 'Jefa de Compras', 'Jefe de Compras'] },
  { id: 'analista-catalogo-productos', nombre: 'Analista de Catálogo de Productos', unidad: 'comercial-marketing', nivel: 'operativo', reportaA: 'coordinacion-compras' },
  { id: 'analista-ordenes-entrada', nombre: 'Analista de Órdenes de Entrada', unidad: 'comercial-marketing', nivel: 'operativo', reportaA: 'coordinacion-compras',
    aliasCargos: ['Auxiliar Compras'] },
  { id: 'analista-abastecimiento-comercial', nombre: 'Analista de Abastecimiento Comercial', unidad: 'comercial-marketing', nivel: 'operativo', reportaA: 'coordinacion-compras' },
  { id: 'jefe-marketing', nombre: 'Jefe de Marketing', unidad: 'comercial-marketing', nivel: 'jefatura', reportaA: 'direccion-comercial-marketing',
    aliasCargos: ['Jefatura MKT'] },
  { id: 'trade-marketing', nombre: 'Trade Marketing', unidad: 'comercial-marketing', nivel: 'operativo', reportaA: 'jefe-marketing' },
  { id: 'inteligencia-comercial', nombre: 'Inteligencia Comercial', unidad: 'comercial-marketing', nivel: 'operativo', reportaA: 'direccion-comercial-marketing' },
  { id: 'coordinador-marketing-digital', nombre: 'Coordinador de Marketing Digital y Ecommerce', unidad: 'comercial-marketing', nivel: 'coordinacion', reportaA: 'jefe-marketing',
    aliasCargos: ['Coordinador MKT', 'Coordinación de Branding y Ecommerce'] },
  { id: 'practicante-produccion-audiovisual', nombre: 'Practicante de Producción Audiovisual', unidad: 'comercial-marketing', nivel: 'practicante', reportaA: 'coordinador-marketing-digital',
    aliasCargos: ['Productora de Contenido Multimedia'] },
  { id: 'practicante-diseno-grafico', nombre: 'Practicante de Diseño Gráfico y Marca', unidad: 'comercial-marketing', nivel: 'practicante', reportaA: 'coordinador-marketing-digital',
    aliasCargos: ['Diseñadora Practicante'] },

  // ========= JEFATURA SISTEMAS Y TRANSFORMACIÓN DIGITAL ===================
  { id: 'jefatura-sistemas', nombre: 'Jefatura de Sistemas y Transformación Digital', unidad: 'sistemas', nivel: 'jefatura', reportaA: 'direccion-general',
    aliasCargos: ['Jefatura Sistemas'] },
  { id: 'infraestructura-seguridad', nombre: 'Infraestructura y Seguridad', unidad: 'sistemas', nivel: 'operativo', reportaA: 'jefatura-sistemas',
    aliasCargos: ['Sistemas'] },
  { id: 'full-stack-developer', nombre: 'Full Stack Developer', unidad: 'sistemas', nivel: 'operativo', reportaA: 'jefatura-sistemas' },
];

/** Etiquetas humanas de las unidades, para agrupar los selectores. */
export const ETIQUETAS_UNIDAD: Record<UnidadOrganigrama, string> = {
  'direccion':            'DIRECCIÓN GENERAL',
  'zona':                 'GERENCIAS DE ZONA',
  'staff-zona':           'STAFF ADMINISTRATIVO DE ZONA',
  'ventas':               'VENTAS (RUTA DIRECTA / VECINAL / MAYOREO)',
  'sucursal':             'SUCURSAL',
  'operaciones-zona':     'OPERACIONES DE ZONA',
  'cedis':                'CEDIS Y OPERACIONES LOGÍSTICAS',
  'administrativa':       'ADMINISTRATIVA Y FINANCIERA',
  'capital-humano':       'CAPITAL HUMANO',
  'comercial-marketing':  'COMERCIAL Y MARKETING',
  'sistemas':             'SISTEMAS Y TRANSFORMACIÓN DIGITAL',
};

/** Orden en que se pintan las unidades (el del organigrama, no alfabético). */
export const ORDEN_UNIDADES: UnidadOrganigrama[] = [
  'direccion', 'zona', 'staff-zona', 'ventas', 'sucursal', 'operaciones-zona',
  'cedis', 'administrativa', 'capital-humano', 'comercial-marketing', 'sistemas',
];

/** Busca un puesto por su id. */
export function puestoPorId(id: string | undefined | null): PuestoOrganigrama | null {
  if (!id) return null;
  return PUESTOS_ORGANIGRAMA.find(p => p.id === id) || null;
}

/** Nombre del puesto, o el id crudo si el catálogo ya no lo tiene. */
export function nombrePuesto(id: string | undefined | null): string {
  return puestoPorId(id)?.nombre || (id || '');
}

/** Los puestos vigentes agrupados por unidad, en el orden del organigrama. */
export function puestosPorUnidad(): { unidad: UnidadOrganigrama; etiqueta: string; puestos: PuestoOrganigrama[] }[] {
  return ORDEN_UNIDADES.map(unidad => ({
    unidad,
    etiqueta: ETIQUETAS_UNIDAD[unidad],
    puestos: PUESTOS_ORGANIGRAMA.filter(p => p.unidad === unidad && p.vigente !== false),
  })).filter(g => g.puestos.length > 0);
}

// ============================================================================
//  🔺 LA PIRÁMIDE: el organigrama como árbol, desde `reportaA`
// ============================================================================

/** Un puesto con lo que le reporta. `profundidad` 0 es la raíz. */
export interface NodoOrganigrama {
  puesto: PuestoOrganigrama;
  profundidad: number;
  hijos: NodoOrganigrama[];
}

/**
 * El organigrama como árbol, armado desde `reportaA`.
 *
 * ─── NADIE SE PIERDE, NUNCA ─────────────────────────────────────────────────
 * Un árbol construido a la ligera pierde gente en silencio, y ése es justo el
 * modo de fallo que no se nota: un puesto cuyo `reportaA` apunta a un id que ya
 * no existe simplemente deja de dibujarse, y con él toda su rama. Nadie lo
 * reclama porque nadie sabe que debía estar.
 *
 * Aquí eso no puede pasar. Se recorre desde las raíces y, al final, **todo
 * puesto que no haya sido visitado se agrega como raíz** — sea porque su jefe
 * no existe o porque quedó en un ciclo. Sale feo y arriba, que es exactamente
 * como debe salir un dato roto: visible.
 *
 * Medido el 1/sep/2026 sobre los 89 puestos: 1 raíz (`direccion-general`),
 * 0 `reportaA` rotos, 0 ciclos, profundidad máxima 4. Si algún día eso deja de
 * ser cierto, `puestosFueraDelArbol()` lo dice sin que nadie tenga que mirar.
 */
export function arbolOrganigrama(incluirRetirados = false): NodoOrganigrama[] {
  const puestos = PUESTOS_ORGANIGRAMA.filter(p => incluirRetirados || p.vigente !== false);
  const porId = new Map(puestos.map(p => [p.id, p]));

  const hijosDe = new Map<string, PuestoOrganigrama[]>();
  for (const p of puestos) {
    // Un `reportaA` que no resuelve NO se hereda al vacío: el puesto pasa a ser
    // raíz. Perderlo sería peor que enseñarlo fuera de lugar.
    const jefe = p.reportaA && porId.has(p.reportaA) ? p.reportaA : null;
    if (!jefe) continue;
    const arr = hijosDe.get(jefe) || [];
    arr.push(p);
    hijosDe.set(jefe, arr);
  }

  const visitados = new Set<string>();
  const construir = (p: PuestoOrganigrama, profundidad: number): NodoOrganigrama => {
    visitados.add(p.id);
    const hijos = (hijosDe.get(p.id) || [])
      // La guardia contra ciclos: un hijo ya visitado no se vuelve a descender.
      // Sin esto un `reportaA` circular cuelga el navegador, no da error.
      .filter(h => !visitados.has(h.id))
      .sort(compararHermanos)
      .map(h => construir(h, profundidad + 1));
    return { puesto: p, profundidad, hijos };
  };

  const raices = puestos
    .filter(p => !p.reportaA || !porId.has(p.reportaA))
    .sort(compararHermanos);
  const arbol = raices.map(r => construir(r, 0));

  // Lo que quedó fuera (solo puede ser un ciclo) se agrega arriba, visible.
  for (const p of puestos) {
    if (!visitados.has(p.id)) arbol.push(construir(p, 0));
  }
  return arbol;
}

/**
 * Los puestos que NO cuelgan limpiamente de la raíz: `reportaA` roto o ciclo.
 * Hoy son cero. Existe para que el día que dejen de serlo se sepa por un número
 * y no porque alguien note que a una rama le falta gente.
 */
export function puestosFueraDelArbol(): { id: string; motivo: string }[] {
  const puestos = PUESTOS_ORGANIGRAMA.filter(p => p.vigente !== false);
  const porId = new Map(puestos.map(p => [p.id, p]));
  const fuera: { id: string; motivo: string }[] = [];
  for (const p of puestos) {
    if (!p.reportaA) continue;                       // raíz legítima
    if (!porId.has(p.reportaA)) {
      fuera.push({ id: p.id, motivo: 'reportaA apunta a ' + p.reportaA + ', que no existe' });
      continue;
    }
    let cur: PuestoOrganigrama | undefined = p;
    const visto = new Set<string>();
    while (cur && cur.reportaA) {
      if (visto.has(cur.id)) { fuera.push({ id: p.id, motivo: 'ciclo de reportaA' }); break; }
      visto.add(cur.id);
      cur = porId.get(cur.reportaA);
    }
  }
  return fuera;
}

/**
 * Orden entre hermanos: primero el que manda.
 *
 * `nivel` viene del catálogo y es lo que hace que la pirámide se lea como
 * pirámide y no como una lista: dentro de una misma rama, la coordinación va
 * antes que el operativo aunque alfabéticamente sea al revés.
 */
const PESO_NIVEL: Record<NivelPuesto, number> = {
  'direccion': 0, 'gerencia': 1, 'jefatura': 2, 'coordinacion': 3,
  'supervision': 4, 'operativo': 5, 'practicante': 6,
};

function compararHermanos(a: PuestoOrganigrama, b: PuestoOrganigrama): number {
  const pa = PESO_NIVEL[a.nivel] ?? 9;
  const pb = PESO_NIVEL[b.nivel] ?? 9;
  if (pa !== pb) return pa - pb;
  const ua = ORDEN_UNIDADES.indexOf(a.unidad);
  const ub = ORDEN_UNIDADES.indexOf(b.unidad);
  if (ua !== ub) return ua - ub;
  return a.nombre.localeCompare(b.nombre);
}

// ============================================================================
//  ORDEN POR ORGANIGRAMA — para las listas que NO pueden ser un arbol
// ============================================================================
/**
 * El lugar de cada puesto en el recorrido del arbol, 0 = Direccion General.
 *
 * ─── POR QUE UN INDICE Y NO UN COMPARADOR AD HOC ───────────────────────────
 * Varias pantallas listan EMPLEADOS y no pueden ser un arbol: Usuarios,
 * Auditoria, Productividad, Descansos. Ordenarlas alfabeticamente pone al
 * Director entre dos anaquelistas y deja la estructura de la empresa invisible;
 * ordenarlas "por nivel" a mano en cada pantalla crea cuatro versiones de la
 * misma regla que se desincronizan a la primera.
 *
 * Con un indice, el orden es EL MISMO que el del arbol de la piramide por
 * construccion, porque sale del mismo recorrido. Si el organigrama cambia,
 * cambian las cuatro pantallas a la vez.
 *
 * Se calcula una sola vez y se memoriza: son 89 puestos y esto se llama desde
 * comparadores que corren miles de veces.
 */
let _indicePuesto: Map<string, number> | null = null;

function indicePuesto(): Map<string, number> {
  if (_indicePuesto) return _indicePuesto;
  const m = new Map<string, number>();
  let n = 0;
  const rec = (nodos: NodoOrganigrama[]) => {
    for (const nd of nodos) {
      m.set(nd.puesto.id, n++);
      rec(nd.hijos);
    }
  };
  rec(arbolOrganigrama());
  _indicePuesto = m;
  return m;
}

/**
 * Posicion de un puesto en el organigrama. Los que NO estan en el catalogo
 * devuelven un numero MUY grande: caen al final, juntos y visibles.
 *
 * No se les inventa un lugar por parecido de nombre — un puesto adivinado le
 * entrega a una persona real obligaciones que no le tocan. Que salgan al final
 * en bloque es justamente la señal de que a esas fichas les falta el puesto.
 */
export function posicionEnOrganigrama(puestoId: string | undefined | null): number {
  if (!puestoId) return Number.MAX_SAFE_INTEGER;
  const p = indicePuesto().get(puestoId);
  return p === undefined ? Number.MAX_SAFE_INTEGER : p;
}

/**
 * Comparador de personas por su lugar en el organigrama, con el nombre como
 * desempate. Uso: `lista.sort(compararPorOrganigrama(u => u.puestoId, u => u.nombre))`
 *
 * Recibe funciones y no campos fijos porque cada pantalla llama distinto a lo
 * mismo: unas traen `puestoId`, otras lo resuelven de la ficha. Asi la regla se
 * escribe una vez y cada pantalla dice de donde sacarla.
 */
export function compararPorOrganigrama<T>(
  puestoDe: (x: T) => string | undefined | null,
  nombreDe: (x: T) => string,
): (a: T, b: T) => number {
  return (a, b) => {
    const pa = posicionEnOrganigrama(puestoDe(a));
    const pb = posicionEnOrganigrama(puestoDe(b));
    if (pa !== pb) return pa - pb;
    return (nombreDe(a) || '').localeCompare(nombreDe(b) || '');
  };
}

/**
 * ¿A este puesto le reporta alguien? Es la definicion operativa de "jefatura":
 * no un nivel de una lista escrita a mano, sino tener gente debajo.
 *
 * Se deriva del arbol, asi que el dia que el organigrama cambie esto cambia
 * solo. Un puesto que no existe devuelve false — no se le inventa mando.
 */
export function tieneSubordinados(puestoId: string | undefined | null): boolean {
  if (!puestoId) return false;
  return PUESTOS_ORGANIGRAMA.some(
    (p) => p.vigente !== false && p.reportaA === puestoId,
  );
}
