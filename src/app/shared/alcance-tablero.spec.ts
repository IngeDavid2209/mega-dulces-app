/**
 * 🔒 QUIÉN VE EL TABLERO DE DIRECCIÓN
 *
 * Existe porque yo lo monté SIN condición y lo desplegué así. Las cifras venían
 * con alcance —la carga de checklists filtra por sucursal— pero el tablero
 * enseña además ESTRUCTURA de toda la empresa: las diez unidades de control y
 * el 62 % del silencio. Y lo rotulaba «Dirección · todas las unidades» para
 * cualquiera, que es una mentira para quien ve una sucursal.
 *
 * Un dato agregado de la empresa no deja de ser información de la empresa
 * porque no traiga nombres.
 *
 * La regla que esto fija: **el tablero es de alcance GLOBAL, y la etiqueta de
 * alcance nunca afirma más de lo que la persona ve.** Un gate sin prueba se
 * pierde en el siguiente refactor, y este ya se perdió una vez.
 */
import { esAdminGlobal, esAdminLimitado, sucursalesPermitidas } from './permisos.util';

/**
 * La misma decisión que toma `home.ts`, escrita aquí para poder probarla sin
 * levantar el componente. Si algún día divergen, este archivo es el que dice
 * cuál era la intención.
 */
function verTablero(u: any): boolean {
  return esAdminGlobal(u);
}

function alcanceVisible(u: any): string {
  if (esAdminGlobal(u)) return 'todas las unidades';
  const suc = sucursalesPermitidas(u);
  if (!suc || suc.length === 0) return 'sin alcance asignado';
  if (suc.length === 1) return suc[0];
  return suc.length + ' sucursales';
}

describe('alcance del tablero de Dirección', () => {

  const ADMIN_GLOBAL = { rol: 'admin', alcance: 'global', nombre: 'Dir' };
  const ADMIN_SIN_ALCANCE = { rol: 'admin', nombre: 'Dir 2' }; // alcance ausente = global
  const ADMIN_LIMITADO = { rol: 'admin', alcance: 'sucursales', sucursales: ['8 Esquinas'], nombre: 'Adm' };
  const ADMIN_DOS_SUC = { rol: 'admin', alcance: 'sucursales', sucursales: ['8 Esquinas', 'Canindo'], nombre: 'Adm2' };
  const ENCARGADA = { rol: 'trabajador', puedeVerEstadisticas: true, sucursales: ['Canindo'], nombre: 'Enc' };
  const OPERADORA = { rol: 'trabajador', nombre: 'Op' };

  it('un admin global SÍ lo ve', () => {
    expect(verTablero(ADMIN_GLOBAL)).toBe(true);
  });

  it('un admin sin `alcance` cuenta como global (es el default histórico)', () => {
    // Ojo: `esAdminGlobal` trata la ausencia como 'global'. Cambiar eso dejaría
    // fuera a las cuentas viejas, así que se prueba para que nadie lo "arregle".
    expect(verTablero(ADMIN_SIN_ALCANCE)).toBe(true);
  });

  // ── LOS QUE NO DEBEN VERLO, que es el punto de todo esto ──────────────
  it('un admin LIMITADO a sucursales NO lo ve', () => {
    expect(esAdminLimitado(ADMIN_LIMITADO)).toBe(true);
    expect(verTablero(ADMIN_LIMITADO)).toBe(false);
  });

  it('una Encargada NO lo ve, aunque tenga permiso de estadísticas', () => {
    // Ver números de su sucursal y ver la estructura de la empresa son dos
    // permisos distintos, y antes se confundían porque no había gate.
    expect(verTablero(ENCARGADA)).toBe(false);
  });

  it('una operadora sin banderas NO lo ve', () => {
    expect(verTablero(OPERADORA)).toBe(false);
  });

  it('sin sesión NO lo ve', () => {
    expect(verTablero(null)).toBe(false);
    expect(verTablero(undefined)).toBe(false);
  });

  // ── LA ETIQUETA NO AFIRMA DE MÁS ──────────────────────────────────────
  it('solo el global se rotula «todas las unidades»', () => {
    expect(alcanceVisible(ADMIN_GLOBAL)).toBe('todas las unidades');
    expect(alcanceVisible(ADMIN_LIMITADO)).not.toBe('todas las unidades');
    expect(alcanceVisible(ENCARGADA)).not.toBe('todas las unidades');
  });

  it('la etiqueta nombra la sucursal cuando es una sola, y cuenta cuando son varias', () => {
    expect(alcanceVisible(ADMIN_LIMITADO)).toBe('8 Esquinas');
    expect(alcanceVisible(ADMIN_DOS_SUC)).toBe('2 sucursales');
  });

  it('sin sucursales asignadas lo dice, en vez de fingir alcance', () => {
    expect(alcanceVisible({ rol: 'trabajador', nombre: 'x' })).toBe('sin alcance asignado');
  });

  // ── GUARDIA DE LA PROPIA PRUEBA ───────────────────────────────────────
  // Si `verTablero` devolviera lo mismo para todos, casi todos los casos de
  // arriba seguirían pasando en apariencia. Éste falla si no discrimina.
  it('verTablero DISCRIMINA: global y limitado no dan lo mismo', () => {
    expect(verTablero(ADMIN_GLOBAL)).not.toBe(verTablero(ADMIN_LIMITADO));
  });
});
