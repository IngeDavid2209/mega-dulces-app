// ============================================================================
//  CRUD de `mdtask_plantillas` — la plantilla autorizada de cada sucursal
//
//  Cuántas plazas de cada puesto DEBE tener una sucursal. Es la autorización,
//  no la realidad: el censo sale de `mdtask_usuarios` y la resta la hace
//  `plantilla.util.ts` en el cliente.
//
//  ─── POR QUÉ NO SE BORRA UN RENGLÓN AL CAMBIARLO ──────────────────────────
//  La pantalla NO usa DELETE para retirar una autorización: la marca
//  `vigente = false` (§5.5, nada se borra). El índice único de la 057 es
//  parcial —solo sobre las vigentes— precisamente para que las versiones
//  retiradas convivan sin estorbar. Así, cuando alguien pregunte en diciembre
//  por qué Padre Hidalgo pasó de cinco anaquelistas a cuatro, la respuesta
//  sigue en la tabla con su autor y su fecha.
//
//  El DELETE se deja montado porque el factory lo trae, pero la interfaz no lo
//  llama. Si algún día hiciera falta, es una decisión aparte y consciente.
// ============================================================================
const { crearCrud } = require('./_crud');
const { guardia, puedeDefinirEstructura, sucursalDeLaFila } = require('./_autorizar');

module.exports = crearCrud({
  tabla: 'mdtask_plantillas',
  map: {
    sucursal: 'sucursal',
    puestoId: 'puesto_id',
    cantidad: 'cantidad',
    vigente: 'vigente',
    creadoEn: 'creado_en',
    creadoPor: 'creado_por',
  },
  boolCols: ['vigente'],
  numCols: ['cantidad', 'creado_en'],
  // Permite `GET /api/plantillas?sucursal=Canindo`. Sin esto, la pantalla de
  // una Encargada tendría que bajarse la plantilla de toda la empresa para
  // quedarse con seis renglones.
  filtros: { sucursal: 'sucursal' },
  orderBy: 'sucursal asc, puesto_id asc',

  // ── QUIÉN ESCRIBE (19/sep) ────────────────────────────────────────────────
  //
  // Hasta hoy: cualquier sesión válida. Esta tabla dice cuántas plazas autoriza
  // una sucursal, y de ella se derivan las plazas y con ellas a quién se le
  // emite trabajo — así que escribirla sin permiso es repartir obligaciones.
  //
  // La regla es el espejo de `puedeEditar` en `plantilla.ts:249`, no una
  // política nueva: Dirección en cualquier sucursal, cada jefatura en las
  // suyas. Leer no se toca.
  autorizar: guardia({
    etiqueta: 'plantillas',
    permite: puedeDefinirEstructura,
    sucursalDe: ({ cuerpo, req }) => sucursalDeLaFila({
      tabla: 'mdtask_plantillas', columna: 'sucursal', campo: 'sucursal', cuerpo, req,
    }),
  }),
});
