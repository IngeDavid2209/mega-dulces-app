/**
 * Modelo de datos para las Asignaciones de Rutinas.
 *
 * Una asignación toma una RutinaMaestra del catálogo y la aplica a:
 *  - una o más sucursales
 *  - uno o más empleados (o todos los de un rol)
 *  - con frecuencia / horario / vigencia (puede heredar del catálogo o sobrescribir)
 *
 * Colección Firestore: `asignaciones_rutinas`
 *
 * Más adelante (Fase 4) el robot leerá de esta colección + el catálogo para
 * generar los checklists del día.
 */

import { FrecuenciaRutina } from './rutinas.types';

/** Cómo se decide a quién le toca esta rutina. */
export type ModoAsignacion =
  | 'porRol'              // Todos los trabajadores de las sucursales que tengan este rol/cargo
  | 'porPersonas';        // Lista explícita de nombres

export interface AsignacionRutina {
  id: string;

  /** ID de la rutina maestra en el catálogo. */
  catalogoRutinaId: string;
  /** Nombre denormalizado para mostrar sin extra fetch. */
  nombreRutina: string;

  // --- ALCANCE ---
  /** Sucursales donde aplica esta asignación. */
  sucursales: string[];

  /** Cómo se elige a las personas. */
  modoAsignacion: ModoAsignacion;
  /** Si es porRol: el cargo objetivo (ej "Cajero", "Encargado"). */
  rolObjetivo?: string;
  /** Si es porPersonas: lista de nombres explícitos. */
  empleadosNombres?: string[];

  // --- CUÁNDO ---
  /** Pueden heredarse de la rutina maestra o sobrescribirse aquí. */
  frecuencia: FrecuenciaRutina;
  diaSemana?: string;                    // si Semanal/Catorcenal
  diaMes?: number;                       // si Mensual/Trimestral
  horaInicio?: string;
  horaLimite?: string;

  /** Vigencia: cuándo empieza y opcionalmente cuándo termina. */
  fechaInicio: string;                   // YYYY-MM-DD
  fechaFin?: string | null;

  // --- ESTADO ---
  activa: boolean;                       // soft-delete / pausar

  // --- AUDITORÍA ---
  creadoPor: string;
  creadoEn: number;
  actualizadoPor?: string;
  actualizadoEn?: number;
}
