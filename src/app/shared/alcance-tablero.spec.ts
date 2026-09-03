/**
 * 🔒 QUIÉN VE EL TABLERO, Y QUÉ VE DENTRO — son dos preguntas
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  POR QUÉ ESTE ARCHIVO SE REESCRIBIÓ EL 3/SEP
 * ═══════════════════════════════════════════════════════════════════════════
 * La versión anterior probaba una función `verTablero` COPIADA aquí dentro, con
 * la regla `esAdminGlobal`. Su propia cabecera decía «si algún día divergen,
 * este archivo dice cuál era la intención». Divergieron: la app pasó a
 * `hayTableroPara = esJefatura` y esta prueba siguió en verde midiendo su propia
 * copia. Una copia local que se queda atrás no falla — da confianza sobre una
 * intención vieja, que es peor que fallar (§8.11 d y e).
 *
 * Ahora importa las funciones REALES. Si mañana cambian, esto cambia con ellas
 * o revienta; lo que no puede volver a pasar es que mida otra cosa.
 *
 * ─── Y LA SEGUNDA PREGUNTA, que no existía ─────────────────────────────────
 * La prueba vieja contestaba «¿quién ve el tablero?» y por eso el hueco real
 * pasó desapercibido un día entero: el gate estaba puesto en tres bloques y le
 * faltaba al cuarto, así que una Encargada veía el tablero con las DIEZ
 * unidades de control de la empresa y rotulado «Dirección · Canindo».
 * El spec estaba verde. Medía quién entra, no qué hay dentro.
 *
 * Verificado en navegador (3/sep) con el arnés de Chrome, tres sesiones:
 *   global      tablero=1 · unidades=10 · silencioVisible=1 · hueco=0
 *   encargada   tablero=1 · unidades= 0 · silencioVisible=0 · hueco=1
 *   anaquelista tablero=0 · redirige a /tareas-manual
 */
import { hayTableroPara, verNivelEmpresa, esJefatura } from './alcance.util';
import { esAdminGlobal, esAdminLimitado, sucursalesPermitidas } from './permisos.util';

/**
 * La etiqueta de la cabecera, tal como la arma la plantilla. Se escribe aquí
 * porque es una decisión de redacción con consecuencia: decía «Dirección» a
 * quien no lo es.
 */
function etiquetaAlcance(u: any): string {
  const prefijo = verNivelEmpresa(u) ? 'Dirección' : 'Mi alcance';
  if (esAdminGlobal(u)) return prefijo + ' · todas las unidades';
  const suc = sucursalesPermitidas(u);
  if (!suc || suc.length === 0) return prefijo + ' · sin alcance asignado';
  if (suc.length === 1) return prefijo + ' · ' + suc[0];
  return prefijo + ' · ' + suc.length + ' sucursales';
}

describe('quién ve el tablero, y qué ve dentro', () => {

  const ADMIN_GLOBAL      = { rol: 'admin', alcance: 'global', nombre: 'Dir' };
  const ADMIN_SIN_ALCANCE = { rol: 'admin', nombre: 'Dir 2' }; // ausente = global
  const ADMIN_LIMITADO    = { rol: 'admin', alcance: 'sucursales', sucursales: ['8 Esquinas'], nombre: 'Adm' };
  const ADMIN_DOS_SUC     = { rol: 'admin', alcance: 'sucursales', sucursales: ['8 Esquinas', 'Canindo'], nombre: 'Adm2' };
  const ENCARGADA         = { rol: 'trabajador', puestoId: 'encargado-sucursal', puedeVerEstadisticas: true, sucursales: ['Canindo'], nombre: 'Enc' };
  const ANAQUELISTA       = { rol: 'trabajador', puestoId: 'anaquelista', sucursales: ['Canindo'], nombre: 'Ana' };
  const OPERADORA         = { rol: 'trabajador', nombre: 'Op' };

  // ═══ 1 · QUIÉN ENTRA ════════════════════════════════════════════════════
  // La regla es JEFATURA, no admin global: fue una instrucción explícita de
  // David («este solo lo deben de ver las jefaturas»), y antes de ella el
  // tablero lo veía todo el mundo.
  it('Dirección entra', () => {
    expect(hayTableroPara(ADMIN_GLOBAL)).toBe(true);
  });

  it('un admin sin `alcance` entra (es el default histórico, no un descuido)', () => {
    expect(hayTableroPara(ADMIN_SIN_ALCANCE)).toBe(true);
  });

  it('una Encargada entra: es jefatura, tiene gente debajo', () => {
    expect(esJefatura(ENCARGADA)).toBe(true);
    expect(hayTableroPara(ENCARGADA)).toBe(true);
  });

  it('un Anaquelista NO entra, y el guard lo manda a su trabajo', () => {
    // Es el caso que David cazó en pantalla: alguien de lo más bajo de la
    // jerarquía mirando el tablero de la empresa.
    expect(esJefatura(ANAQUELISTA)).toBe(false);
    expect(hayTableroPara(ANAQUELISTA)).toBe(false);
  });

  it('una ficha sin puesto ni banderas NO entra', () => {
    expect(hayTableroPara(OPERADORA)).toBe(false);
  });

  it('sin sesión no entra', () => {
    expect(hayTableroPara(null)).toBe(false);
    expect(hayTableroPara(undefined)).toBe(false);
  });

  // ═══ 2 · QUÉ VE DENTRO ══════════════════════════════════════════════════
  // El nivel EMPRESA es otra cosa: las diez unidades de control y el 62 % del
  // silencio. Un dato agregado de la empresa no deja de ser información de la
  // empresa porque no traiga nombres.
  it('solo alcance global ve el nivel empresa', () => {
    expect(verNivelEmpresa(ADMIN_GLOBAL)).toBe(true);
    expect(verNivelEmpresa(ADMIN_SIN_ALCANCE)).toBe(true);
  });

  it('un admin LIMITADO entra al tablero pero NO ve el nivel empresa', () => {
    // Las dos respuestas son distintas para la misma persona: ahí estaba el
    // hueco. Quien confunda las dos preguntas rompe este caso.
    expect(esAdminLimitado(ADMIN_LIMITADO)).toBe(true);
    expect(hayTableroPara(ADMIN_LIMITADO)).toBe(true);
    expect(verNivelEmpresa(ADMIN_LIMITADO)).toBe(false);
  });

  it('una Encargada entra y NO ve el nivel empresa', () => {
    expect(hayTableroPara(ENCARGADA)).toBe(true);
    expect(verNivelEmpresa(ENCARGADA)).toBe(false);
  });

  // ═══ 3 · LA ETIQUETA NO AFIRMA DE MÁS ═══════════════════════════════════
  it('solo Dirección se rotula «Dirección»', () => {
    expect(etiquetaAlcance(ADMIN_GLOBAL)).toBe('Dirección · todas las unidades');
    expect(etiquetaAlcance(ENCARGADA)).toBe('Mi alcance · Canindo');
    expect(etiquetaAlcance(ADMIN_LIMITADO)).toBe('Mi alcance · 8 Esquinas');
  });

  it('ninguna etiqueta de alcance limitado dice «Dirección»', () => {
    // El defecto literal que se corrigió: «Dirección · Canindo» a una Encargada.
    for (const u of [ENCARGADA, ADMIN_LIMITADO, ADMIN_DOS_SUC]) {
      expect(etiquetaAlcance(u)).not.toContain('Dirección');
    }
  });

  it('nombra la sucursal cuando es una, y cuenta cuando son varias', () => {
    expect(etiquetaAlcance(ADMIN_DOS_SUC)).toBe('Mi alcance · 2 sucursales');
  });

  it('sin sucursales lo dice, en vez de fingir alcance', () => {
    expect(etiquetaAlcance({ rol: 'trabajador', nombre: 'x' })).toBe('Mi alcance · sin alcance asignado');
  });

  // ═══ 4 · GUARDIAS DE LA PROPIA PRUEBA ═══════════════════════════════════
  // Si cualquiera de las dos funciones devolviera lo mismo para todos, casi
  // todos los casos de arriba seguirían pasando en apariencia.
  it('hayTableroPara DISCRIMINA', () => {
    expect(hayTableroPara(ENCARGADA)).not.toBe(hayTableroPara(ANAQUELISTA));
  });

  it('verNivelEmpresa DISCRIMINA', () => {
    expect(verNivelEmpresa(ADMIN_GLOBAL)).not.toBe(verNivelEmpresa(ENCARGADA));
  });

  it('LAS DOS PREGUNTAS SON DISTINTAS: existe alguien que entra y no ve empresa', () => {
    // Ésta es la guardia que faltaba. Si algún día `hayTableroPara` y
    // `verNivelEmpresa` volvieran a coincidir, todo lo de arriba seguiría en
    // verde y el gate por bloque dejaría de tener sentido — sin que nadie lo
    // note hasta que una Encargada vea las diez unidades otra vez.
    const entraSinEmpresa = [ENCARGADA, ADMIN_LIMITADO, ADMIN_DOS_SUC]
      .filter(u => hayTableroPara(u) && !verNivelEmpresa(u));
    expect(entraSinEmpresa.length).toBeGreaterThan(0);
  });
});
