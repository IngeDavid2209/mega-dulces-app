/**
 * Motor de RECOMENDACIONES INTELIGENTES (puro, reglas simples sin ML).
 *
 * Analiza el historial de `checklists` (últimos N días) y detecta tareas que se
 * repiten y que aún NO están en el catálogo de rutinas, para sugerir agregarlas
 * como predeterminadas.
 *
 * Recomendable si:
 *   - Se repite >= MIN_VECES en una misma sucursal, O la hacen >= MIN_SUCURSALES.
 *   - No existe ya en catalogo_rutinas (por nombre normalizado).
 */

import { RutinaMaestra, FrecuenciaRutina } from './rutinas.types';
import { normalizarNombre } from './permisos.util';

export const MIN_VECES = 3;
export const MIN_SUCURSALES = 2;

export interface Recomendacion {
  clave: string;                 // nombre normalizado (id estable)
  nombre: string;                // nombre original más frecuente (para mostrar)
  frecuencia: FrecuenciaRutina;  // Diaria / Semanal / Mensual (inferida)
  totalVeces: number;
  sucursales: string[];
  vecesPorSucursal: Record<string, number>;
  diasDistintos: number;
  confianza: number;             // 0-100
  nivel: 'Alta' | 'Media' | 'Baja';
  motivo: string;
}

export interface DetectarOpts {
  checklists: any[];             // docs de checklists ya acotados a sucursales visibles
  catalogo: RutinaMaestra[];     // para excluir lo ya configurado
  descartadas?: string[];        // claves descartadas por el admin
  diasVentana?: number;          // por defecto 30
}

function infierreFrecuencia(diasDistintos: number, ventana: number): FrecuenciaRutina {
  // Heurística simple por densidad de días con actividad.
  if (diasDistintos >= Math.min(15, ventana * 0.5)) return 'Diaria';
  if (diasDistintos >= 3) return 'Semanal';
  return 'Mensual';
}

export function detectarRecomendaciones(o: DetectarOpts): Recomendacion[] {
  const ventana = o.diasVentana ?? 30;
  const descartadas = new Set((o.descartadas || []).map(c => normalizarNombre(c)));
  const yaEnCatalogo = new Set(
    o.catalogo.filter(r => r.activa !== false).map(r => normalizarNombre(r.nombre))
  );

  // Agrupar por nombre normalizado.
  interface Grupo {
    clave: string;
    nombresOriginales: Record<string, number>;
    porSucursal: Record<string, number>;
    fechas: Set<string>;
  }
  const grupos = new Map<string, Grupo>();

  for (const c of o.checklists) {
    const nombre = (c.name || '').trim();
    const store = c.store || '';
    if (!nombre || !store) continue;
    if (c.eliminado === true || c.archivado === true) continue;
    const clave = normalizarNombre(nombre);
    if (!clave) continue;

    let g = grupos.get(clave);
    if (!g) { g = { clave, nombresOriginales: {}, porSucursal: {}, fechas: new Set() }; grupos.set(clave, g); }
    g.nombresOriginales[nombre] = (g.nombresOriginales[nombre] || 0) + 1;
    g.porSucursal[store] = (g.porSucursal[store] || 0) + 1;
    if (c.date) g.fechas.add(`${store}|${c.date}`);
  }

  const recos: Recomendacion[] = [];
  for (const g of grupos.values()) {
    if (yaEnCatalogo.has(g.clave) || descartadas.has(g.clave)) continue;

    const sucursales = Object.keys(g.porSucursal);
    const totalVeces = Object.values(g.porSucursal).reduce((a, b) => a + b, 0);
    const maxPorSucursal = Math.max(...Object.values(g.porSucursal));
    const diasDistintos = new Set(Array.from(g.fechas).map(f => f.split('|')[1])).size;

    const recomendable = maxPorSucursal >= MIN_VECES || sucursales.length >= MIN_SUCURSALES;
    if (!recomendable) continue;

    // Nombre a mostrar: el original más frecuente.
    const nombre = Object.entries(g.nombresOriginales).sort((a, b) => b[1] - a[1])[0][0];
    const frecuencia = infierreFrecuencia(diasDistintos, ventana);

    // Confianza: repeticiones + cobertura de sucursales + regularidad.
    const sRep = Math.min(40, maxPorSucursal * 8);
    const sCob = Math.min(30, sucursales.length * 15);
    const sReg = Math.min(30, diasDistintos * 2);
    const confianza = Math.max(0, Math.min(100, Math.round(sRep + sCob + sReg)));
    const nivel = confianza >= 70 ? 'Alta' : confianza >= 45 ? 'Media' : 'Baja';

    const partes: string[] = [];
    if (sucursales.length >= 2) partes.push(`${sucursales.length} sucursales la hacen`);
    partes.push(`${totalVeces} ${totalVeces === 1 ? 'vez' : 'veces'} en ${ventana} días`);
    const motivo = partes.join(' · ');

    recos.push({
      clave: g.clave, nombre, frecuencia, totalVeces,
      sucursales, vecesPorSucursal: g.porSucursal, diasDistintos,
      confianza, nivel, motivo
    });
  }

  return recos.sort((a, b) => b.confianza - a.confianza);
}
