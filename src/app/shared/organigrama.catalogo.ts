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
