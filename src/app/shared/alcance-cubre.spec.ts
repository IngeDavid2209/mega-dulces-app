/**
 * 🔭 QUÉ LUGARES VE CADA QUIEN — y el `null` que significaba lo contrario
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  EL DEFECTO QUE ESTAS PRUEBAS FIJAN
 * ═══════════════════════════════════════════════════════════════════════════
 * `sucursalesPermitidas()` devuelve `null` para decir **TODAS**. Cuatro sitios
 * de `checklist.ts` hacían `sucursalesPermitidas(sesion) ?? []` y después
 * filtraban con `.includes(store)`, así que ese `?? []` convertía «todas» en
 * **NINGUNA** — la inversión exacta del significado.
 *
 * A un admin global no le pasaba nada, porque su rama se evalúa antes. Lo
 * sufría quien NO es admin y SÍ es supervisor con el comodín «General (Acceso
 * Total)» en su ficha: la lista le salía vacía ENTERA —ni las tareas de su
 * equipo ni las suyas propias— y la pantalla decía «No tienes tareas hoy» con
 * sus checklists vivos en la base.
 *
 * Reportado por David el 15/sep/2026 con la captura de una Jefa de Zona:
 * puesto capturado, manual existente, tareas emitidas, y los dos contadores en
 * 0 mientras los cuatro botones de bandeja se pintaban con normalidad.
 *
 * ─── POR QUÉ LA GUARDIA DE DISCRIMINACIÓN ────────────────────────────────
 * Un `alcanceCubre` que devolviera SIEMPRE true pasaría todos los casos de
 * «sí ve» de aquí abajo. Por eso el bloque final exige que la misma función
 * diga que NO a alguien: sin eso, la regresión más probable —abrir el alcance
 * a todo el mundo— entraría en verde. Ensanchar la visibilidad es la dirección
 * peligrosa, y estas pruebas tienen que poder cazarla.
 */
import { alcanceCubre, sucursalesPermitidas, esSupervisor, esAdminGlobal } from './permisos.util';

/** La Jefa de Zona de la captura: no es admin, es supervisora, y trae el comodín. */
const CON_COMODIN = {
  rol: 'trabajador',
  nombre: 'Jefa De Zona Con Comodin',
  puestoId: 'gerencia-zona',
  sucursales: ['General (Acceso Total)'],
  puedeVerEstadisticas: true,
};

/** La misma persona, pero con su sucursal escrita. Es el control. */
const CON_SUCURSAL = {
  rol: 'trabajador',
  nombre: 'Jefa De Zona Con Sucursal',
  puestoId: 'gerencia-zona',
  sucursales: ['Morelia Abastos'],
  puedeVerEstadisticas: true,
};

describe('alcanceCubre — el null es TODAS, nunca ninguna', () => {

  it('null cubre cualquier lugar', () => {
    expect(alcanceCubre(null, 'Morelia Abastos')).toBe(true);
    expect(alcanceCubre(null, 'Canindo')).toBe(true);
    expect(alcanceCubre(null, 'RH')).toBe(true);
  });

  it('una lista cubre solo lo que trae', () => {
    expect(alcanceCubre(['Canindo'], 'Canindo')).toBe(true);
    expect(alcanceCubre(['Canindo'], 'Morelia Abastos')).toBe(false);
  });

  it('LA LISTA VACIA NO CUBRE NADA — es lo contrario de null, y confundirlos era el bug', () => {
    expect(alcanceCubre([], 'Canindo')).toBe(false);
    expect(alcanceCubre([], 'Morelia Abastos')).toBe(false);
  });
});

describe('el caso de la captura: Jefa de Zona con «General (Acceso Total)»', () => {

  it('su ficha declara alcance total, asi que sucursalesPermitidas da null', () => {
    expect(sucursalesPermitidas(CON_COMODIN)).toBeNull();
  });

  it('NO es admin global y SI es supervisora: por eso cae en la rama que tenia el defecto', () => {
    // Las dos mitades importan. Si fuera admin global su rama se evalua antes y
    // el defecto no la tocaba; si no fuera supervisora, veria solo lo suyo por
    // nombre y tampoco pasaria por el filtro de lugares.
    expect(esAdminGlobal(CON_COMODIN)).toBe(false);
    expect(esSupervisor(CON_COMODIN)).toBe(true);
  });

  it('VE sus tareas y las de su equipo en cualquier sucursal', () => {
    const permitidas = sucursalesPermitidas(CON_COMODIN);
    const tareas = ['Morelia Abastos', 'Canindo', 'CEDIS', 'RH'];
    const visibles = tareas.filter(s => alcanceCubre(permitidas, s));
    expect(visibles.length).toBe(4);
  });

  it('CON EL DEFECTO no veia ni una: es la reproduccion exacta de la captura', () => {
    // El `?? []` que estaba en los cuatro sitios, escrito tal cual.
    const comoEstaba = sucursalesPermitidas(CON_COMODIN) ?? [];
    const tareas = ['Morelia Abastos', 'Canindo', 'CEDIS', 'RH'];
    const visiblesAntes = tareas.filter(s => comoEstaba.includes(s));
    expect(visiblesAntes.length).toBe(0);   // «No tienes tareas hoy», con las tareas existiendo
  });
});

describe('no se ensancho el acceso de nadie mas', () => {

  it('quien tiene su sucursal escrita sigue viendo exactamente la suya', () => {
    const permitidas = sucursalesPermitidas(CON_SUCURSAL);
    expect(alcanceCubre(permitidas, 'Morelia Abastos')).toBe(true);
    expect(alcanceCubre(permitidas, 'Canindo')).toBe(false);
    expect(alcanceCubre(permitidas, 'CEDIS')).toBe(false);
  });

  it('un usuario nulo no ve nada', () => {
    expect(alcanceCubre(sucursalesPermitidas(null), 'Canindo')).toBe(false);
  });

  // ── GUARDIA DE DISCRIMINACION ──────────────────────────────────────────
  // Sin esto, un `alcanceCubre` que devolviera siempre true pasaria todas las
  // pruebas de «si ve» de arriba. Aqui se exige que la MISMA funcion, sobre la
  // MISMA muestra, produzca un si Y un no.
  it('la muestra discrimina: la misma funcion dice SI a uno y NO al otro', () => {
    const conComodin = sucursalesPermitidas(CON_COMODIN);
    const conSucursal = sucursalesPermitidas(CON_SUCURSAL);
    const ve = alcanceCubre(conComodin, 'Canindo');
    const noVe = alcanceCubre(conSucursal, 'Canindo');
    expect(ve).toBe(true);
    expect(noVe).toBe(false);
    expect(ve).not.toBe(noVe);
  });
});
