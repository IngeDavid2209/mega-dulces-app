// Modelos de dominio del lado del cliente. Coinciden con los del backend
// (schema.prisma) pero los expresamos en TypeScript puro para no acoplar el
// frontend al cliente Prisma.

export type Rol = 'admin' | 'trabajador';
export type Alcance = 'global' | 'sucursales';

export interface Usuario {
  id: string;
  uidFirebase: string | null;
  usuario: string;
  nombre: string;
  correo: string | null;
  cargo: string | null;
  rol: Rol;
  alcance: Alcance | null;
  sucursales: string[];
  areas: string[];
  telefono: string | null;
  puedeCrearChecklists: boolean;
  puedeCrearRutinas: boolean;
  puedeCrearTareasUnicas: boolean;
  puedeVerCheckstore: boolean;
  puedeVerEstadisticas: boolean;
  puedeVerHistorial: boolean;
  puedeAdministrarPersonal: boolean;
  puedeVerCalendario: boolean;
  puedeAdministrarAreas: boolean;
  ultimoLatido: number | null;
  ultimaEdicion: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Checklist {
  id: string;
  docIdFirebase: string | null;
  name: string;
  assigned: string;
  store: string;
  fecha: string;                       // YYYY-MM-DD
  horaLimite: string | null;
  status: string;
  enviado: boolean;
  eliminado: boolean;
  archivado: boolean;
  archivadoMes: string | null;
  archivadoEn: string | null;
  archivadoPor: string | null;
  fotosBorradas: boolean;
  fotosBorradasEn: string | null;
  fotosBorradasCount: number | null;
  notaEmpleado: string | null;
  entregaConRetraso: boolean;
  motivoCategoria: string | null;
  motivoComentario: string | null;
  createdBy: string | null;
  createdByUid: string | null;
  timestampCreacion: number | null;
  catalogoRutinaId: string | null;
  asignacionId: string | null;
  moldeId: string | null;
  mantenimiento: any | null;
  subtareas: any[];
  items: any[];
}

export interface Area {
  id: string;
  nombre: string;
  descripcion: string | null;
  activa: boolean;
  bloqueada: boolean;
  fechaBloqueo: string | null;
  fechaAsignada: string | null;
  horaEntrada: string | null;
  horaSalida: string | null;
  turnoAsignado: string | null;
  esRecurrente: boolean;
  fechaCreacion: string | null;
  fechaModificacion: string | null;
}

export interface RutinaCatalogo {
  id: string;
  nombre: string;
  descripcion: string | null;
  tipo: string | null;
  frecuencia: string | null;
  diaSemana: string | null;
  diaMes: number | null;
  horaInicio: string | null;
  horaLimite: string | null;
  responsableSugerido: string | null;
  nivelCritico: string | null;
  evidencia: string | null;
  tiempoEstimado: number | null;
  tareas: any[];
  activa: boolean;
  creadoPor: string | null;
  creadoEn: number | null;
  actualizadoPor: string | null;
  actualizadoEn: number | null;
}

export interface AsignacionRutina {
  id: string;
  rutinaId: string | null;
  rutinaIdLegacy: string | null;
  rutinaNombre: string | null;
  modoAsignacion: string | null;
  asignados: string[];
  rolObjetivo: string | null;
  store: string | null;
  area: string | null;
  frecuencia: string | null;
  diaSemana: string | null;
  diaMes: number | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  horaInicio: string | null;
  horaLimite: string | null;
  activa: boolean;
}

export interface MoldeChecklist {
  id: string;
  name: string;
  assigned: string;
  store: string | null;
  frecuencia: string | null;
  diaSemana: string | null;
  diaMes: number | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  horaInicio: string | null;
  horaLimite: string | null;
  items: any[];
  activo: boolean;
}

export interface TareaEquipo {
  id: string;
  titulo: string;
  descripcion: string | null;
  jefeEquipo: string | null;
  integrantes: string[];
  store: string | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  cerrado: boolean;
  fases: any[];
  timestampCreacion: number | null;
}

export interface TareaUnica {
  id: string;
  usuarioId: string;
  texto: string;
  completada: boolean;
  fechaCreacion: number;
  instrucciones: string | null;
  subtareas: any[];
}

export interface AgendaItem {
  id: string;
  usuarioId: string;
  texto: string;
  completada: boolean;
  fechaCreacion: number;
  instrucciones: string | null;
  comentarios: string | null;
  adjunto: string | null;
}

export interface Notificacion {
  id: string;
  empleado: string;
  empleadoUid: string | null;
  remitente: string | null;
  titulo: string | null;
  mensaje: string | null;
  leido: boolean;
  fechaCreacion: string;
}

export interface DescansoSemanal {
  id: string;
  empleado: string;
  userId: string | null;
  semanaIso: string;
  dias: string[];
  actualizadoPor: string | null;
  actualizadoEn: number | null;
}

// Respuesta de ranking
export interface RankingDia {
  fecha: string;
  hechos: number;
  total: number;
  porcentaje: number;
}
export interface RankingSucursal {
  sucursal: string;
  promedio: number;
  totalChecklists: number;
  dias: RankingDia[];
}
