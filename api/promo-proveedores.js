// Catalogo de proveedores/marcas del apartado de promociones.
//
// La lista se arma sola: cada proveedor que alguien escribe en el paso 1 se
// guarda aqui y desde entonces se sugiere. Se guarda por `clave` normalizada
// (sin acentos, minusculas, espacios colapsados) para que "Canels", "canels" y
// "CANELS " sean el MISMO proveedor y no tres.
//
//   GET  /api/promo-proveedores            -> { proveedores: [...] } ordenados por uso
//   POST /api/promo-proveedores {nombre}   -> registra o suma un uso
const { query, dbConfigurada } = require('./db');
const { verificarToken } = require('./_auth');
const { permisosPromo, prohibido } = require('./_promo-acceso');

/** Normaliza para comparar: sin acentos, minusculas, un solo espacio. */
function claveDe(nombre) {
  return String(nombre || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLowerCase().replace(/\s+/g, ' ');
}

function fila(r) {
  return { clave: r.clave, nombre: r.nombre, usos: r.usos, ultimoUso: r.ultimo_uso };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!dbConfigurada()) return res.status(503).json({ error: 'Base de datos no disponible.' });

  let usuario = null;
  try { usuario = await verificarToken(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  try {
    if (req.method === 'GET') {
      const r = await query(
        `select clave, nombre, usos, ultimo_uso from mdtask_promo_proveedores
         order by usos desc, nombre asc`);
      return res.json({ proveedores: r.rows.map(fila) });
    }

    if (req.method === 'POST') {
      // El catalogo de proveedores se llena solo, desde el paso 1 del formato:
      // quien no captura formatos no tiene por que darle de alta marcas.
      const perm = await permisosPromo(usuario);
      if (!perm.formato) return prohibido(res, 'dar de alta proveedores');

      const nombre = String((req.body || {}).nombre || '').trim();
      if (!nombre) return res.status(400).json({ error: 'Falta el nombre del proveedor.' });
      if (nombre.length > 120) return res.status(400).json({ error: 'El nombre es demasiado largo.' });

      const clave = claveDe(nombre);
      const ahora = Date.now();
      const quien = usuario?.email || usuario?.uid || null;

      // Si ya existe se le suma un uso y se respeta el nombre original: el
      // primero que lo escribio decide como se ve escrito.
      const r = await query(
        `insert into mdtask_promo_proveedores (clave, nombre, usos, creado_en, creado_por, ultimo_uso)
         values ($1, $2, 1, $3, $4, $3)
         on conflict (clave) do update set
           usos = mdtask_promo_proveedores.usos + 1,
           ultimo_uso = excluded.ultimo_uso
         returning *`,
        [clave, nombre, ahora, quien]
      );
      return res.json({ proveedor: fila(r.rows[0]) });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    console.error('[promo-proveedores] error:', e && e.message);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};
