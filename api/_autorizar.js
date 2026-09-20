// ============================================================================
//  AUTORIZACIÓN DE ESCRITURA — el servidor deja de creerle al token a secas
//
//  ─── EL HUECO QUE ESTO CIERRA, medido el 19/sep/2026 ──────────────────────
//  `api/_crud.js` llamaba a `verificarToken` y pasaba directo al SQL. O sea que
//  AUTENTICABA y no AUTORIZABA: cualquier sesión válida —la de una anaquelista,
//  o la de una plaza— podía `POST /api/plantillas` y reescribir cuántas plazas
//  autoriza una sucursal, o `POST /api/tareas-puesto` y publicar una norma.
//  Las pantallas sí lo gateaban; el cable no. Es la lección del 13/sep («el menú
//  no es un permiso») un piso más abajo: **la pantalla tampoco es un permiso.**
//
//  ─── LA REGLA NO SE REESCRIBE AQUÍ, SE IMPORTA ────────────────────────────
//  `esAdminGlobal`, `esJefatura` y `sucursalesPermitidas` son LAS MISMAS
//  funciones que usa el navegador, cargadas desde `dist/manual` (las deja ahí
//  `scripts/compilar-manual.js` al construir). Copiarlas a JS habría creado una
//  segunda versión de «hasta dónde manda esta persona», libre de discrepar —y
//  discreparía en silencio: alguien a quien la pantalla deja capturar y el
//  endpoint rechaza con un 403 que parece un permiso mal puesto. Es el mismo
//  argumento que hizo que `planDeEntregas` viva en un solo sitio (14/sep).
//
//  ─── SE FALLA ABIERTO CON LAS IDENTIDADES QUE NO SE RECONOCEN ─────────────
//  Copiado a propósito de `api/usuarios.js`, que ya tomó esta decisión y dejó
//  escrito el porqué: hay filas con el `rol` vacío (ids 'admin' y 'admin-local')
//  y sesiones sin fila en la base, así que «no pude reconocerlo» NO significa
//  «es un trabajador». Dejar sin trabajar a quien manda es peor que el hueco.
//  Cada paso por una excepción se ANOTA en el log, que es la única forma de ver
//  a quién habría bloqueado la regla estricta antes de cerrarla de verdad.
//
//  LA ÚNICA EXCEPCIÓN ES LA PLAZA, y es reconocimiento POSITIVO, no ausencia de
//  dato: un token de plaza dice `rol: 'plaza'` y su uid empieza por 'plaza:'
//  (`api/login-plaza.js:109`). Una plaza no define la estructura de la empresa
//  —ninguna pantalla se lo ofrece, el login por plaza aterriza en sus tareas— y
//  dejar que lo hiciera sería exactamente la auto-atestación que el modelo
//  prohíbe (§4: la identidad sale de la cobertura, no de quien escribe).
//
//  ─── `/api/coberturas` YA ESTÁ CERRADO (20/sep) ───────────────────────────
//  El 19/sep quedó fuera a propósito y así estaba escrito aquí: lo escriben DOS
//  flujos legítimos —el pase de lista (una Encargada, que no es admin) y
//  `login.ts:361` CON EL TOKEN DE PLAZA, para registrar la suplencia de quien
//  entró— así que las dos reglas obvias («solo admin» y «la plaza no») habrían
//  roto algo vivo. Medidos los dos, ahora tiene su propia guardia con los dos
//  caminos: ver `guardiaCoberturas` abajo.
//
//  ─── QUÉ SIGUE SIN CUBRIR, dicho para que no se lea como cerrado ──────────
//  Los otros 9 endpoints del factory (`catalogo-rutinas`, `asignaciones-rutinas`,
//  `moldes-checklists`, `descansos-semanales`, `tareas-equipo`,
//  `rutinas-personales`, `vehiculos`, `usuarios-tokens`, `config`) siguen
//  aceptando cualquier token válido. No se cierran a bulto: cada uno necesita
//  saber quién escribe hoy, y un 403 en medio de un turno se lee como «la app
//  se rompió».
// ============================================================================
const path = require('path');
const { query } = require('./db');
const { hoyEnMexico } = require('./_fecha');

// ── Las reglas compartidas, cargadas una vez ───────────────────────────────
//
// Si `dist/manual` no está (imagen mal construida), se GRITA y se falla
// ABIERTO: un endpoint que rechaza a todo el mundo porque falta un archivo del
// build es peor que el hueco que esto cierra, y el grito lo hace visible.
// `scripts/compilar-manual.js` ya aborta el build si tsc no emite estos dos,
// así que llegar aquí sin ellos significa que alguien rompió esa etapa.
let reglas = null;
let reglasFallaron = false;
function cargarReglas() {
  if (reglas || reglasFallaron) return reglas;
  try {
    const base = path.join(__dirname, '..', 'dist', 'manual');
    const permisos = require(path.join(base, 'permisos.util.js'));
    const alcance = require(path.join(base, 'alcance.util.js'));
    reglas = {
      esDueno: permisos.esDueno,
      esAdminGlobal: permisos.esAdminGlobal,
      sucursalesPermitidas: permisos.sucursalesPermitidas,
      alcanceCubre: permisos.alcanceCubre,
      normalizarNombre: permisos.normalizarNombre,
      esJefatura: alcance.esJefatura,
    };
  } catch (e) {
    reglasFallaron = true;
    console.error('[autorizar] NO SE PUDIERON CARGAR LAS REGLAS de dist/manual:',
      (e && e.message) || e);
    console.error('[autorizar] Sin ellas NO SE AUTORIZA NADA y todo pasa. ' +
      'Revisa la etapa `compilar-manual` del build.');
  }
  return reglas;
}

/** ¿Este token es el de una plaza y no el de una persona? */
function esTokenDePlaza(user) {
  if (!user) return false;
  if (String(user.rol || '') === 'plaza') return true;
  return String(user.uid || '').startsWith('plaza:');
}

// Mismo shape que `fila()` de api/usuarios.js: las columnas tipadas arriba y el
// `datos` jsonb esparcido encima (sucursales[], puestoId, las banderas puede*).
// Es el objeto que esperan los predicados compartidos; construir uno distinto
// aquí haría que evaluaran sobre un perfil que la app nunca ve.
function perfilDeFila(r) {
  const datos = r.datos || {};
  return {
    uid: r.id, id: r.id,
    usuario: r.usuario || '', correo: r.correo || '', nombre: r.nombre || '',
    rol: r.rol || '', telefono: r.telefono || '', alcance: r.alcance || '',
    cargo: r.cargo || '', activo: r.activo !== false,
    ...datos,
  };
}

/**
 * Quién es quien trae este token.
 *
 * El JWT propio lleva `{ uid, rol }` y nada más (`_auth.js:59`), y el respaldo
 * de Firebase devuelve el token de Google, que NO trae rol ninguno. Así que el
 * rango no se puede leer del token: hay que ir por la ficha. Se busca por uid
 * y, si no aparece, por correo —que es lo único que trae una sesión de
 * Firebase—, porque si no un administrador con sesión vieja quedaría sin
 * reconocer y pasaría por la puerta de la excepción cada vez.
 */
async function identidadDe(user) {
  if (esTokenDePlaza(user)) {
    return { perfil: null, esPlaza: true, motivo: 'token de plaza' };
  }
  const uid = user && user.uid ? String(user.uid) : '';
  const correo = String((user && (user.correo || user.email)) || '').trim().toLowerCase();

  if (uid) {
    const r = await query('select * from mdtask_usuarios where id = $1', [uid]);
    if (r.rows[0]) return { perfil: perfilDeFila(r.rows[0]), esPlaza: false, motivo: 'ficha por uid' };
  }
  if (correo) {
    const r = await query(
      'select * from mdtask_usuarios where lower(trim(correo)) = $1 order by activo desc nulls last, id asc limit 1',
      [correo]
    );
    if (r.rows[0]) return { perfil: perfilDeFila(r.rows[0]), esPlaza: false, motivo: 'ficha por correo' };
  }
  return { perfil: null, esPlaza: false, motivo: 'no tiene fila en la base' };
}

/**
 * ¿Puede DEFINIR la estructura de esta sucursal? (plantilla y sus plazas)
 *
 * Espejo exacto de `puedeEditar` en `plantilla.ts:249`, que es lo que la
 * pantalla ya exige: Dirección en cualquier sucursal, y cada jefatura en las
 * suyas. Esa apertura la pediste el 13/sep («déjalo libre — como crea tu
 * plantilla de tu sucursal»), así que un candado de «solo admin» aquí habría
 * roto justo lo que se abrió. `alcanceCubre` se usa en vez de un `includes`
 * porque `sucursalesPermitidas` devuelve `null` para decir TODAS.
 */
function puedeDefinirEstructura(perfil, sucursal) {
  const R = cargarReglas();
  if (!R) return true;                       // falla abierto: ya gritó
  if (R.esAdminGlobal(perfil)) return true;
  if (!R.esJefatura(perfil)) return false;
  if (!sucursal) return false;               // sin lugar no hay alcance que comprobar
  return R.alcanceCubre(R.sucursalesPermitidas(perfil), String(sucursal).trim());
}

/**
 * ¿Puede declarar un puesto de temporada?
 *
 * No lleva sucursal: un puesto declarado es de la empresa, no de una tienda.
 * Lo captura la misma pantalla de plantilla, así que la audiencia es la misma
 * —jefatura— y los candados de la tabla (prefijo `tmp-`, `hasta` obligatorio)
 * siguen siendo los que impiden que se confunda con un puesto del organigrama.
 */
function puedeDeclararPuesto(perfil) {
  const R = cargarReglas();
  if (!R) return true;
  return R.esAdminGlobal(perfil) || R.esJefatura(perfil);
}

/**
 * ¿Puede publicar o retirar una NORMA? (`mdtask_tareas_puesto`)
 *
 * Espejo de `puedeEditarNorma` en `manual-puestos.ts:108`. Es más estrecho que
 * la plantilla a propósito: la plantilla dice cuánta gente cabe en UNA tienda,
 * la norma dice qué tiene que hacer TODO un puesto de la empresa. Una norma mal
 * publicada le entrega obligaciones a gente que no las tiene (§8.5).
 */
function puedeEditarNorma(perfil) {
  const R = cargarReglas();
  if (!R) return true;
  return R.esAdminGlobal(perfil) || R.esDueno(perfil);
}

/**
 * De qué sucursal es la fila que se está escribiendo.
 *
 * ─── POR QUÉ NO BASTA CON MIRAR EL CUERPO ─────────────────────────────────
 * Porque un PATCH no lo trae. `plantilla.ts:434` manda `{ cantidad }` y nada
 * más —lo normal en un merge parcial—, así que leer solo el cuerpo devolvería
 * `null` y `puedeDefinirEstructura` rechazaría a TODA jefatura que corrigiera
 * una cantidad, dejando pasar solo a Dirección. Un candado que solo funciona
 * en el POST es un candado que rompe el trabajo de todos los días.
 *
 * Así que si el cuerpo no lo dice, se pregunta a la fila que se va a tocar. Y
 * si la fila no existe todavía (un PATCH que crea, que este factory permite),
 * se cae al cuerpo: no hay nada escrito contra lo que comprobar.
 *
 * El nombre de la columna se pasa: cada tabla lo llama distinto
 * (`plantillas.sucursal`, `plazas.lugar`) y adivinarlo por parecido es como se
 * autoriza una escritura contra la sucursal equivocada.
 */
async function sucursalDeLaFila({ tabla, columna, campo, cuerpo, req }) {
  const delCuerpo = cuerpo && cuerpo[campo] != null ? String(cuerpo[campo]).trim() : '';
  if (delCuerpo) return delCuerpo;
  const id = String((cuerpo && cuerpo.id) || (req && req.query && req.query.id) || '').trim();
  if (!id) return null;
  try {
    const r = await query(`select ${columna} as suc from ${tabla} where id = $1`, [id]);
    if (r.rows[0] && r.rows[0].suc != null) return String(r.rows[0].suc).trim();
  } catch (e) {
    // Que no se pueda leer la fila NO es que sea de otra sucursal. Se relanza
    // para que `_crud` responda 500 («no pude comprobar») y no un 403, que
    // mandaría a la persona a pedir un permiso que ya tiene.
    throw e;
  }
  return null;
}

/**
 * ¿Puede ASIGNAR quién cubre una plaza? (`mdtask_coberturas`)
 *
 * Espejo de `puedeAsignar` en `pase-lista.ts:132`: Dirección en cualquier
 * sucursal, y cada jefatura en las suyas. Es operación de cada día, no una
 * definición de la empresa, y por eso NO es admin-only: quien pasa lista es la
 * Encargada.
 */
function puedeAsignarCobertura(perfil, sucursal) {
  const R = cargarReglas();
  if (!R) return true;
  if (R.esAdminGlobal(perfil)) return true;
  if (!R.esJefatura(perfil)) return false;
  if (!sucursal) return false;
  return R.alcanceCubre(R.sucursalesPermitidas(perfil), String(sucursal).trim());
}

/**
 * De qué sucursal es una cobertura. Son DOS saltos: la cobertura apunta a una
 * plaza y la plaza tiene el lugar.
 *
 * El PATCH del pase de lista manda `{ id, hasta }` —cierra la cobertura
 * anterior— así que ni el lugar ni la plaza vienen en el cuerpo y hay que
 * bajar por la cadena. Sin esto, cerrar una cobertura sería un 403 para toda
 * jefatura y el pase de lista dejaría de funcionar en su primer paso.
 */
async function sucursalDeLaCobertura({ cuerpo, req }) {
  let plazaId = cuerpo && cuerpo.plazaId ? String(cuerpo.plazaId).trim() : '';
  if (!plazaId) {
    const id = String((cuerpo && cuerpo.id) || (req && req.query && req.query.id) || '').trim();
    if (!id) return null;
    const c = await query('select plaza_id from mdtask_coberturas where id = $1', [id]);
    if (!c.rows[0] || c.rows[0].plaza_id == null) return null;
    plazaId = String(c.rows[0].plaza_id);
  }
  const p = await query('select lugar from mdtask_plazas where id = $1', [plazaId]);
  return p.rows[0] && p.rows[0].lugar != null ? String(p.rows[0].lugar).trim() : null;
}

/**
 * La guardia de `/api/coberturas`. Es la única con DOS caminos legítimos, y
 * por eso quedó fuera del primer cierre (19/sep) hasta poder medirlos.
 *
 * ─── CAMINO 1 · LA PERSONA QUE SE IDENTIFICA AL ENTRAR ────────────────────
 * `login.ts:361` (`confirmarSoyOtro`) escribe una suplencia CON EL TOKEN DE
 * PLAZA: alguien entró con el código de su plaza, el pase de lista decía que
 * la cubre otra persona, y declara quién es. Prohibir los tokens de plaza aquí
 * —que es lo que se hace en los endpoints de definición— rompería ese flujo.
 *
 * Así que se permite, pero SOLO lo que ese flujo manda, y cada condición tapa
 * un abuso concreto:
 *   · es un POST (no puede reescribir ni cerrar coberturas ajenas);
 *   · `plazaId` es LA PLAZA DE SU PROPIO TOKEN (no puede declarar quién cubre
 *     otra plaza de la sucursal);
 *   · `tipo` es 'suplencia' (no puede nombrarse TITULAR y desplazar al de
 *     verdad, que es el cambio que el pase de lista hace permanente);
 *   · `desde` y `hasta` son HOY (no puede firmar el pasado ni adelantar el mes).
 *
 * Lo que queda permitido es exactamente «hoy, en mi plaza, como suplente», que
 * es una declaración que la Encargada ve y corrige. Lo dice el propio motivo
 * que escribe el cliente: «Se identificó al entrar (sin pase de lista previo)».
 *
 * ─── CAMINO 2 · EL PASE DE LISTA ──────────────────────────────────────────
 * Una persona con ficha: la regla de `pase-lista.ts`, con la sucursal resuelta
 * bajando plaza → lugar.
 */
function guardiaCoberturas() {
  return async ({ user, metodo, cuerpo, req }) => {
    const id = await identidadDe(user);

    if (id.esPlaza) {
      const plazaDelToken = String(user.uid || '').slice('plaza:'.length);
      const c = cuerpo || {};
      const hoy = hoyEnMexico();
      const ok =
        metodo === 'POST' &&
        String(c.plazaId || '') === plazaDelToken &&
        String(c.tipo || '') === 'suplencia' &&
        String(c.desde || '') === hoy &&
        String(c.hasta || '') === hoy;
      if (ok) return null;
      console.warn('[coberturas] ' + metodo + ' de PLAZA bloqueado: uid=' + (user && user.uid) +
        ' plazaId="' + (c.plazaId || '') + '" tipo="' + (c.tipo || '') +
        '" desde="' + (c.desde || '') + '" hasta="' + (c.hasta || '') + '" (hoy=' + hoy + ')');
      return {
        status: 403,
        error: 'Una cuenta de plaza solo puede registrar que HOY la cubre alguien más, ' +
               'y solo en su propia plaza. Lo demás lo captura el pase de lista.',
      };
    }

    if (!id.perfil) {
      console.warn('[coberturas] ' + metodo + ' permitido por EXCEPCION: uid=' +
        (user && user.uid) + ' motivo="' + id.motivo + '"');
      return null;
    }

    const suc = await sucursalDeLaCobertura({ cuerpo: cuerpo || {}, req });
    if (puedeAsignarCobertura(id.perfil, suc)) return null;

    console.warn('[coberturas] ' + metodo + ' bloqueado: uid=' + (user && user.uid) +
      ' nombre="' + (id.perfil.nombre || '') + '" sucursal="' + (suc || '') + '"');
    return {
      status: 403,
      error: 'No puedes pasar lista' + (suc ? ' en ' + suc : ' en esa sucursal') + '.',
    };
  };
}

/**
 * El gancho que consume `_crud.js`.
 *
 * Devuelve `null` si pasa, o `{ status, error }` si no. `etiqueta` es solo para
 * el log: sin ella, «403 en algún endpoint» no se puede rastrear.
 */
function guardia({ etiqueta, permite, sucursalDe }) {
  return async ({ user, metodo, cuerpo, req }) => {
    const id = await identidadDe(user);

    if (id.esPlaza) {
      console.warn('[' + etiqueta + '] ' + metodo + ' bloqueado: token de PLAZA (uid=' +
        (user && user.uid) + '). Una plaza no define la estructura.');
      return {
        status: 403,
        error: 'Una cuenta de plaza no puede cambiar esta definición. ' +
               'Entra con tu cuenta para hacerlo.',
      };
    }

    if (!id.perfil) {
      // Falla abierto y se anota: ver la cabecera. Es la misma política que
      // `api/usuarios.js`, y el log es lo que permite cerrarla bien después.
      console.warn('[' + etiqueta + '] ' + metodo + ' permitido por EXCEPCION: uid=' +
        (user && user.uid) + ' motivo="' + id.motivo + '"');
      return null;
    }

    const suc = sucursalDe ? await sucursalDe({ cuerpo: cuerpo || {}, req }) : null;
    if (permite(id.perfil, suc)) return null;

    console.warn('[' + etiqueta + '] ' + metodo + ' bloqueado: uid=' + (user && user.uid) +
      ' nombre="' + (id.perfil.nombre || '') + '" rol="' + (id.perfil.rol || '') +
      '" sucursal="' + (suc || '') + '"');
    return {
      status: 403,
      error: 'No tienes permiso para cambiar esta definición' +
             (suc ? ' en ' + suc : '') + '.',
    };
  };
}

module.exports = {
  identidadDe,
  esTokenDePlaza,
  sucursalDeLaFila,
  sucursalDeLaCobertura,
  puedeAsignarCobertura,
  guardiaCoberturas,
  puedeDefinirEstructura,
  puedeDeclararPuesto,
  puedeEditarNorma,
  guardia,
  cargarReglas,
};
