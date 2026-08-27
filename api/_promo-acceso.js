// ============================================================================
//  Candado del apartado "Activacion de promociones" (formato MKTN001).
//
//  La seccion es una sola pero son DOS oficios, y cada uno se asigna por
//  separado desde Personal:
//
//    promocionesFormato      da de alta el formato y lo edita, lo quita, y
//                            ademas llena expedientes (alcanza todo).
//    promocionesExpediente   SOLO llena el expediente de su sucursal: agrega
//                            salida, exhibicion y tickets. No quita nada que ya
//                            este subido y no le mueve un pelo al formato.
//
//  Por que se revisa aqui y no solo en la pantalla: esconder un boton no es un
//  candado. Cualquiera con su token y la consola abierta puede pegarle al
//  endpoint a mano; la base es la unica fuente de verdad.
//
//  OJO, y es a proposito, igual que en Venta de Promos: al rol admin NO se le
//  regala ninguno de los dos permisos. Se tiene o no se tiene. Al administrador
//  general no lo deja fuera, porque las cuentas SIN fila en la base fallan
//  abierto (ver mas abajo).
// ============================================================================
const { query } = require('./db');

/**
 * A que sucursal pertenece cada canal del formato.
 *
 * GEMELA de SUCURSAL_POR_CANAL en src/app/modules/dashboard/promociones/canales.ts.
 * Son dos copias porque el navegador es TypeScript y esto es CommonJS; si se
 * toca una, se toca la otra. Ahi esta explicado por que los nombres del papel
 * (PH, ALP, Zam. Centro) no son los del catalogo de sucursales.
 *
 * Los canales que no estan en la tabla (Mayoreo, Ruta Diaria, Ruta Vecinal) no
 * son de ninguna sucursal: quedan ABIERTOS para que cualquiera les suba.
 */
const SUCURSAL_POR_CANAL = {
  'PH': 'Padre Hidalgo',
  '8 Esquinas': '8 Esquinas',
  'ALP': 'La Piedad Abastos',
  'Yurécuaro': 'Yurécuaro',
  'Morelia A.': 'Morelia Abastos',
  'Morelia M.': 'Morelia Madero',
  'Canindo': 'Canindo',
  'Zam. Centro': 'Zamora Centro',
};

const ACCESO_TOTAL = 'general (acceso total)';

/** Nombre de sucursal comparable: sin acentos, sin mayusculas, sin orillas. */
function clave(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

/**
 * Los permisos de este usuario en Promociones, leidos de la base.
 *
 * Devuelve { formato, expediente, sucursales, alcanzaTodas, desconocido }.
 *
 * Se FALLA ABIERTO con las identidades que la base no reconoce, por el mismo
 * motivo ya documentado en api/usuarios.js y api/promos-venta.js: hay cuentas
 * de acceso sin fila (el administrador general entre ellas) y dejarlas fuera es
 * peor que el hueco. A quien SI tiene fila se le aplica su permiso al pie de la
 * letra.
 */
async function permisosPromo(usuario) {
  const abierto = {
    formato: true, expediente: true, sucursales: [], alcanzaTodas: true, desconocido: true,
  };
  const uid = usuario && usuario.uid;
  if (!uid) return abierto;

  let fila;
  try {
    const r = await query('select alcance, datos from mdtask_usuarios where id = $1 limit 1',
      [String(uid)]);
    fila = r.rows[0];
  } catch (e) {
    console.error('[promo-acceso] no se pudo consultar el permiso:', e && e.message);
    // Si la base falla se NIEGA: es lo contrario del caso de arriba. Ahi no
    // sabemos quien es; aqui no sabemos nada, y abrir de par en par por un hipo
    // de la base seria regalar el modulo.
    return { formato: false, expediente: false, sucursales: [], alcanzaTodas: false, desconocido: false };
  }
  if (!fila) return abierto;

  const d = fila.datos || {};
  // Compatibilidad: las cuentas viejas traen la bandera unica `grupoPromociones`,
  // que antes daba permiso para todo. Mientras no corra la migracion
  // (scripts/sql/035_promociones_roles.sql) sigue contando como los dos
  // oficios, para que nadie se quede sin poder trabajar el dia del cambio.
  const legado = d.grupoPromociones === true;
  const formato = d.promocionesFormato === true || legado;
  // Quien captura el formato tambien llena expedientes: alcanza todo.
  const expediente = formato || d.promocionesExpediente === true;

  const sucursales = Array.isArray(d.sucursales) ? d.sucursales : [];
  const alcanzaTodas =
    String(fila.alcance || '') === 'global' ||
    !sucursales.length ||
    sucursales.some(s => clave(s) === ACCESO_TOTAL);

  return { formato, expediente, sucursales, alcanzaTodas, desconocido: false };
}

/**
 * ¿Este permiso alcanza para subirle evidencia a este canal?
 *
 * Quien captura el formato entra a cualquier canal AUNQUE tenga una sola
 * sucursal asignada: su oficio no es atender una tienda, es llevar la promocion
 * completa, y le toca poder destrabar el expediente de donde sea. Sin esta
 * linea, la pantalla le ofrecia el boton y el servidor se lo rechazaba.
 *
 * Quien alcanza todas las sucursales entra a cualquier canal. Al que tiene
 * sucursales fijas solo se le abren las suyas... y las rutas y el mayoreo, que
 * no son de nadie y por eso quedan abiertas: si se las amarraramos a una
 * sucursal, nadie mas podria llenarlas.
 */
function alcanzaCanal(perm, canal) {
  if (!perm) return false;
  if (perm.formato) return true;
  if (perm.alcanzaTodas) return true;
  const suya = SUCURSAL_POR_CANAL[String(canal || '')];
  if (!suya) return true;
  return perm.sucursales.some(s => clave(s) === clave(suya));
}

/** El 403 del modulo, con el motivo en palabras que se entiendan. */
function prohibido(res, que) {
  return res.status(403).json({ error: 'No tienes permiso de ' + que + ' en Promociones.' });
}

module.exports = { permisosPromo, alcanzaCanal, prohibido, SUCURSAL_POR_CANAL };
