#!/usr/bin/env node
/**
 * 🔁 ¿A QUIÉN LE LLEGA LA MISMA TAREA DEL MANUAL MÁS DE UNA VEZ?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LA PREGUNTA QUE CONTESTA, Y LA QUE NO
 * ═══════════════════════════════════════════════════════════════════════════
 * Pedido de David (14/sep/2026): «revisa a fondo cada usuario, que no tenga
 * tareas repetidas; los que lo tengan dime y reviso eso».
 *
 * CONTESTA:  ¿qué persona tiene, EL MISMO DÍA, más de un checklist del manual
 *            de LA MISMA tarea — y por cuál de las tres causas?
 * NO CONTESTA: si esa persona debía o no tener dos. Eso lo decide RH mirando la
 *            lista; el script no borra nada ni propone borrar (§5.5 y §8.5).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LAS TRES CAUSAS, QUE TIENEN DUEÑOS DISTINTOS
 * ═══════════════════════════════════════════════════════════════════════════
 * Medidas aparte a propósito: juntarlas daría un número grande y ninguna
 * acción. El arreglo de cada una lo hace una persona distinta.
 *
 *   A · LA FICHA DECLARA VARIAS SUCURSALES.
 *       `robot-manual.service.ts:202` arma la llave de idempotencia como
 *       `man_<tarea>_<periodo>_<SUCURSAL>_<empleado>`: la sucursal va DENTRO
 *       de la llave, así que quien tiene dos sucursales recibe cada tarea de su
 *       manual DOS VECES, con dos ids legítimos y distintos. No es un bug de
 *       duplicados: es el diseño («su manual aplica en todas donde opera»).
 *       Pero le MULTIPLICA EL DENOMINADOR, así que su cumplimiento sale partido
 *       entre N aunque haga su trabajo completo.
 *       → Lo arregla RH quitando las sucursales que ya no le tocan.
 *
 *   B · LA PERSONA TIENE DOS FICHAS.
 *       La llave lleva el NOMBRE, así que dos fichas con el nombre idéntico se
 *       pisan y no duplican. Las que duplican son las que difieren en una
 *       letra —«Yadira» y «Yaadira», el caso del 31/ago— o en un espacio. Es el
 *       hallazgo 1 entrando por esta puerta.
 *       → Lo arregla resolver el duplicado de identidad.
 *
 *   C · DOS PUESTOS DISTINTOS MANDAN LA MISMA TAREA.
 *       Ya está medido en el CLAUDE.md: `checador` y `checador-cedis` comparten
 *       3 tareas y 28 puntos. Si una persona cae en los dos, la recibe dos
 *       veces con ids distintos.
 *       → Lo arregla la Fase 7 (la norma como dato).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LO QUE VIGILA DE SÍ MISMO (§8.11)
 * ═══════════════════════════════════════════════════════════════════════════
 * · IMPRIME EL TAMAÑO DE SUS ENTRADAS ANTES DE CONCLUIR y **aborta** si alguna
 *   viene vacía. «No pude leer» y «no hay repetidas» se ven idénticos, y el
 *   segundo es la conclusión más cara que este script puede dar.
 *   La cota es la ya medida: la migración 050 contó **150 fichas activas**.
 * · CONTROL POSITIVO, y afirma el MECANISMO, no la aparición: si nadie tiene
 *   más de una sucursal Y no hay ninguna emisión repetida, el mecanismo de la
 *   cubeta A **no se ejerció** y el script sale con código 3 —«resultados
 *   válidos, mecanismo sin verificar»— en vez de decir «no hay repetidas».
 * · CONTROL NEGATIVO: una persona con UNA sucursal y UNA ficha NO puede salir
 *   en la lista. Si sale, la consulta marca de más y se avisa.
 * · Nunca imprime la contraseña de la conexión.
 *
 *   $env:DATABASE_URL = "<la URL PÚBLICA de Postgres de MDTask>"
 *   node scripts/diagnostico-tareas-repetidas.js [dias]
 *
 * Antes de correrlo, `node scripts/diagnostico-conexion.js` contesta a qué base
 * le estás hablando. Una base con el esquema aplicado y sin datos devuelve 0
 * filas SIN ERROR, y eso ya pasó el 13/sep.
 */
const { Client } = require('pg');

const DIAS = Math.max(1, Number(process.argv[2] || 14));
const FICHAS_ESPERADAS = 150;   // migración 050, 31/ago/2026

function abortar(motivo, extra) {
  console.error('');
  console.error('[repetidas] ABORTA: ' + motivo);
  if (extra) console.error('[repetidas] ' + extra);
  console.error('[repetidas] No concluyas de esta corrida.');
  process.exit(1);
}

/** Igual que `slug()` del robot: así el script compara con la MISMA regla con
 *  la que se construyó la llave, y no con una tercera versión que pueda
 *  discrepar (§8.11 d). */
function slug(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);
}

function fechaHace(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
}

function sucursalesDe(u) {
  const d = u.datos || {};
  const lista = (Array.isArray(d.sucursales) && d.sucursales.length) ? d.sucursales
              : (d.sucursal ? [d.sucursal] : []);
  const vistas = new Set();
  for (const s of lista) {
    const n = String(s || '').trim();
    if (n) vistas.add(n);
  }
  return [...vistas];
}

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) abortar('falta DATABASE_URL.', 'Sin conexión esto no devuelve un cero: no devuelve nada.');

  let donde = '(no pude leer el host)';
  try {
    const u = new URL(url);
    donde = u.hostname + ':' + (u.port || '5432') + u.pathname;   // la contraseña se queda fuera
  } catch { /* si no parsea, no se imprime nada */ }

  const cli = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await cli.connect().catch((e) => abortar('no pude conectar: ' + e.message));

  const desde = fechaHace(DIAS);
  console.log('');
  console.log('[repetidas] base %s · ventana desde %s (%d días)', donde, desde, DIAS);

  // ── ENTRADAS, con su tamaño ANTES de concluir nada ──────────────────────
  const fichas = (await cli.query(
    `select id, usuario, nombre, rol, activo, datos
       from mdtask_usuarios
      where activo is not false
      order by id`)).rows;

  const chk = (await cli.query(
    `select id, assigned, assigned_uid, store, fecha, enviado, eliminado,
            datos->>'_tareaManualId' as tarea_manual,
            datos->>'_puestoId'      as puesto
       from mdtask_checklists
      where fecha >= $1
        and coalesce(eliminado, false) = false
        and datos->>'_origenManual' = 'true'
      order by fecha, assigned`, [desde])).rows;

  console.log('[repetidas] fichas activas leídas .......... %d   (la 050 contó %d)',
    fichas.length, FICHAS_ESPERADAS);
  console.log('[repetidas] checklists DEL MANUAL leídos ... %d', chk.length);

  if (!fichas.length) {
    abortar('0 fichas activas leídas.',
      'La 050 contó ' + FICHAS_ESPERADAS + ', así que esto es un fallo de lectura o una base '
      + 'equivocada, no «no hay fichas». Corre scripts/diagnostico-conexion.js.');
  }
  if (fichas.length < FICHAS_ESPERADAS * 0.5) {
    abortar('solo ' + fichas.length + ' fichas activas contra las ' + FICHAS_ESPERADAS
      + ' de la 050.', 'A esa distancia no es deriva de plantilla: es un fallo de lectura.');
  }
  if (!chk.length) {
    abortar('0 checklists del manual en ' + DIAS + ' días.',
      'Con el robot corriendo todos los días eso no es «no hay»: es «no leí», o el campo '
      + '`_origenManual` no está donde lo busco (§12: un nombre equivocado devuelve cero sin '
      + 'error). Comprueba con: select count(*) from mdtask_checklists where fecha >= \''
      + desde + '\';');
  }

  // ═══════════════ CUBETA A · la ficha declara VARIAS sucursales ═══════════
  const variasSucursales = [];
  for (const f of fichas) {
    if (f.rol !== 'trabajador' && f.rol !== 'admin') continue;
    const s = sucursalesDe(f);
    if (s.length > 1) variasSucursales.push({ id: f.id, nombre: f.nombre || '(sin nombre)', sucursales: s });
  }

  // ═══════════════ CUBETA B · la persona tiene DOS fichas ══════════════════
  // Dos señales, y la primera es más dura: un `usuario` repetido es una colisión
  // EXACTA en la llave de acceso, no un parecido de nombres.
  const porUsuario = new Map();
  const porNombre = new Map();
  for (const f of fichas) {
    const us = String(f.usuario || '').trim().toLowerCase();
    if (us) { if (!porUsuario.has(us)) porUsuario.set(us, []); porUsuario.get(us).push(f); }
    const nm = slug(f.nombre);
    if (nm) { if (!porNombre.has(nm)) porNombre.set(nm, []); porNombre.get(nm).push(f); }
  }
  const fichasDobles = [];
  for (const [k, v] of porUsuario) if (v.length > 1) {
    fichasDobles.push({ señal: 'mismo usuario de acceso', llave: k, fichas: v.map((x) => x.nombre) });
  }
  for (const [k, v] of porNombre) if (v.length > 1) {
    fichasDobles.push({ señal: 'mismo nombre', llave: k, fichas: v.map((x) => x.nombre) });
  }

  // ═══════════ EL HECHO · emisiones repetidas ya en la base ════════════════
  // La misma PERSONA, la misma TAREA del manual, el mismo DÍA, más de un
  // checklist. La persona se identifica por uid cuando existe y por el nombre
  // cuando no —los checklists viejos no traen uid, y dejarlos fuera escondería
  // justo los de la gente que el hallazgo 1 vuelve difusa—.
  const grupos = new Map();
  for (const c of chk) {
    if (!c.tarea_manual) continue;
    const quien = c.assigned_uid ? 'uid:' + c.assigned_uid : 'nom:' + slug(c.assigned);
    const k = quien + '||' + c.tarea_manual + '||' + c.fecha;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(c);
  }

  const repetidas = new Map();   // persona → detalle
  let gruposRepetidos = 0;
  for (const [k, lista] of grupos) {
    if (lista.length < 2) continue;
    gruposRepetidos++;
    const quien = lista[0].assigned || k.split('||')[0];
    if (!repetidas.has(quien)) {
      repetidas.set(quien, { veces: 0, tareas: new Set(), sucursales: new Set(), dias: new Set(), maxCopias: 0 });
    }
    const r = repetidas.get(quien);
    r.veces += lista.length - 1;
    r.tareas.add(lista[0].tarea_manual);
    for (const c of lista) r.sucursales.add(c.store || '(sin sucursal)');
    r.dias.add(lista[0].fecha);
    if (lista.length > r.maxCopias) r.maxCopias = lista.length;
  }

  // ─────────────────────────── EL REPORTE ──────────────────────────────────
  console.log('');
  console.log('═══ QUIÉN RECIBE LA MISMA TAREA MÁS DE UNA VEZ ═══');
  if (!repetidas.size) {
    console.log('  ninguna persona, en %d checklists del manual de %d días.', chk.length, DIAS);
  } else {
    const filas = [...repetidas.entries()].sort((a, b) => b[1].veces - a[1].veces);
    console.log('  %d persona(s) · %d grupo(s) repetidos · sobre %d checklists',
      filas.length, gruposRepetidos, chk.length);
    console.log('');
    console.log('  %s  copias  tareas  días  sucursales donde le llega',
      'PERSONA'.padEnd(34));
    for (const [nombre, r] of filas) {
      console.log('  %s   ×%s    %s    %s   %s',
        String(nombre).slice(0, 34).padEnd(34),
        String(r.maxCopias).padStart(2),
        String(r.tareas.size).padStart(4),
        String(r.dias.size).padStart(3),
        [...r.sucursales].join(' · '));
    }
  }

  console.log('');
  console.log('═══ CAUSA A · fichas con MÁS DE UNA SUCURSAL ═══');
  console.log('  (cada tarea de su manual se les entrega una vez POR SUCURSAL)');
  if (!variasSucursales.length) {
    console.log('  ninguna, de %d fichas activas.', fichas.length);
  } else {
    for (const v of variasSucursales) {
      console.log('  ×%d  %s  →  %s', v.sucursales.length,
        String(v.nombre).slice(0, 34).padEnd(34), v.sucursales.join(' · '));
    }
  }

  console.log('');
  console.log('═══ CAUSA B · personas con DOS FICHAS activas ═══');
  if (!fichasDobles.length) {
    console.log('  ninguna, de %d fichas activas.', fichas.length);
  } else {
    for (const d of fichasDobles) {
      console.log('  [%s] %s  →  %s', d.señal, d.llave, d.fichas.join('  |  '));
    }
  }

  // ═══════════════════════ CONTROLES ═══════════════════════════════════════
  console.log('');
  console.log('═══ CONTROLES ═══');

  // NEGATIVO: quien tiene UNA sucursal y UNA ficha no debe salir como repetida
  // por esas causas. Si sale, es por la causa C o la consulta marca de más.
  const unaSola = new Set();
  for (const f of fichas) {
    if (sucursalesDe(f).length !== 1) continue;
    const nm = slug(f.nombre);
    if ((porNombre.get(nm) || []).length !== 1) continue;
    if ((porUsuario.get(String(f.usuario || '').trim().toLowerCase()) || []).length > 1) continue;
    unaSola.add(f.nombre);
  }
  const limpiosQueSalen = [...repetidas.keys()].filter((n) => unaSola.has(n));
  console.log('  negativo · fichas con UNA sucursal y UNA ficha ......... %d', unaSola.size);
  console.log('             de ésas, marcadas como repetidas ............ %d%s',
    limpiosQueSalen.length,
    limpiosQueSalen.length ? '  ← revisar: ' + limpiosQueSalen.slice(0, 5).join(', ') : '');
  if (!unaSola.size) {
    abortar('el control negativo no se pudo ejercer: NINGUNA ficha tiene exactamente una '
      + 'sucursal y una sola ficha.',
      'Sin un caso limpio, no se puede saber si la consulta discrimina o marca a todos.');
  }

  // POSITIVO, y afirma el MECANISMO: la cubeta A tiene que poder ejercerse.
  const ejercido = variasSucursales.length > 0 || gruposRepetidos > 0;
  console.log('  positivo · el mecanismo de la causa A se ejerció ....... %s',
    ejercido ? 'SÍ' : 'NO');

  await cli.end();

  if (!ejercido) {
    console.log('');
    console.log('[repetidas] Resultados VÁLIDOS, mecanismo SIN VERIFICAR (código 3).');
    console.log('[repetidas] Nadie tiene más de una sucursal y no hay ninguna emisión');
    console.log('[repetidas] repetida, así que este script no pudo comprobar que SABE');
    console.log('[repetidas] detectarlas. Eso no es lo mismo que «no hay repetidas».');
    process.exit(3);
  }

  console.log('');
  console.log('[repetidas] %d persona(s) con tareas repetidas, de %d fichas activas y %d',
    repetidas.size, fichas.length, chk.length);
  console.log('[repetidas] checklists del manual en %d días.', DIAS);
  console.log('[repetidas] NADA SE TOCÓ: este script solo lee (§5.5).');
})().catch((e) => abortar('reventó: ' + e.message));
