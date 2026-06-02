/**
 * 🏷️ Nivel jerárquico de los empleados.
 *
 * El campo `cargo` del perfil ya nos da pista clara para clasificar entre:
 *   - 'mando'      → posiciones de liderazgo (encargadas, jefas, coordinadores,
 *                    directores, administradores). Cuentan como gestión de la
 *                    sucursal y suelen tener flags de admin/supervisión.
 *   - 'operativo'  → trabajadoras y auxiliares que ejecutan operación diaria.
 *
 * La heurística mira el inicio del nombre del cargo. Si el cliente agrega un
 * cargo nuevo, ajustamos esta lista en un solo lugar.
 */

export type NivelJerarquico = 'mando' | 'operativo';

const PREFIJOS_MANDO = [
  'director',
  'administrador',
  'jefe',
  'jefa',
  'jefatura',
  'gerente',
  'gerencia',
  'coordinador',
  'coordinadora',
  'encargado',
  'encargada',
  'supervisor',
  'supervisora',
  'subgerente'
];

/** Devuelve el nivel jerárquico del cargo. Si el cargo viene vacío, asume operativo. */
export function nivelDeCargo(cargo: string | undefined | null): NivelJerarquico {
  if (!cargo) return 'operativo';
  const c = cargo.trim().toLowerCase();
  if (!c) return 'operativo';
  return PREFIJOS_MANDO.some(pref => c.startsWith(pref)) ? 'mando' : 'operativo';
}

/** Atajo cuando solo nos interesa saber si es mando. */
export function esCargoMando(cargo: string | undefined | null): boolean {
  return nivelDeCargo(cargo) === 'mando';
}

/** Atajo para clasificar un usuario por su `cargo`. */
export function nivelDeUsuario(user: any): NivelJerarquico {
  return nivelDeCargo(user?.cargo);
}
