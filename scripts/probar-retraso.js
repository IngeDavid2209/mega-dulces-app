// ============================================================================
//  PRUEBA: ¿esta tarea se entrega CON RETRASO?  (node scripts/probar-retraso.js)
//
//  Cubre la regla que decide si al entregar se pide justificante. Es la que mas
//  duele cuando se rompe: si dice "tarde" de mas, la persona no puede entregar
//  algo que si hizo a tiempo; si dice "tarde" de menos, se cuelan retrasos sin
//  motivo. Dos cosas que ANTES eran la misma funcion y ahora no:
//
//    itemVencido()        -> ya paso su hora limite. Es para MOSTRARLA.
//    itemEntregadoTarde() -> se hizo despues de su hora. Es para el JUSTIFICANTE.
//
//  No toca la base de datos: son funciones puras sobre objetos de checklist.
//  Si cambias esta logica, cambiala tambien en el front (`entregadaTarde()` en
//  src/app/modules/dashboard/checklist/checklist.ts) y vuelve a correr esto.
// ============================================================================
process.env.TZ = 'America/Mexico_City';
const {
  itemEntregadoTarde, checklistConRetraso, completadaEn, horaLimiteDe, itemVencido,
} = require('../api/asistente-chat.js');

const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
// Un epoch de HOY a la hora que se le diga ("07:50" -> hoy a las 7:50).
const hoyA = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };
// Con limite 08:00, ¿ya paso la hora mientras corre esta prueba? Los casos "sin
// sello" y "pendiente" dependen del reloj a proposito: se juzgan contra ahora.
const YA_PASARON_LAS_8 = Date.now() > hoyA('08:00') + 59 * 1000;

let fallos = 0;
const t = (nombre, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${ok ? '' : `  (dio ${JSON.stringify(real)}, esperaba ${JSON.stringify(esperado)})`}`);
};

// --- Hora limite efectiva: cae a la del CHECKLIST si el item no trae la suya ---
t('hora del item manda',          horaLimiteDe({ horaLimite: '09:00', time: '10:00' }, { time: '08:00' }), '09:00');
t('time legacy del item',         horaLimiteDe({ time: '10:00' }, { time: '08:00' }), '10:00');
t('sin hora propia -> checklist',  horaLimiteDe({}, { time: '08:00' }), '08:00');
t('sin nada -> 23:59',             horaLimiteDe({}, {}), '23:59');

const ck = { date: HOY, time: '08:00', items: [] };

// --- Manda CUANDO se hizo, no el reloj del momento de entregar ---
const aTiempoCheck = { text: 'barrer', checked: true, checkedEn: hoyA('07:50') };
t('marcada 07:50 con limite 08:00 -> NO tarde', itemEntregadoTarde(aTiempoCheck, ck), false);

const tardeCheck = { text: 'barrer', checked: true, checkedEn: hoyA('09:30') };
t('marcada 09:30 con limite 08:00 -> tarde',    itemEntregadoTarde(tardeCheck, ck), true);

// Datos viejos: no hay epoch, pero si el "07:45 AM" que ya se guardaba.
const fotoATiempo = { text: 'vitrina', requiresPhoto: true, photo: 'http://x', photoTime: '07:45 AM' };
t('foto 07:45 AM (solo texto legacy) -> NO tarde', itemEntregadoTarde(fotoATiempo, ck), false);
t('  y su sello se lee bien',                       completadaEn(fotoATiempo, HOY), hoyA('07:45'));

const fotoTarde = { text: 'vitrina', requiresPhoto: true, photo: 'http://x', photoTime: '12:15 PM' };
t('foto 12:15 PM -> tarde', itemEntregadoTarde(fotoTarde, ck), true);

// Antes/despues: la tarea no estuvo lista hasta la de DESPUES.
const antesDespues = {
  text: 'piso', requiresAntesDespues: true,
  photoAntes: 'a', photoAntesTimestamp: hoyA('07:00'),
  photoDespues: 'b', photoDespuesTime: '07:55 AM',
};
t('antes/despues cerrado 07:55 -> NO tarde', itemEntregadoTarde(antesDespues, ck), false);
t('  manda la de DESPUES, no la de ANTES',    completadaEn(antesDespues, HOY), hoyA('07:55'));

// Varias fotos: manda la ULTIMA.
const varias = { text: 'anaquel', requiresVariasFotos: true, photos: [{ url: 'a', timestamp: hoyA('06:00') }, { url: 'b', timestamp: hoyA('07:30') }] };
t('varias fotos, la ultima 07:30 -> NO tarde', itemEntregadoTarde(varias, ck), false);
t('  manda la ULTIMA foto',                     completadaEn(varias, HOY), hoyA('07:30'));

// Sin sello (hecha antes de que se guardaran): se conserva el criterio anterior.
t('hecha sin sello -> se juzga contra ahora', itemEntregadoTarde({ text: 'vieja', checked: true }, ck), YA_PASARON_LAS_8);
t('pendiente -> contra ahora',                itemEntregadoTarde({ text: 'pendiente', checked: false }, ck), YA_PASARON_LAS_8);

// "Vencida" (mostrar) sigue siendo cosa aparte de "tarde" (justificante).
t('vencida mira el reloj aunque este hecha', itemVencido(aTiempoCheck, HOY, ck), YA_PASARON_LAS_8);

// El checklist entero.
t('todo a tiempo -> sin retraso',    checklistConRetraso({ ...ck, items: [aTiempoCheck, fotoATiempo, antesDespues, varias] }), false);
t('un solo item tarde -> con retraso', checklistConRetraso({ ...ck, items: [aTiempoCheck, fotoTarde] }), true);

console.log(fallos ? `\n${fallos} FALLA(S)` : `\nTodo bien (${HOY}).`);
process.exit(fallos ? 1 : 0);
