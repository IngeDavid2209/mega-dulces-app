// ============================================================================
//  ¿EN QUE SCHEMA VIVEN LAS TABLAS DE MDTASK? — una sola respuesta, compartida
//
//  POR QUE EXISTE ESTE ARCHIVO, y es la parte que importa.
//
//  El 14/sep/2026 `censo-administradores.js` aborto con CERO fichas contra la
//  base CORRECTA, y la causa costo la tarde: las tablas de MDTask viven en el
//  schema `eajd` (159 fichas · 56 migraciones) y en `public` quedaron 13 tablas
//  VACIAS con 26 migraciones de mayo. Un `select ... from mdtask_usuarios` sin
//  schema resuelve por `search_path`, encuentra las vacias y devuelve
//
//      0 filas   SIN   UN   SOLO   ERROR
//
//  que es el §12 del CLAUDE.md un nivel mas arriba: el nombre equivocado no
//  falla, MIENTE. Y miente en la direccion peor, porque «no pude leer» y «no
//  hay nada» se escriben igual.
//
//  ── POR QUE SE MIDE EN VEZ DE ESCRIBIRSE ───────────────────────────────────
//  Escribir `eajd` a mano seria la lista local que el §4 prohibe, y ademas
//  caduca: el dia que alguien consolide los schemas, un literal deja de
//  funcionar y hay que editar seis archivos. Aqui el schema se ELIGE por la
//  cifra —el que mas filas tiene— y se imprimen TODOS los candidatos con su
//  conteo, para que la eleccion sea auditable y no un acto de fe.
//
//  ── POR QUE NO SE CONFIA EN EL `search_path` ───────────────────────────────
//  El servidor de produccion usa este mismo `api/db.js` y SI encuentra las
//  tablas, asi que algo resuelve el path en ese entorno. Pero lo que lo resuelve
//  no esta escrito en ningun sitio del repo, y desde una URL publica con otro
//  usuario el path puede ser otro. Un diagnostico que dependa de eso da
//  resultados distintos segun quien lo corra, que es lo contrario de un
//  diagnostico. Por eso el schema se devuelve y se INTERPOLA en cada consulta.
//
//  ── POR QUE RECIBE UN `ejecutar` Y NO UN `Client` ──────────────────────────
//  Las cinco copias que este archivo viene a sustituir reciben un `Client` de
//  `pg`, pero `diagnostico-emision-hoy.js` y `diagnostico-conexion.js` usan el
//  `query()` de `api/db.js`, que es un POOL. Pedir un Client habria obligado a
//  reescribir esos dos para abrir su propia conexion —o sea, a crear una sexta
//  version de algo—, asi que lo que se recibe es lo unico que los dos tienen en
//  comun: una funcion `(sql, params) => Promise<{ rows }>`.
//
//      const S = await schemaDeMdtask(query);                 // pool de api/db
//      const S = await schemaDeMdtask((s, p) => c.query(s, p)); // Client de pg
//
//  ── POR QUE LA TABLA TESTIGO ES UN PARAMETRO (§8.11 b) ─────────────────────
//  La guardia va sobre la entrada que DE VERDAD usas, no sobre un proxy de
//  ella. `diagnostico-emision-hoy.js` lee `mdtask_checklists`; elegir el schema
//  mirando `mdtask_usuarios` y leer despues otra tabla deja abierta la rendija
//  de que las dos no vivan juntas. Cada quien mide por la suya.
//
//  LANZA en vez de llamar a `process.exit`, para que se pueda probar con un
//  ejecutor simulado: una guardia que solo se ejercita con credenciales de
//  produccion es una guardia que no se ejercita nunca.
//
//  NO ESCRIBE NADA: dos `select`, uno a `information_schema` y un `count(*)`.
// ============================================================================

/** El error que lanza este modulo. Lleva `codigo` para que quien llame decida. */
class ErrorDeSchema extends Error {
  constructor(mensaje, codigo, conteos) {
    super(mensaje);
    this.name = 'ErrorDeSchema';
    this.codigo = codigo;         // 'SIN_TABLA' | 'TODOS_VACIOS'
    this.conteos = conteos || [];
  }
}

/**
 * Devuelve el schema donde de verdad estan los datos de MDTask.
 *
 * @param {(sql: string, params?: any[]) => Promise<{rows: any[]}>} ejecutar
 * @param {{tabla?: string, prefijo?: string, registrar?: (s: string) => void}} opciones
 * @returns {Promise<{schema: string, conteos: {schema: string, filas: number}[]}>}
 */
async function schemaDeMdtask(ejecutar, opciones) {
  const o = opciones || {};
  const tabla = o.tabla || 'mdtask_usuarios';
  const prefijo = o.prefijo || '[schema]';
  const registrar = o.registrar || console.log;

  if (typeof ejecutar !== 'function') {
    throw new TypeError('schemaDeMdtask espera una funcion (sql, params) => {rows}');
  }
  // El nombre de tabla se valida en vez de escaparse porque va INTERPOLADO en
  // el `count(*)`: no hay forma de parametrizar un identificador en SQL. Con
  // esta lista blanca, un nombre raro no puede convertirse en otra cosa.
  if (!/^[a-z_][a-z0-9_]*$/.test(tabla)) {
    throw new TypeError('nombre de tabla no valido: ' + tabla);
  }

  const cand = await ejecutar(
    'select table_schema from information_schema.tables where table_name = $1',
    [tabla]
  );
  const schemas = (cand && cand.rows ? cand.rows : []).map(r => r.table_schema);
  if (!schemas.length) {
    throw new ErrorDeSchema(
      'no existe `' + tabla + '` en NINGUN schema de esta base. No es la base de MDTask: ' +
      'puede ser la de otra app del Postgres compartido, o la de Mega Talento (que NO se toca).',
      'SIN_TABLA', []
    );
  }

  const conteos = [];
  for (const s of schemas) {
    // `"..."` alrededor del schema: los nombres pueden llevar mayusculas y sin
    // comillas Postgres los plegaria a minusculas, que es otro schema distinto.
    const n = await ejecutar('select count(*)::int as n from "' + s + '".' + tabla);
    conteos.push({ schema: s, filas: Number(n.rows[0].n) });
  }
  conteos.sort((a, b) => b.filas - a.filas || a.schema.localeCompare(b.schema));

  // Se imprime SIEMPRE la lista completa, no solo el ganador: cuando el elegido
  // sorprenda, lo primero que hace falta es ver contra que competia.
  registrar(prefijo + ' schemas con ' + tabla + ': ' +
    conteos.map(x => x.schema + '=' + x.filas).join(' · ') +
    '  ->  se usa "' + conteos[0].schema + '"');

  if (conteos[0].filas === 0) {
    throw new ErrorDeSchema(
      'la tabla `' + tabla + '` existe en ' + conteos.length + ' schema(s) y TODOS estan ' +
      'vacios. Eso no es «no hay datos»: es una base con el esquema aplicado y sin ' +
      'contenido, o sea que esta URL no es la de produccion.',
      'TODOS_VACIOS', conteos
    );
  }
  return { schema: conteos[0].schema, conteos };
}

module.exports = { schemaDeMdtask, ErrorDeSchema };
