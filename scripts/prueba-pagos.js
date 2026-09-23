#!/usr/bin/env node
// ============================================================================
//  ARNES DEL MODULO DE PAGOS DE SERVICIOS.
//
//  Es el unico modulo del proyecto que produce CIFRAS DE DINERO, y hasta hoy no
//  tenia una sola prueba (§8.8). Corre sin credenciales y sin tocar produccion:
//  `api/db.js` se siembra en la cache de require con una base simulada, igual
//  que `prueba-autorizacion-crud.js` y `prueba-emisor-servidor.js`.
//
//  Cubre cuatro cosas, y las cuatro salieron de defectos medidos:
//
//   A) leerMontoYForma      — el monto ya no es "el primer numero del mensaje"
//   B) estadoVisible        — `diasAviso: 0` significa 0, no 3
//   C) esConsultaDePagos    — con control NEGATIVO: lo que NO le roba al asistente
//   D) el flujo del bot     — contra base simulada, punta a punta
//
//  Todo bloque lleva su reverso: uno que solo comprueba que las cosas buenas
//  pasan no distingue "funciona" de "acepta cualquier cosa".
//
//  Uso:  node scripts/prueba-pagos.js
//  Sale 0 si todo pasa, 2 si alguna afirmacion falla, 3 si no pudo medir.
// ============================================================================
const path = require('path');
const Module = require('module');
const RAIZ = path.join(__dirname, '..');

let fallos = 0, afirmaciones = 0;
function ok(cond, que, detalle) {
  afirmaciones++;
  if (cond) { console.log('  ok    ' + que); return true; }
  fallos++;
  console.log('  FALLA ' + que + (detalle ? '\n        -> ' + detalle : ''));
  return false;
}
function abortar(motivo) {
  console.error('\nNO PUDE MEDIR: ' + motivo);
  console.error('(Esto NO es "las pruebas pasan": es que la prueba no llego a ejercer nada.)');
  process.exit(3);
}

// ── Base simulada ──────────────────────────────────────────────────────────
//
// DOS pagos abiertos del MISMO telefono a proposito: con uno solo, el caso de
// "la segunda foto se va a otro servicio" no puede ocurrir y la tabla saldria
// verde sin haber ejercido nunca el defecto (§8.11 c).
//
// Las fechas se calculan desde hoy, no se teclean: un fixture con fechas fijas
// pasa hoy y falla solo dentro de un mes, sin que nada haya cambiado.
function masDias(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

const estado = {
  espera: new Map(),
  pagos: [
    { id: 'pago_luz_1', servicio_id: 'svc_luz', sucursal: 'Canindo', tipo: 'luz',
      periodo: '2026-09', periodo_texto: 'Septiembre 2026', fecha_limite: masDias(2),
      estado: 'pendiente', monto: null, forma_pago: null, comprobante_url: null,
      comprobante_tipo: null, pagado_en: null, registrado_por: null, canal: null,
      avisos: {}, datos: {}, eliminado: false },
    { id: 'pago_agua_1', servicio_id: 'svc_agua', sucursal: 'Canindo', tipo: 'agua',
      periodo: '2026-09', periodo_texto: 'Septiembre 2026', fecha_limite: masDias(4),
      estado: 'pendiente', monto: null, forma_pago: null, comprobante_url: null,
      comprobante_tipo: null, pagado_en: null, registrado_por: null, canal: null,
      avisos: {}, datos: {}, eliminado: false },
  ],
  servicios: {
    svc_luz: { id: 'svc_luz', proveedor: 'CFE', referencia: '0450123', departamento: null,
      periodicidad: 'mensual', dias_aviso: 5, hora_aviso: null, responsable_nombre: 'Elena',
      responsable_telefono: '4431234567', monto_estimado: 1200, activo: true, eliminado: false },
    svc_agua: { id: 'svc_agua', proveedor: 'OOAPAS', referencia: '99', departamento: null,
      periodicidad: 'mensual', dias_aviso: 5, hora_aviso: null, responsable_nombre: 'Elena',
      responsable_telefono: '4431234567', monto_estimado: 400, activo: true, eliminado: false },
  },
};

function conServicio(p) {
  const s = estado.servicios[p.servicio_id] || {};
  return Object.assign({}, p, {
    proveedor: s.proveedor, referencia: s.referencia, departamento: s.departamento,
    periodicidad: s.periodicidad, dias_aviso: s.dias_aviso, hora_aviso: s.hora_aviso,
    responsable_nombre: s.responsable_nombre, responsable_telefono: s.responsable_telefono,
    monto_estimado: s.monto_estimado, activo: s.activo,
  });
}

let escrituras = 0;
async function queryFalsa(sql, params) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  const p = params || [];

  // --- mdtask_pagos_espera ---
  if (/^select coalesce\(datos->'huerfanos'/i.test(s)) {
    const e = estado.espera.get(p[0]);
    return { rows: e ? [{ h: (e.datos || {}).huerfanos || [] }] : [], rowCount: e ? 1 : 0 };
  }
  if (/^select \* from mdtask_pagos_espera/i.test(s)) {
    const e = estado.espera.get(p[0]);
    return { rows: e ? [Object.assign({ telefono: p[0] }, e)] : [], rowCount: e ? 1 : 0 };
  }
  if (/^delete from mdtask_pagos_espera/i.test(s)) {
    estado.espera.delete(p[0]); escrituras++; return { rows: [], rowCount: 1 };
  }
  if (/^update mdtask_pagos_espera set pago_id = null, paso = null, actualizado_en = \$3/i.test(s)) {
    const e = estado.espera.get(p[0]) || { datos: {} };
    const previos = (e.datos || {}).huerfanos || [];
    estado.espera.set(p[0], { pago_id: null, paso: null,
      datos: { huerfanos: previos.concat(JSON.parse(p[1])) }, actualizado_en: Number(p[2]) });
    escrituras++; return { rows: [], rowCount: 1 };
  }
  if (/^update mdtask_pagos_espera set pago_id = null, paso = null/i.test(s)) {
    const e = estado.espera.get(p[0]);
    if (e) estado.espera.set(p[0], Object.assign({}, e, { pago_id: null, paso: null, actualizado_en: Number(p[1]) }));
    escrituras++; return { rows: [], rowCount: 1 };
  }
  if (/^insert into mdtask_pagos_espera/i.test(s)) {
    estado.espera.set(p[0], { pago_id: p[1], paso: p[2], datos: JSON.parse(p[3]), actualizado_en: Number(p[4]) });
    escrituras++; return { rows: [], rowCount: 1 };
  }
  if (/jsonb_array_length\(coalesce\(e\.datos->'huerfanos'/i.test(s)) {
    const rows = [];
    for (const par of estado.espera) {
      const h = (par[1].datos || {}).huerfanos || [];
      if (h.length) rows.push({ telefono: par[0], datos: par[1].datos, nombre: 'Elena' });
    }
    return { rows: rows, rowCount: rows.length };
  }

  // --- mdtask_pagos_servicios ---
  if (/'comprobantesExtra'/.test(s)) {
    const f = estado.pagos.find(x => x.id === p[0]);
    if (f) {
      f.datos = f.datos || {};
      f.datos.comprobantesExtra = (f.datos.comprobantesExtra || []).concat(JSON.parse(p[1]));
    }
    escrituras++; return { rows: [], rowCount: 1 };
  }
  if (/^update mdtask_pagos_servicios set comprobante_url/i.test(s)) {
    const f = estado.pagos.find(x => x.id === p[0]);
    if (f) Object.assign(f, { comprobante_url: p[1], comprobante_tipo: p[2], canal: 'whatsapp',
      estado: 'pagado', pagado_en: f.pagado_en || Number(p[4]), registrado_por: p[3] });
    escrituras++; return { rows: [], rowCount: 1 };
  }
  if (/^update mdtask_pagos_servicios set estado = 'pagado', monto/i.test(s)) {
    const f = estado.pagos.find(x => x.id === p[0]);
    if (f) Object.assign(f, { estado: 'pagado', monto: p[1], forma_pago: p[2],
      pagado_en: f.pagado_en || Number(p[3]), registrado_por: f.registrado_por || p[4] });
    escrituras++; return { rows: [], rowCount: 1 };
  }
  if (/from mdtask_pagos_servicios p join mdtask_servicios s/i.test(s) && /where p\.id = \$1/i.test(s)) {
    const f = estado.pagos.find(x => x.id === p[0] && !x.eliminado);
    return { rows: f ? [conServicio(f)] : [], rowCount: f ? 1 : 0 };
  }
  if (/responsable_telefono/i.test(s) && /mdtask_pagos_servicios p/i.test(s)) {
    const rows = estado.pagos
      .filter(x => !x.eliminado && x.estado === 'pendiente')
      .map(conServicio)
      .filter(x => x.activo && String(x.responsable_telefono || '').slice(-10) === p[0]);
    return { rows: rows, rowCount: rows.length };
  }
  return { rows: [], rowCount: 0 };
}

function sembrarModulo(ruta, exportaciones) {
  const resuelto = require.resolve(ruta);
  const m = new Module(resuelto, null);
  m.filename = resuelto; m.loaded = true; m.exports = exportaciones;
  require.cache[resuelto] = m;
}
sembrarModulo(path.join(RAIZ, 'api/db.js'), {
  query: (sql, params) => queryFalsa(sql, params),
  dbConfigurada: () => true,
  getPool: () => null,
});

const P = require(path.join(RAIZ, 'api/_pagos-periodos.js'));
const N = require(path.join(RAIZ, 'api/pagos-notificar.js'));
const TEL = '4431234567';

(async () => {

// ── A) EL MONTO ────────────────────────────────────────────────────────────
console.log('\nA) leerMontoYForma - el monto ya no es "el primer numero"');
const CASOS = [
  ['1250 efectivo', 1250, 'efectivo'],
  ['$1,250.50 con tarjeta', 1250.5, 'tarjeta'],
  ['pague 980 en transferencia', 980, 'transferencia'],
  ['total 3,480.00 transferencia', 3480, 'transferencia'],
  ['tarjeta', null, 'tarjeta'],
  ['no se', null, null],
  ['no sé', null, null],
  // Los cinco que ANTES registraban una cifra falsa:
  ['referencia 0450123 pague 1250 efectivo', 1250, 'efectivo'],
  ['pague con la tarjeta terminacion 4021, fueron 850', 850, 'tarjeta'],
  ['el 12/09 pague 1250 en efectivo', 1250, 'efectivo'],
  ['fueron 2 recibos, 1250 en efectivo', 1250, 'efectivo'],
  ['pague el 15 con tarjeta', null, 'tarjeta'],
  // Dos cifras unidas por "o": se pregunta, no se elige la que lleve "pague"
  // delante. Y si ademas dice "no recuerdo", gana el "no recuerdo" y se cierra
  // solo con el comprobante: volver a preguntarle a quien acaba de decir que no
  // lo sabe es la trampa que este modulo ya tenia con el `` de "no se".
  ['pague 1250 o 1300', null, null],
  ['pague 1250 o 1300, no recuerdo bien', null, null],
];
for (const caso of CASOS) {
  const r = N.leerMontoYForma(caso[0]);
  ok(r.monto === caso[1] && r.formaPago === caso[2],
    '"' + caso[0] + '"',
    'esperaba monto=' + caso[1] + ' forma=' + caso[2] + '; medi monto=' + r.monto + ' forma=' + r.formaPago);
}
ok(N.leerMontoYForma('pague 1250 o 1300').ambiguo === true,
  'dos cifras unidas por "o" se marcan AMBIGUAS (el bot pregunta en vez de elegir)');
ok(N.leerMontoYForma('pague 1250 o 1300, no recuerdo bien').ambiguo === false,
  'CONTROL: pero si ademas dice "no recuerdo", NO se le vuelve a preguntar');
// La muestra tiene que EXIGIR cifras concretas: si todos los esperados fueran
// null, un parser que devolviera siempre null pasaria el bloque entero.
ok(CASOS.filter(c => c[1] !== null).length >= 8,
  'CONTROL: la muestra discrimina (hay 8+ casos que exigen un monto concreto)');

// ── B) diasAviso: 0 ────────────────────────────────────────────────────────
console.log('\nB) estadoVisible - un 0 en dias de aviso significa 0, no 3');
const hoyISO = P.hoyMexico();
const dentro3 = masDias(3);
ok(P.estadoVisible({ estado: 'pendiente', fechaLimite: dentro3 }, { diasAviso: 0 }, hoyISO) === 'pendiente',
  'con diasAviso=0, un recibo a 3 dias NO es "por vencer"');
ok(P.estadoVisible({ estado: 'pendiente', fechaLimite: hoyISO }, { diasAviso: 0 }, hoyISO) === 'por_vencer',
  'con diasAviso=0, el recibo de HOY si es "por vencer"');
// Sin este control, un `return "pendiente"` a secas pasaria la primera.
ok(P.estadoVisible({ estado: 'pendiente', fechaLimite: dentro3 }, { diasAviso: 3 }, hoyISO) === 'por_vencer',
  'CONTROL: con diasAviso=3, el mismo recibo SI es "por vencer"');
ok(P.estadoVisible({ estado: 'pendiente', fechaLimite: masDias(-1) }, { diasAviso: 0 }, hoyISO) === 'vencido',
  'CONTROL: lo que ya paso sigue siendo "vencido"');

// ── C) Que atiende este modulo y que le deja al asistente ──────────────────
console.log('\nC) esConsultaDePagos - con su control negativo');
const SI = ['mis pagos', 'pagos pendientes?', 'tengo algun pago pendiente',
  'que recibos me tocan', 'cuanto debo de pagos', 'hay recibos vencidos'];
const NO = ['cuanto le pago a Juan de la semana?', 'ya pague la luz',
  'que tengo pendiente', 'a que hora pagan la nomina',
  'me falta el pago de mi bono', 'hay que pagar al proveedor de dulces'];
for (const t of SI) ok(N.esConsultaDePagos(t) === true, 'SI es de pagos: "' + t + '"');
for (const t of NO) ok(N.esConsultaDePagos(t) === false, 'NO es de pagos: "' + t + '"', 'se lo roba al asistente');

// ── D) El flujo del bot, punta a punta ─────────────────────────────────────
console.log('\nD) El flujo del bot contra la base simulada');
const luz = () => estado.pagos.find(x => x.id === 'pago_luz_1');
const agua = () => estado.pagos.find(x => x.id === 'pago_agua_1');

// La premisa del bloque: esta persona tiene DOS recibos abiertos. Sin eso, los
// dos defectos de abajo no se pueden ejercer y el verde no probaria nada.
const abiertos = await N.pagosAbiertosDe(TEL);
if (abiertos.length !== 2) {
  abortar('la base simulada devolvio ' + abiertos.length + ' pago(s) abierto(s) y hacen falta 2. '
    + 'Sin dos recibos, "la segunda foto se va a otro servicio" no se puede ejercer.');
}

// D1 - "ya pague" con VARIOS abiertos: elegir NO debe cerrar el pago.
let r = await N.resolverPorWhatsapp(TEL, 'ya pague');
ok(/de estos/i.test(String(r)), 'D1 "ya pague" con dos abiertos -> pregunta cual');
r = await N.resolverPorWhatsapp(TEL, '1');
ok(luz().estado === 'pendiente',
  'D1 elegir el numero NO marca pagado (antes lo cerraba con comprobante "undefined")',
  'estado quedo en "' + luz().estado + '"');
ok(luz().comprobante_url == null,
  'D1 y NO escribe ninguna liga de comprobante',
  'comprobante_url = ' + JSON.stringify(luz().comprobante_url));
ok(/foto o el PDF/i.test(String(r)), 'D1 y le PIDE el comprobante, que es lo que su mensaje prometio');

// D2 - llega la foto: ahora si se cierra. Control POSITIVO del bloque.
await N.recibirComprobante(TEL, 'https://res.cloudinary.com/x/recibo.jpg', 'imagen', { uid: 'u1' });
ok(luz().estado === 'pagado' && luz().comprobante_url === 'https://res.cloudinary.com/x/recibo.jpg',
  'D2 CONTROL POSITIVO: con la foto SI se marca pagado, y con su liga real',
  'estado=' + luz().estado + ' url=' + luz().comprobante_url);

// D3 - una SEGUNDA foto (el voucher del banco) no puede cerrar el OTRO recibo.
await N.recibirComprobante(TEL, 'https://res.cloudinary.com/x/voucher.jpg', 'imagen', { uid: 'u1' });
ok(agua().estado === 'pendiente',
  'D3 la segunda foto NO marca pagado el otro servicio (antes lo cerraba con prueba ajena)',
  'el recibo de agua quedo en "' + agua().estado + '"');
ok((luz().datos.comprobantesExtra || []).length === 1,
  'D3 y se anexa al pago en curso en vez de tirarse');

// D4 - el monto con una referencia delante ya no se registra como importe.
await N.resolverPorWhatsapp(TEL, 'referencia 0450123 pague 1250 efectivo');
ok(Number(luz().monto) === 1250,
  'D4 cierra con 1250 y no con 450123 (la referencia ya no se lee como importe)',
  'monto guardado: ' + luz().monto);
ok(luz().forma_pago === 'efectivo', 'D4 y con su forma de pago');

// D5 - el comprobante sin destino NO se pierde al caducar el hilo.
await N.esperaSet(TEL, { pagoId: null, paso: 'elegir',
  datos: { url: 'https://res.cloudinary.com/x/huerfano.jpg', tipo: 'imagen', opciones: ['pago_agua_1'] } });
estado.espera.get(TEL).actualizado_en = Date.now() - 4 * 3600 * 1000;   // 4 h: caducado
const vivo = await N.esperaGet(TEL);
ok(vivo === null, 'D5 el hilo caducado deja de secuestrar los mensajes');
const huerfanos = await N.comprobantesHuerfanos();
ok(huerfanos.length === 1 && huerfanos[0].url === 'https://res.cloudinary.com/x/huerfano.jpg',
  'D5 pero el comprobante SOBREVIVE en el buzon (antes se borraba con el hilo)',
  'el buzon trae ' + huerfanos.length + ' entrada(s)');
await N.esperaSet(TEL, { pagoId: 'pago_agua_1', paso: 'comprobante', datos: {} });
await N.esperaSet(TEL, null);
ok((await N.comprobantesHuerfanos()).length === 1,
  'D5 y sobrevive a que esa persona abra y cierre otro hilo');

// ── Cierre ────────────────────────────────────────────────────────────────
if (escrituras === 0) {
  abortar('CERO escrituras llegaron a la base simulada: los "ok" de arriba no prueban nada.');
}
console.log('\n' + (afirmaciones - fallos) + '/' + afirmaciones + ' afirmaciones · '
  + escrituras + ' escrituras a la base simulada');
if (fallos) { console.log(fallos + ' FALLO(S).'); process.exit(2); }
console.log('Todo en verde.');
})().catch(e => abortar((e && e.stack) || String(e)));
