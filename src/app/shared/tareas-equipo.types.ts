/**
 * Modelo de datos para "Tareas de Equipo" (proyectos colaborativos en fases).
 *
 * Una tarea de equipo es un proyecto con varios integrantes que avanza por
 * FASES SECUENCIALES (una se desbloquea solo cuando el jefe cierra la anterior).
 *
 * Roles:
 *   - createdBy: el admin/encargado que la creó. Tiene permisos de jefe.
 *   - jefeEquipo: el integrante designado como monitor. Puede agregar tareas
 *                 y subtareas en vivo a cualquiera dentro de la fase activa,
 *                 y cerrar fases.
 *   - integrantes: el resto solo ve y completa SUS items.
 *
 * Almacenamiento: colección `tareas_equipo` en Firestore (separada de
 * `checklists` para no contaminar las queries existentes ni el robot V2).
 */

export type EstadoFaseEquipo = 'pendiente' | 'activa' | 'completa';

export interface SubtareaEquipo {
  id: string;
  texto: string;
  completada: boolean;
  completadaPor?: string;
  completadaEn?: number;
}

export interface ItemEquipo {
  id: string;
  asignado: string;                  // nombre del integrante responsable
  texto: string;
  objetivo?: string;                 // objetivo / meta de la tarea (opcional)
  horaLimite?: string;               // HH:mm opcional
  requiresPhoto?: boolean;
  requiresAntesDespues?: boolean;
  requiresVariasFotos?: boolean;
  completada: boolean;
  completadaEn?: number;             // timestamp
  photo?: string;
  photoTime?: string;                // hora de subida (HH:mm AM/PM)
  photoAntes?: string;
  photoDespues?: string;
  photos?: { url: string; time?: string }[];
  subtareas: SubtareaEquipo[];
  agregadaPor?: string;              // quién la metió (admin creador o jefe)
  agregadaEn?: number;
}

export interface FaseEquipo {
  id: string;
  nombre: string;
  orden: number;                     // 0, 1, 2... para mantener orden estable
  estado: EstadoFaseEquipo;
  items: ItemEquipo[];
  iniciadaEn?: number;
  cerradaEn?: number;
  cerradaPor?: string;
}

export interface TareaEquipo {
  id: string;
  name: string;
  /** Objetivo / meta del proyecto (qué se busca lograr). Opcional. */
  objetivo?: string;
  store: string;
  date: string;                      // YYYY-MM-DD fecha objetivo / límite
  createdBy: string;                 // admin que creó
  jefeEquipo: string;                // integrante designado monitor
  integrantes: string[];             // lista de nombres
  fases: FaseEquipo[];
  cerrado: boolean;                  // true cuando todas las fases completas y el jefe cierra
  cerradoEn?: number;
  timestampCreacion: number;
  /** Tipo discriminador para distinguir de los checklists normales si en
   *  algún snapshot accidental los junta. */
  _tipo: 'equipo';
}
