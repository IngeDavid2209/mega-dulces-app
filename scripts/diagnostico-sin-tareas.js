// ============================================================================
//  DIAGNOSTICO — POR QUE A ESTA PERSONA NO LE APARECEN SUS TAREAS
//
//  LA PREGUNTA QUE CONTESTA, y ninguna otra:
//
//      «A fulano no le aparecen sus tareas del manual.» Eso lo preguntó David
//      el 15/sep/2026 tres veces en un dia, sobre tres personas distintas y con
//      tres causas distintas, y la pantalla se ve IGUAL en las tres.
//
//      Nacio mirando a los tres jefes de zona (Ivette Cruz Oceguera, Jose Ramon
//      Rodriguez y Aaron Tzihuaran Alejo) y por eso son la lista por omision;
//      sirve para cualquiera con `--nombre=`.
//
//      El «no aparecen» tiene SEIS causas que se ven identicas en pantalla, y
//      cada una se arregla en un sitio distinto — o no se arregla:
//
//        A  sin puesto resoluble    -> su ficha no tiene `puestoId` y su `cargo`
//                                      de texto libre no casa con ningun alias.
//                                      Se arregla CAPTURANDO el puesto en
//                                      Personal. No es codigo.
//        A3 su puesto no tiene manual -> 70 de los 89 puestos no lo tienen. No
//                                      se arregla en su ficha: es Fase 7, y lo
//                                      decide Direccion escribiendo la norma.
//        B  sin sucursal asignada   -> `sucursalesDe()` devuelve vacio.
//        C  no se emitio hoy        -> tiene todo y aun asi 0 entregas: la regla
//                                      lo descarto por descanso, cierre o turno.
//        D  emitida y BORRADA       -> existe con eliminado = true. El emisor NO
//                                      la repone ese dia: su id ya esta tomado.
//        E  emitida y VIVA          -> entonces el cero no es de emision, es de
//                                      la PANTALLA (la bandeja donde aterriza, o
//                                      su alcance).
//
//  POR QUE LA E NO ES UN «ya esta bien»: un supervisor abre la app en
//  «Pendientes del equipo» (checklist.ts:1428) y esa bandeja EXCLUYE sus
//  propias tareas a proposito desde el 14/sep. Sus tareas existen y estan en
//  «Mis tareas pendientes», el otro boton. Por eso el script tambien imprime si
//  la persona es supervisora: es lo que decide en que bandeja cae.
//
//  NO REIMPLEMENTA LA REGLA. Llama a `planDeEntregas` compilada, la MISMA que
//  corre en el servidor. Una segunda version de «que le toca hoy a quien»
//  divergiria en silencio y daria un diagnostico que contradice a produccion
//  sin que nadie sepa cual de los dos miente (§8.11 d).
//
//  NO ESCRIBE NADA. Ni un insert, ni un update, ni un delete.
//
//  Como se corre (PowerShell, desde la raiz del repo):
//      node scripts/compilar-manual.js
//      $env:DATABASE_URL = "<URL PUBLICA de Postgres de Railway>"
//      node scripts/diagnostico-sin-tareas.js
//      node scripts/diagnostico-sin-tareas.js --nombre="Otra Persona"
//      node scripts/diagnostico-sin-tareas.js --fecha=2026-09-16
// ============================================================================
const path = require('path');
const { query, dbConfigurada } = require('../api/db');
const { schemaDeMdtask } = require('./_schema-mdtask');

// Los tres jefes de zona del 15/sep. Se sustituyen con --nombre= (repetible).
const POR_OMISION = [
  'Ivette Cruz Oceguera',
  'Jose Ramon Rodriguez',
  'Aaron Tzihuaran Alejo',
];

/**
 * Puesto que se ESPERA que tenga la persona. Opcional, y por eso vacio por
 * omision.
 *
 * ⚠ ANTES ESTABA FIJO EN 'gerencia-zona' Y ESO ERA UN DIAGNOSTICO FALSO EN
 * CUANTO SE MIRABA A OTRA PERSONA. El 15/sep/2026, preguntando por una cajera,
 * el script la habria puesto en la cubeta «PUESTO DISTINTO: recibe el manual de
 * OTRO puesto» — que suena a defecto y es, simplemente, que es cajera. Un
 * control anclado a un caso concreto caduca en cuanto el caso cambia (§8.11 e),
 * y aqui el caso cambio al dia siguiente de escribirlo.
 *
 * Con `--puesto=<id>` se vuelve a exigir uno, que es util cuando se sabe cual
 * deberia ser: ahi «tiene OTRO puesto» si es un hallazgo.
 */
const PUESTO_ESPERADO = (process.argv.find(a => a.startsWith('--puesto=')) || '').split('=')[1] || '';
const PREFIJO_MANUAL = 'man_';
const DIAS_VENTANA = 7;

function abortar(codigo, msg, detalle) {
  console.error('');
  console.error('[sin-tareas] ABORTA: ' + msg);
  if (detalle) console.error('             ' + detalle);
  console.error('');
  process.exit(codigo);
}

// La regla viaja compilada en dist/manual (el servidor no tiene `src/` ni tsc).
// Si falta, se dice con la orden exacta para producirla: un diagnostico que
// reviente con «cannot find module» manda a depurar la base, que esta bien.
function cargarRegla() {
  const base = path.resolve(__dirname, '../dist/manual');
  try {
    return {
      emision: require(path.join(base, 'emision-manual.util.js')),
      puesto: require(path.join(base, 'puesto.util.js')),
      permisos: require(path.join(base, 'permisos.util.js')),
      catalogo: require(path.join(base, 'tareas-manual.catalogo.js')),
    };
  } catch (e) {
    abortar(3, 'no encuentro la regla compilada en dist/manual.',
      'Corre primero:  node scripts/compilar-manual.js     (' + e.message + ')');
  }
}

function argsDe(bandera) {
  return process.argv.filter(a => a.startsWith(bandera + '=')).map(a => a.slice(bandera.length + 1));
}

function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

(async () => {
  if (!dbConfigurada || !dbConfigurada()) {
    abortar(1, 'falta DATABASE_URL.', 'Sin credencial no hay medicion; un cero aqui seria «no lei», no «no hay».');
  }
  const R = cargarRegla();
  const { planDeEntregas, sucursalesDe, lugaresDeEmision } = R.emision;
  const { resolverPuesto } = R.puesto;
  const { esSupervisor, mismoEmpleadoNombre } = R.permisos;
  const { tareasAutomaticasDePuesto } = R.catalogo;

  const nombresArg = argsDe('--nombre');
  const JEFES = nombresArg.length ? nombresArg : POR_OMISION;

  const fechaArg = argsDe('--fecha')[0];
  const fecha = fechaArg ? new Date(fechaArg + 'T12:00:00') : new Date();
  if (isNaN(fecha.getTime())) abortar(1, 'la fecha no se entiende: ' + fechaArg);
  const fechaYmd = ymd(fecha);
  const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];

  console.log('');
  console.log('[sin-tareas] fecha analizada: %s (%s)', fechaYmd, DIAS[fecha.getDay()]);

  const SCHEMA = await schemaDeMdtask(query, { prefijo: '[sin-tareas]' });

  // ── ENTRADAS, con su tamano ANTES de concluir nada (§8.11 a) ──────────────
  const fichas = (await query(
    'select id, usuario, correo, nombre, rol, cargo, alcance, activo, datos from "' + SCHEMA + '".mdtask_usuarios'
  )).rows;
  const activas = fichas.filter(f => f.activo !== false);
  console.log('[sin-tareas] fichas leidas: %d (activas: %d)', fichas.length, activas.length);
  if (!fichas.length) {
    abortar(1, 'cero fichas leidas.', 'Con la app en produccion eso no es «no hay»: es «no lei» (schema o base equivocada).');
  }

  // Aplanado igual que el emisor: en Postgres lo extra vive en `datos` jsonb, y
  // `resolverPuesto`/`sucursalesDe` leen campos de la raiz. Si esto no se
  // hiciera, TODAS saldrian «sin puesto» y el diagnostico culparia a la captura.
  const aplanar = r => Object.assign({
    id: r.id, usuario: r.usuario || '', correo: r.correo || '', nombre: r.nombre || '',
    rol: r.rol || 'trabajador', cargo: r.cargo || '', alcance: r.alcance || '',
    activo: r.activo !== false,
  }, r.datos || {});
  const usuarios = activas.map(aplanar);

  // ── CONTROL POSITIVO: la regla emite para ALGUIEN hoy ─────────────────────
  // Sin esto, un «0 entregas» de los tres jefes es indistinguible de una regla
  // que no emite nada para nadie (dist/manual viejo, fecha rara, catalogo roto).
  const planTodos = planDeEntregas({
    usuarios, fecha, idsExistentes: [], descansosSemana: [], horarios: [],
  });
  console.log('[sin-tareas] control: la regla emitiria %d entrega(s) hoy para toda la empresa, %d omitido(s)',
    planTodos.entregas.length, planTodos.omitidos.length);
  if (planTodos.entregas.length === 0) {
    abortar(1, 'la regla no emite NADA para nadie hoy.',
      'Eso no mide a los jefes de zona: mide que la regla o la fecha estan mal. Revisa dist/manual.');
  }

  // ── Cuantas fichas resuelven a gerencia-zona en TODA la base ──────────────
  // El denominador que contesta «solo hay tres»: si la base dice otro numero,
  // la lista de David y la base miden poblaciones distintas y hay que decirlo.
  if (PUESTO_ESPERADO) {
    const conEsePuesto = usuarios.filter(u => resolverPuesto(u).puestoId === PUESTO_ESPERADO);
    console.log('[sin-tareas] fichas activas que HOY resuelven a "%s": %d — %s',
      PUESTO_ESPERADO, conEsePuesto.length,
      conEsePuesto.map(u => u.nombre).join(' | ') || '(ninguna)');
    console.log('[sin-tareas] tareas automaticas del manual de ese puesto: %d',
      tareasAutomaticasDePuesto(PUESTO_ESPERADO).length);
  }

  // ── Los checklists del dia, y la ventana de 7 dias como control ───────────
  const desde = new Date(fecha); desde.setDate(desde.getDate() - DIAS_VENTANA);
  const checklists = (await query(
    'select id, assigned, store, fecha, enviado, archivado, eliminado, status, datos ' +
    'from "' + SCHEMA + '".mdtask_checklists where fecha >= $1 and fecha <= $2',
    [ymd(desde), fechaYmd]
  )).rows;
  const delManual = checklists.filter(c => String(c.id || '').startsWith(PREFIJO_MANUAL));
  const deHoy = delManual.filter(c => c.fecha === fechaYmd);
  console.log('[sin-tareas] checklists en la ventana de %d dias: %d (del manual: %d) · de hoy: %d',
    DIAS_VENTANA, checklists.length, delManual.length, deHoy.length);
  if (delManual.length === 0) {
    abortar(1, 'cero checklists del manual en ' + DIAS_VENTANA + ' dias.',
      'Eso no es «no hay»: es «no lei». Un dia normal trae cientos.');
  }

  // ── FICHA POR FICHA ───────────────────────────────────────────────────────
  console.log('');
  console.log('======================================================================');
  const cubetas = [];
  for (const buscado of JEFES) {
    console.log('');
    console.log('> %s', buscado);

    const candidatas = fichas.filter(f => mismoEmpleadoNombre(f.nombre, buscado));
    if (!candidatas.length) {
      console.log('   CUBETA A0 · NO EXISTE NINGUNA FICHA con ese nombre (de %d leidas).', fichas.length);
      console.log('              Se busco con `mismoEmpleadoNombre`, que tolera apellidos de mas/de menos.');
      console.log('              Puede estar capturada con otro nombre: es el hallazgo 1 (identidad por texto).');
      cubetas.push([buscado, 'A0 sin ficha']);
      continue;
    }
    if (candidatas.length > 1) {
      console.log('   AVISO: %d fichas casan con ese nombre: %s', candidatas.length,
        candidatas.map(f => f.id + (f.activo === false ? '(inactiva)' : '')).join(' | '));
    }

    for (const f of candidatas) {
      const u = aplanar(f);
      const r = resolverPuesto(u);
      const lugares = sucursalesDe(u);
      const emision = lugares.length ? lugaresDeEmision(lugares) : [];
      const sup = esSupervisor(u);
      const mandaVista = sup || u.rol === 'admin';

      console.log('   ficha %s · activa=%s · rol=%s', f.id, f.activo !== false, u.rol);
      console.log('   cargo (texto libre): %s', JSON.stringify(u.cargo || ''));
      console.log('   puesto: %s  [origen: %s]', r.puestoId || '(NINGUNO)', r.origen);
      console.log('   sucursales de su ficha: %s', JSON.stringify(lugares));
      console.log('   donde se le emitiria:   %s', JSON.stringify(emision));
      console.log('   supervisor(a): %s  -> abre la app en «%s»', mandaVista,
        mandaVista ? 'Pendientes del EQUIPO (excluye las suyas)' : 'Mis tareas');

      if (f.activo === false) {
        console.log('   CUBETA B0 · FICHA INACTIVA: el emisor la salta.');
        cubetas.push([buscado, 'B0 inactiva']);
        continue;
      }

      // Que le tocaria hoy, segun la regla REAL, ella sola.
      const plan = planDeEntregas({
        usuarios: [u], fecha, idsExistentes: [], descansosSemana: [], horarios: [],
      });
      const motivos = plan.omitidos.map(o => o.motivo).join('; ');
      console.log('   la regla le daria HOY: %d entrega(s)%s',
        plan.entregas.length, motivos ? '  · motivo: ' + motivos : '');

      // Que EXISTE realmente en la base a su nombre hoy.
      const suyasHoy = deHoy.filter(c => mismoEmpleadoNombre(c.assigned, f.nombre));
      const vivas = suyasHoy.filter(c => c.eliminado !== true);
      const borradas = suyasHoy.filter(c => c.eliminado === true);
      const suyasSemana = delManual.filter(c => mismoEmpleadoNombre(c.assigned, f.nombre));
      console.log('   en la BASE hoy: %d del manual a su nombre (%d vivas, %d eliminadas) · en %d dias: %d',
        suyasHoy.length, vivas.length, borradas.length, DIAS_VENTANA, suyasSemana.length);
      for (const c of vivas) console.log('      viva: %s · %s', c.store, c.id);

      // ── LA CUBETA ───────────────────────────────────────────────────────────
      let cubeta;
      let clave;
      if (!r.puestoId) {
        clave = 'A';
        cubeta = 'A · SIN PUESTO RESOLUBLE — su ficha no tiene `puestoId` y su cargo no casa con ningun alias.'
               + '\n              SE ARREGLA EN LA PANTALLA DE PERSONAL, capturando su puesto. No es codigo.';
      } else if (PUESTO_ESPERADO && r.puestoId !== PUESTO_ESPERADO) {
        clave = 'A2';
        cubeta = 'A2 · PUESTO DISTINTO (' + r.puestoId + '): recibe el manual de OTRO puesto, '
               + 'no el de "' + PUESTO_ESPERADO + '".';
      } else if (tareasAutomaticasDePuesto(r.puestoId).length === 0) {
        // 70 de los 89 puestos no tienen manual escrito. No es un fallo de la
        // app y no lo arregla nadie desde aqui: es Fase 7, y lo decide
        // Direccion escribiendo la norma de ese puesto.
        clave = 'A3';
        cubeta = 'A3 · SU PUESTO NO TIENE MANUAL (' + r.puestoId + ') — no recibe tareas '
               + 'automaticas porque no existe el documento. No se arregla en su ficha.';
      } else if (!lugares.length) {
        clave = 'B';
        cubeta = 'B · SIN SUCURSAL ASIGNADA — se arregla capturando su sucursal en Personal.';
      } else if (vivas.length > 0) {
        clave = 'E';
        cubeta = 'E · EMITIDA Y VIVA (' + vivas.length + ') — el cero NO es de emision, es de la PANTALLA.'
               + (mandaVista ? '\n              Y manda vista de gestion: aterriza en «Pendientes del equipo», que EXCLUYE las suyas.'
                             + '\n              Sus tareas estan en «Mis tareas pendientes».' : '');
      } else if (borradas.length > 0) {
        clave = 'D';
        cubeta = 'D · EMITIDA Y BORRADA (' + borradas.length + ') — el emisor NO la repone hoy: su id ya esta tomado.';
      } else if (plan.entregas.length === 0) {
        clave = 'C';
        cubeta = 'C · LA REGLA NO LE EMITE HOY — motivo: ' + (motivos || '(sin motivo registrado)');
      } else {
        clave = 'C2';
        cubeta = 'C2 · LA REGLA SI LE EMITIRIA (' + plan.entregas.length + ') Y EN LA BASE NO HAY NADA.'
               + '\n              O el emisor no corrio, o corrio contra otra base. Mira el log de Railway.';
      }
      console.log('   CUBETA %s', cubeta);
      cubetas.push([buscado, clave]);
    }
  }

  console.log('');
  console.log('======================================================================');
  console.log('RESUMEN (%d persona(s) revisada(s))', JEFES.length);
  for (const par of cubetas) console.log('  %s -> %s', String(par[0]).padEnd(26), par[1]);
  console.log('');
  console.log('Denominadores: %d fichas (%d activas) · %d checklists del manual en %d dias · %d de hoy.',
    fichas.length, activas.length, delManual.length, DIAS_VENTANA, deHoy.length);
  console.log('');
  process.exit(0);
})().catch(e => {
  console.error('[sin-tareas] fallo:', e && e.message ? e.message : e);
  process.exit(1);
});
