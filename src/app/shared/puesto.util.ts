/**
 * 🎯 RESOLUCIÓN DEL PUESTO DE UN USUARIO
 *
 * El puesto es lo que decide qué tareas de manual recibe una persona, así que
 * amarrarlo bien es lo único que separa a un trabajador de sus obligaciones.
 *
 * Hay dos formas de saber el puesto de alguien, en este orden:
 *
 *  1. `puestoId` — el campo nuevo, capturado con el selector del organigrama en
 *     la pantalla de Personal. Es la fuente confiable.
 *  2. `cargo` — el campo viejo, texto libre. Antes del catálogo cada quien lo
 *     escribía como quería ("Cajera", "CAJA", "Auxiliar de cajas"). Se intenta
 *     mapear por los `aliasCargos` del catálogo para no obligar a recapturar a
 *     toda la plantilla el día del cambio.
 *
 * Si ninguna de las dos resuelve, la persona queda SIN PUESTO y no recibe
 * tareas automáticas. Eso es a propósito y es visible: `usuariosSinPuesto()`
 * alimenta el reporte de Personal para que se corrija a mano. Adivinar el
 * puesto de alguien sería peor que dejarlo en blanco: le entregaríamos
 * obligaciones que no le tocan y le esconderíamos las que sí.
 */

import { normalizarNombre } from './permisos.util';
import { PUESTOS_ORGANIGRAMA, PuestoOrganigrama, puestoPorId } from './organigrama.catalogo';

/** De dónde salió el puesto. Lo usa la UI para avisar cuando fue por alias. */
export type OrigenPuesto = 'explicito' | 'alias' | 'ninguno';

export interface PuestoResuelto {
  puestoId: string | null;
  puesto: PuestoOrganigrama | null;
  origen: OrigenPuesto;
}

/**
 * Índice cargo normalizado -> puestoId, armado una sola vez.
 *
 * Incluye el nombre oficial del puesto además de sus alias, porque un cargo
 * pudo haberse capturado ya con el nombre bueno.
 */
const INDICE_ALIAS: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const p of PUESTOS_ORGANIGRAMA) {
    const claves = [p.nombre, ...(p.aliasCargos || [])];
    for (const c of claves) {
      const k = normalizarNombre(c);
      // El primero gana: si dos puestos declaran el mismo alias, se queda el
      // que aparece antes en el organigrama y no se sobreescribe en silencio.
      if (k && !m.has(k)) m.set(k, p.id);
    }
  }
  return m;
})();

/** Resuelve el puesto de un usuario. Nunca lanza. */
export function resolverPuesto(usuario: any): PuestoResuelto {
  if (!usuario) return { puestoId: null, puesto: null, origen: 'ninguno' };

  // 1. El campo explícito. Puede venir en la raíz o dentro de `datos` según de
  //    dónde se leyó el usuario (Postgres guarda el extra en jsonb).
  const explicito: string | undefined = usuario.puestoId || usuario?.datos?.puestoId;
  if (explicito) {
    const p = puestoPorId(explicito);
    if (p) return { puestoId: p.id, puesto: p, origen: 'explicito' };
    // Un puestoId que el catálogo ya no reconoce (puesto retirado o id viejo).
    // No se adivina: se trata como sin puesto para que salga en el reporte.
  }

  // 2. El cargo de texto libre, por alias.
  const porAlias = INDICE_ALIAS.get(normalizarNombre(usuario.cargo));
  if (porAlias) {
    const p = puestoPorId(porAlias);
    if (p) return { puestoId: p.id, puesto: p, origen: 'alias' };
  }

  return { puestoId: null, puesto: null, origen: 'ninguno' };
}

/** Atajo: solo el id del puesto, o null. */
export function puestoIdDe(usuario: any): string | null {
  return resolverPuesto(usuario).puestoId;
}

/**
 * Los usuarios que no tienen puesto resoluble. Son los que hay que corregir a
 * mano en Personal para que empiecen a recibir sus tareas de manual.
 */
export function usuariosSinPuesto(usuarios: any[]): any[] {
  return (usuarios || []).filter(u => resolverPuesto(u).origen === 'ninguno');
}

/**
 * Los usuarios cuyo puesto se está deduciendo del cargo viejo. Funcionan, pero
 * conviene confirmarlos con el selector: un alias acierta hoy y puede dejar de
 * acertar si alguien reescribe el cargo.
 */
export function usuariosConPuestoPorAlias(usuarios: any[]): { usuario: any; puesto: PuestoOrganigrama }[] {
  const out: { usuario: any; puesto: PuestoOrganigrama }[] = [];
  for (const u of usuarios || []) {
    const r = resolverPuesto(u);
    if (r.origen === 'alias' && r.puesto) out.push({ usuario: u, puesto: r.puesto });
  }
  return out;
}
