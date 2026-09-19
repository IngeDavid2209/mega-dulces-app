/**
 * 🎖️ QUIÉN MANDA — y por qué tener un practicante debajo no basta
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  EL DEFECTO QUE ESTAS PRUEBAS FIJAN (19/sep/2026)
 * ═══════════════════════════════════════════════════════════════════════════
 * `esJefatura` decidía el mando con `tieneSubordinados` a secas. El argumento
 * escrito era bueno —manda quien tiene gente reportándole, y eso se mueve solo
 * cuando el organigrama cambia— pero medido resultó ser la arista equivocada:
 *
 *     caja-general              operativo   1 directo (un practicante)
 *     servicios-al-personal     operativo   1
 *     reclutamiento-onboarding  operativo   1
 *
 * Los tres pasaban por jefatura, y con eso se llevaban `/pase-lista` y
 * `/plantilla` — o sea, la pantalla donde se define cuántas plazas autoriza
 * una sucursal. Un Analista de Caja General no decide eso.
 *
 * ─── LA REGLA PIDE LAS DOS COSAS, Y ESA ES LA MITAD QUE IMPORTA ───────────
 * Podría haber sido «su nivel manda» a secas. Medido sobre los 89 puestos, eso
 * ENSANCHA: `coordinador-cajas` y `coordinador-piso-ventas` son `coordinacion`
 * con CERO subordinados declarados y ganarían `/plantilla`. Ensanchar es la
 * única dirección de verdad peligrosa al mover visibilidad (11/sep).
 *
 * Exigiendo las dos —gente debajo Y nivel de mando— el cambio queda en «solo
 * quita»: **2 pierden, 0 ganan**. Hay un caso abajo por cada mitad.
 *
 * ─── LOS FIXTURES SON PUESTOS REALES, NO INVENTADOS ───────────────────────
 * Todos los `puestoId` de aquí existen en `organigrama.catalogo.ts`. Un puesto
 * inventado mediría una rama que el sistema nunca produce, y este repo ya pagó
 * por un fixture con una forma imposible: no solo deja de encontrar defectos,
 * FABRICA defectos que no existen (19/sep, la regla de «vencida»).
 */

import { esJefatura, NIVELES_DE_MANDO } from './alcance.util';
import { puestoPorId, tieneSubordinados, PUESTOS_ORGANIGRAMA } from './organigrama.catalogo';

describe('quién manda: el rango sale del nivel, no de quién cuelgue de ti', () => {

  /** Una ficha como las que produce la app: `puestoId` suelto y en `datos`. */
  const ficha = (puestoId: string, banderas: string[] = []) => {
    const u: any = {
      rol: 'trabajador', nombre: 'X', sucursales: ['Canindo'],
      puestoId, datos: { puestoId, sucursales: ['Canindo'] },
    };
    for (const b of banderas) u[b] = true;
    return u;
  };

  // Las cinco del perfil `capital_humano` en privilegios-por-puesto.js.
  const BANDERAS_CH = ['puedeAdministrarPersonal', 'puedeCrearTareasUnicas',
                       'puedeVerCalendario', 'puedeVerHistorial', 'puedeVerEstadisticas'];

  // ═══ 0 · LA PREMISA, antes de probar nada sobre ella ═════════════════════
  //
  // Si mañana el organigrama les quitara el practicante, los casos de abajo
  // pasarían por el camino equivocado —«no manda porque no tiene a nadie»— y
  // dejarían de medir la regla nueva sin fallar. Esto lo dice en voz alta.

  it('la premisa se sostiene: los tres son OPERATIVOS y SÍ tienen gente debajo', () => {
    for (const id of ['caja-general', 'servicios-al-personal', 'reclutamiento-onboarding']) {
      expect(puestoPorId(id)?.nivel).toBe('operativo');
      expect(tieneSubordinados(id)).toBe(true);
    }
  });

  it('y los dos coordinadores del caso contrario NO tienen gente debajo', () => {
    for (const id of ['coordinador-cajas', 'coordinador-piso-ventas']) {
      expect(puestoPorId(id)?.nivel).toBe('coordinacion');
      expect(tieneSubordinados(id)).toBe(false);
    }
  });

  // ═══ 1 · LO QUE SE QUITA ═════════════════════════════════════════════════

  it('un Analista de Caja General NO manda, aunque tenga un practicante debajo', () => {
    // MAL hasta el 19/sep: daba true y con eso abría /pase-lista y /plantilla.
    expect(esJefatura(ficha('caja-general'))).toBe(false);
  });

  it('Reclutamiento y Onboarding tampoco', () => {
    expect(esJefatura(ficha('reclutamiento-onboarding'))).toBe(false);
  });

  // ═══ 2 · LO QUE SE CONSERVA, Y POR QUÉ VÍA ═══════════════════════════════

  it('Servicios al Personal SIGUE mandando, pero por su BANDERA, no por el practicante', () => {
    // Su perfil de Capital Humano le da `puedeAdministrarPersonal`, y esa área
    // sí administra fichas: es correcto por otra puerta. La prueba de al lado
    // es la que demuestra que la puerta es esa y no la arista del organigrama.
    expect(esJefatura(ficha('servicios-al-personal', BANDERAS_CH))).toBe(true);
  });

  it('…y sin esas banderas, NO manda: la vía es la bandera, no el practicante', () => {
    expect(esJefatura(ficha('servicios-al-personal'))).toBe(false);
  });

  // ═══ 3 · LO QUE NO SE MUEVE (la mitad que más importa) ═══════════════════

  it('una Encargada de Sucursal manda: coordinación CON gente debajo', () => {
    expect(esJefatura(ficha('encargado-sucursal'))).toBe(true);
  });

  it('una Gerencia de Zona manda', () => {
    expect(esJefatura(ficha('gerencia-zona'))).toBe(true);
  });

  it('un Anaquelista no manda, ni antes ni ahora', () => {
    expect(esJefatura(ficha('anaquelista'))).toBe(false);
  });

  it('un admin manda siempre: el rol de sistema no depende del organigrama', () => {
    expect(esJefatura({ rol: 'admin' })).toBe(true);
  });

  // ═══ 4 · QUE NO ENSANCHE — el caso que justifica pedir LAS DOS cosas ═════

  it('coordinador-cajas NO gana el mando: su nivel manda pero no tiene a nadie', () => {
    // Si la regla fuera «su nivel manda» a secas, esto daría true y con ello
    // /plantilla — la definición de cuántas plazas autoriza una tienda.
    // Si Dirección decide que sí manda, la respuesta es declararle sus
    // subordinados en el organigrama, no aflojar esta regla.
    expect(esJefatura(ficha('coordinador-cajas'))).toBe(false);
  });

  it('coordinador-piso-ventas tampoco', () => {
    expect(esJefatura(ficha('coordinador-piso-ventas'))).toBe(false);
  });

  // ═══ 5 · LA RED DE LAS FICHAS SIN PUESTO, intacta ════════════════════════
  //
  // El 15/sep se midieron 44 fichas activas SIN puesto. Si este cambio les
  // tocara el acceso, serían 44 personas cambiando de estado el mismo lunes
  // por un paso que iba de otra cosa.

  it('una ficha SIN puesto pero con bandera de gestión sigue mandando', () => {
    expect(esJefatura({ rol: 'trabajador', sucursales: ['Canindo'],
                        puedeCrearChecklists: true })).toBe(true);
  });

  it('una ficha SIN puesto y SIN banderas sigue sin mandar', () => {
    expect(esJefatura({ rol: 'trabajador', sucursales: ['Canindo'] })).toBe(false);
  });

  it('sin sesión, no manda', () => {
    expect(esJefatura(null)).toBe(false);
    expect(esJefatura(undefined)).toBe(false);
  });

  // ═══ 6 · LAS GUARDIAS ════════════════════════════════════════════════════

  it('la muestra DISCRIMINA: produce mandos y no-mandos', () => {
    // Sin esto, un `esJefatura` que devolviera siempre lo mismo pasaría la
    // mitad de los casos de arriba y la otra mitad fallaría de forma obvia…
    // salvo que alguien "arreglara" las expectativas. Esto lo deja escrito.
    const mandan = ['encargado-sucursal', 'gerencia-zona', 'jefatura-cedis']
      .filter(id => esJefatura(ficha(id))).length;
    const noMandan = ['anaquelista', 'caja-general', 'coordinador-cajas']
      .filter(id => !esJefatura(ficha(id))).length;
    expect(mandan).toBe(3);
    expect(noMandan).toBe(3);
  });

  it('NIVELES_DE_MANDO cubre todos los niveles del catálogo salvo los de ejecución', () => {
    // Si el organigrama gana un nivel y nadie actualiza la lista, ese nivel
    // caería en «no manda» EN SILENCIO. Esto lo convierte en un fallo.
    const nivelesDelCatalogo = new Set(PUESTOS_ORGANIGRAMA
      .filter(p => p.vigente !== false).map(p => p.nivel));
    const ejecucion = ['operativo', 'practicante'];
    const esperados = [...nivelesDelCatalogo].filter(n => !ejecucion.includes(n)).sort();
    expect([...NIVELES_DE_MANDO].sort()).toEqual(esperados);
  });
});
