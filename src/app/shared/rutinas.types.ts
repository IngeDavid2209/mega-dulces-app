/**
 * Modelo de datos para el Catálogo de Rutinas Maestras.
 *
 * Una rutina maestra es una "plantilla" sin asignar. Define QUÉ se hace,
 * NO a quién ni cuándo (eso es Fase 2: Asignaciones).
 *
 * Colección Firestore: `catalogo_rutinas`
 */

export type TipoRutina =
  | 'apertura'        // Apertura de sucursal, encendido de equipos
  | 'cierre'          // Cierre de caja, apagado, conteo
  | 'administracion'  // Trámites, inventarios, supervisión
  | 'contabilidad'    // Corte diario, pólizas, facturación
  | 'operacion';      // Limpieza, acomodo, atención a cliente

export type FrecuenciaRutina =
  | 'Diaria'
  | 'Semanal'
  | 'Catorcenal'
  | 'Mensual'
  | 'Trimestral'
  | 'PorEvento';      // Se ejecuta solo cuando se asigna manualmente

export type NivelCritico = 'obligatorio' | 'importante' | 'informativo';

/** Una tarea dentro del checklist de la rutina maestra. */
export interface TareaRutinaMaestra {
  id: string;
  text: string;
  // Evidencia visual
  requiresPhoto: boolean;
  requiresAntesDespues: boolean;
  requiresVariasFotos: boolean;
  permiteGaleria: boolean;
  permiteDocumentos: boolean;
  tiempoEstimadoMin?: number;        // Tiempo entre foto Antes y Después (en minutos)
  // Evidencia adicional (capturas estructuradas)
  requiereMonto?: boolean;            // Para "Cierre de caja" → monto cobrado
  requiereFolio?: boolean;            // Para "Envío de facturación" → folio del recibo
  requiereComentario?: boolean;       // Comentario obligatorio
}

/** Una rutina maestra del catálogo. */
export interface RutinaMaestra {
  id: string;
  nombre: string;
  tipo: TipoRutina;
  descripcion?: string;

  frecuencia: FrecuenciaRutina;
  diaSemana?: string;                 // si frecuencia Semanal/Catorcenal
  diaMes?: number;                    // si frecuencia Mensual/Trimestral
  horaInicio?: string;                // "HH:mm" 24h
  horaLimite?: string;                // "HH:mm" 24h

  responsableSugerido: string;        // Por rol: "Cajero", "Encargado", "Auxiliar"
  nivelCritico: NivelCritico;

  tareas: TareaRutinaMaestra[];

  /** Soft-delete: las rutinas archivadas no se asignan, pero conservan historial. */
  activa: boolean;

  // Auditoría
  creadoPor: string;
  creadoEn: number;
  actualizadoPor?: string;
  actualizadoEn?: number;
}

/** Roles sugeridos disponibles para "responsableSugerido". */
export const ROLES_RUTINA = [
  'Cajero',
  'Encargado',
  'Auxiliar',
  'Supervisor',
  'Almacenista',
  'Limpieza',
  'Vendedor',
  'Contador'
] as const;

/** Etiquetas humanas para los tipos. */
export const ETIQUETAS_TIPO: Record<TipoRutina, string> = {
  apertura: '🌅 Apertura',
  cierre: '🌇 Cierre',
  administracion: '📋 Administración',
  contabilidad: '💼 Contabilidad',
  operacion: '⚙️ Operación'
};

/** Etiquetas humanas para los niveles críticos. */
export const ETIQUETAS_NIVEL: Record<NivelCritico, string> = {
  obligatorio: '🔴 Obligatorio',
  importante: '🟠 Importante',
  informativo: '🔵 Informativo'
};

/** Etiquetas humanas para las frecuencias. */
export const ETIQUETAS_FRECUENCIA: Record<FrecuenciaRutina, string> = {
  Diaria: 'Todos los días',
  Semanal: 'Cada semana',
  Catorcenal: 'Cada 2 semanas',
  Mensual: 'Cada mes',
  Trimestral: 'Cada 3 meses',
  PorEvento: 'Por evento (manual)'
};
