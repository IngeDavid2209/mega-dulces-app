// ============================================================================
//  CRUD de `mdtask_tareas_puesto` — LA NORMA COMO DATO (Fase 7, paso 7.1a)
//
//  Las tareas que Dirección/Capital Humano capturan para los puestos que NO
//  tienen manual escrito en `tareas-manual.catalogo.ts`. Medido el 14/sep/2026:
//  70 de 89 puestos sin manual, 38 de ellos con gente, 104 personas.
//
//  ─── ESTE HANDLER NO ES UN CRUD PELADO, Y EL MOTIVO ES EL §5.4 ────────────
//  El factory `_crud.js` da POST-que-sobrescribe y DELETE físico. Los dos están
//  BIEN para un catálogo de rutinas y MAL para una norma:
//
//    · un POST sobre un id existente EDITA EN EL SITIO una regla ya emitida.
//      Después de eso, nadie puede reconstruir con qué versión se juzgó un día
//      pasado — que es exactamente lo que el invariante prohíbe y lo que la
//      «hoja de auditoría» del §4 necesita para poder imprimirse.
//    · un DELETE deja huérfanos a los checklists ya emitidos: apuntan a una
//      tarea que dejó de existir, y el punto se vuelve inexplicable (§5.5).
//
//  Así que los dos se cierran aquí, y lo que queda es el flujo correcto:
//    crear   -> POST con id nuevo
//    corregir-> POST de una fila NUEVA con `reemplazaA`, y PATCH de la vieja a
//               `vigente: false`. Las dos quedan, con autor y fecha.
//    retirar -> PATCH { vigente: false }
//
//  ─── POR QUÉ EL PATCH VA ACOTADO A TRES CAMPOS ────────────────────────────
//  Si el PATCH pudiera tocar `items`, `frecuencia` u `hora_limite`, el candado
//  del POST sería decorativo: se editaría la norma por la otra puerta, sin
//  dejar rastro. El §5.5 no se cumple prohibiendo una ruta, se cumple
//  prohibiéndolas TODAS — y la lección de este repo es que el siguiente camino
//  de escritura siempre aparece. Por eso la lista es blanca (lo permitido), no
//  negra (lo prohibido): una columna nueva nace cerrada, no abierta.
//
//  Los candados de forma —prefijo `tp-`, nombre único por puesto, frecuencia
//  completa— NO están aquí: viven en la tabla (migración 060), donde ninguna
//  ruta de escritura futura los puede saltar.
// ============================================================================
const { crearCrud } = require('./_crud');
const { query, dbConfigurada } = require('./db');
const { verificarToken } = require('./_auth');

const crud = crearCrud({
  tabla: 'mdtask_tareas_puesto',
  map: {
    puestoId: 'puesto_id',
    nombre: 'nombre',
    momento: 'momento',
    frecuencia: 'frecuencia',
    diaSemana: 'dia_semana',
    diaMes: 'dia_mes',
    horaLimite: 'hora_limite',
    documento: 'documento',
    version: 'version',
    vigente: 'vigente',
    reemplazaA: 'reemplaza_a',
    creadoEn: 'creado_en',
    creadoPor: 'creado_por',
    motivo: 'motivo',
  },
  boolCols: ['vigente'],
  numCols: ['creado_en', 'dia_mes'],
  orderBy: 'puesto_id asc, nombre asc',
  filtros: { puestoId: 'puesto_id' },
});

/** Lo único que un PATCH puede mover. Lista BLANCA: ver cabecera. */
const PATCH_PERMITIDO = new Set(['id', 'vigente', 'motivo']);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); return res.status(204).end(); }

  // ── Candado: una norma no se borra (§5.5) ───────────────────────────────
  if (req.method === 'DELETE') {
    cors(res);
    return res.status(405).json({
      error: 'Una tarea de puesto no se borra: se retira con vigente=false. ' +
             'Los checklists ya emitidos tienen que seguir teniendo a qué tarea apuntar.',
    });
  }

  // ── Candado: una norma emitida no se edita en el sitio (§5.4) ───────────
  //
  // Se comprueba ANTES de llamar al factory, y con una consulta propia, porque
  // el `on conflict (id) do update` del factory ya habría sobrescrito para
  // cuando pudiéramos mirar el resultado.
  if (req.method === 'POST') {
    if (!dbConfigurada()) { cors(res); return res.status(503).json({ error: 'Base de datos no disponible.' }); }
    let user;
    try { user = await verificarToken(req); }
    catch (e) { cors(res); return res.status(e.status || 401).json({ error: e.message }); }

    const id = String((req.body || {}).id || '').trim();
    if (!id) { cors(res); return res.status(400).json({ error: 'Falta id.' }); }
    try {
      const r = await query('select id from mdtask_tareas_puesto where id = $1', [id]);
      if (r.rowCount > 0) {
        cors(res);
        return res.status(409).json({
          error: 'Esa tarea ya existe y una norma no se edita: publica una versión nueva ' +
                 '(otra tarea con reemplazaA apuntando a ésta) y retira la anterior.',
          campo: 'id',
        });
      }
    } catch (e) {
      console.error('[mdtask_tareas_puesto] no se pudo comprobar el id:', e && e.message);
      cors(res);
      return res.status(500).json({ error: 'No se pudo comprobar si la tarea ya existía.' });
    }
  }

  // ── Candado: el PATCH solo retira, no reescribe ─────────────────────────
  if (req.method === 'PATCH') {
    const ajenos = Object.keys(req.body || {}).filter(k => !PATCH_PERMITIDO.has(k));
    if (ajenos.length) {
      cors(res);
      return res.status(400).json({
        error: 'Un PATCH solo puede retirar una tarea (vigente, motivo). ' +
               'Para cambiar su contenido se publica una versión nueva. Campos rechazados: ' +
               ajenos.join(', '),
      });
    }
  }

  return crud(req, res);
};
