// ============================================================================
//  QUE PRIVILEGIOS LE TOCAN A CADA PUESTO  —  LA DEFINICION, EN UN SOLO SITIO
//
//  Es un BORRADOR para que Direccion lo corrija, no una decision tomada por el
//  desarrollo. Cambiar este archivo es cambiar quien puede que en toda la app;
//  `scripts/ajustar-privilegios.js` no hace mas que aplicar lo que aqui diga.
//
//  ─── POR QUE POR PUESTO Y NO POR PERSONA ──────────────────────────────────
//  Instruccion de David (14/sep/2026): dejar a los administradores «como
//  usuarios simples de acuerdo a su puesto». Es el §5.1 del CLAUDE.md —la
//  obligacion (y el privilegio) pertenecen a la plaza, no a la persona— y es lo
//  que impide que esto haya que volver a hacerlo cada vez que alguien rote.
//
//  ─── LO QUE ESTE ARCHIVO NO TOCA, A PROPOSITO ─────────────────────────────
//  Las banderas de SERVICIO (grupoTec, grupoTickets, grupoPagos, grupoFlotilla,
//  grupoPromociones, promociones*, ventaPromos*) NO son privilegios de mando:
//  son acceso a modulos operativos que una persona usa para trabajar. Quitarlas
//  aqui dejaria gente sin poder hacer su trabajo por un cambio que iba de otra
//  cosa. Se conservan tal cual, y si Direccion quiere revisarlas es otro paso.
//
//  ─── Y LO QUE NO SE INVENTA (§8.5) ────────────────────────────────────────
//  Un puesto que no aparezca aqui NO se toca: el script lo reporta como
//  pendiente. Rellenar por parecido le quitaria o le daria privilegios a una
//  persona real por una suposicion.
// ============================================================================

/** Las 9 banderas de gestion. Cualquiera de ellas convierte en "supervisor". */
const GESTION = [
  'puedeAdministrarPersonal', 'puedeAdministrarAreas',
  'puedeCrearChecklists', 'puedeCrearRutinas', 'puedeCrearTareasUnicas',
  'puedeVerCalendario', 'puedeVerCheckstore', 'puedeVerEstadisticas', 'puedeVerHistorial',
];

/** Las de servicio: acceso a modulos, no mando. Este paso NO las toca. */
const SERVICIO = [
  'grupoTec', 'grupoTickets', 'grupoPagos', 'grupoFlotilla', 'grupoPromociones',
  'promocionesFormato', 'promocionesExpediente',
  'ventaPromosCaja', 'ventaPromosVendedor', 'ventaPromosMonitor',
];

// ── LOS PERFILES ────────────────────────────────────────────────────────────
// `rol` y `alcance` se fijan tambien, porque bajar las banderas y dejar
// `rol: 'admin'` no cambia nada: `esAdmin(u)` abre por si solo casi todo.
const PERFILES = {
  // Manda en toda la empresa. Es el unico que conserva `rol: 'admin'`.
  direccion: {
    etiqueta: 'Dirección General — administrador global',
    rol: 'admin', alcance: 'global',
    banderas: GESTION,
  },
  // Ve y mide su zona, y arma trabajo. NO administra fichas de personal ni areas:
  // eso es una DEFINICION de la empresa, no operacion de zona.
  gerencia_zona: {
    etiqueta: 'Gerencia de Zona — mide y asigna, no administra fichas',
    rol: 'trabajador', alcance: null,
    banderas: ['puedeCrearChecklists', 'puedeCrearRutinas', 'puedeCrearTareasUnicas',
               'puedeVerCalendario', 'puedeVerCheckstore', 'puedeVerEstadisticas', 'puedeVerHistorial'],
  },
  // Opera su turno: asigna trabajo del dia y mira sus numeros. Sin `puedeCrearRutinas`
  // (eso es Manual por Puesto, una definicion) y sin administrar personal.
  mando_sucursal: {
    etiqueta: 'Encargado(a) y Auxiliar de Encargado — su turno y sus números',
    rol: 'trabajador', alcance: null,
    banderas: ['puedeCrearChecklists', 'puedeCrearTareasUnicas',
               'puedeVerCalendario', 'puedeVerCheckstore', 'puedeVerEstadisticas', 'puedeVerHistorial'],
  },
  // Jefaturas de area: miden lo suyo, no mandan en sucursal.
  jefatura_area: {
    etiqueta: 'Jefaturas administrativas — miden su área',
    rol: 'trabajador', alcance: null,
    banderas: ['puedeCrearTareasUnicas', 'puedeVerEstadisticas', 'puedeVerHistorial', 'puedeVerCalendario'],
  },
  // Capital Humano es la unica area que SI administra fichas de personal.
  capital_humano: {
    etiqueta: 'Capital Humano — administra fichas de personal',
    rol: 'trabajador', alcance: null,
    banderas: ['puedeAdministrarPersonal', 'puedeCrearTareasUnicas',
               'puedeVerCalendario', 'puedeVerHistorial', 'puedeVerEstadisticas'],
  },
  // Ejecuta y prueba lo suyo. Ninguna bandera de gestion.
  operativo: {
    etiqueta: 'Operación — ejecuta y prueba lo suyo',
    rol: 'trabajador', alcance: null,
    banderas: [],
  },
};

// ── EL MAPA PUESTO → PERFIL ─────────────────────────────────────────────────
// Solo puestos que EXISTEN en `organigrama.catalogo.ts`. Lo que no este aqui
// se reporta como pendiente y no se toca.
const POR_PUESTO = {
  'direccion-general':                 'direccion',
  'full-stack-developer':              'direccion',   // la cuenta del dueño

  'gerencia-zona':                     'gerencia_zona',

  'encargado-sucursal':                'mando_sucursal',

  // ⚠ EL AUXILIAR DE ENCARGADO PASA A `operativo` (decision de David, 19/sep).
  //
  // Estaba en `mando_sucursal`, o sea con EL MISMO perfil que la Encargada, y
  // el organigrama dice que es `operativo` con CERO subordinados. Enfrentado a
  // las tres salidas, David eligio: **cubre, no manda**. Cuando la Encargada no
  // esta, su autoridad sale de la COBERTURA de esa plaza ese dia —la pieza
  // existe desde el 13/sep— y no de una bandera permanente. Asi queda con
  // fecha, motivo y autor, que es lo que el modelo pide (§4).
  //
  // ─── LO QUE ESTO CUESTA, dicho antes de que alguien lo corra ────────────
  // Aplicarlo le quita SEIS banderas de gestion a los ~11 Auxiliares de
  // Encargado que el censo del emisor conto el 15/sep. Dejan de ver el
  // Dashboard, Control, el pase de lista y la plantilla, y dejan de ver las
  // tareas de toda su sucursal: pasan a ver las suyas.
  //
  // Cambiar esta linea NO toca ninguna ficha. Lo aplica `ajustar-privilegios.js`
  // contra produccion, y eso lo corre David (§8.6). En seco primero:
  //     node scripts/ajustar-privilegios.js
  // y solo despues, con el plan a la vista, `--aplicar` (que respalda antes).
  'auxiliar-encargado':                'operativo',

  'jefatura-sistemas':                 'jefatura_area',
  'jefe-mantenimiento':                'jefatura_area',
  'jefe-tesoreria':                    'jefatura_area',
  'coordinacion-compras':              'jefatura_area',
  'presupuestos-compras-corporativas': 'jefatura_area',
  'direccion-comercial-marketing':     'jefatura_area',
  'coordinador-marketing-digital':     'jefatura_area',
  'auxiliar-auditoria-prevencion':     'jefatura_area',
  'analista-ordenes-entrada':          'jefatura_area',
  'supervisor-ventas-rd':              'jefatura_area',
  'infraestructura-seguridad':         'jefatura_area',

  'jefatura-capital-humano':           'capital_humano',
  'servicios-al-personal':             'capital_humano',

  'almacenista-sucursal':              'operativo',
  'anaquelista':                       'operativo',
  'cajero-sucursal':                   'operativo',
  'vendedora-piso':                    'operativo',
  'promotora':                         'operativo',
  'surtidor-zona':                     'operativo',
  'checador-cedis':                    'operativo',
  'aux-mercadotecnia-zona':            'operativo',
  'aux-logistica-flotilla':            'operativo',
  'aux-caja-general-zona':             'operativo',
};

module.exports = { GESTION, SERVICIO, PERFILES, POR_PUESTO };
