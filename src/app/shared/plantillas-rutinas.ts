/**
 * Plantillas base de rutinas (precarga del catálogo).
 *
 * Son grupos de rutinas maestras "listas para activar". El admin las activa desde
 * el Catálogo de Rutinas y se copian a la colección `catalogo_rutinas` con id y
 * auditoría frescos. NO viven en Firestore: son una constante de la app, así que
 * no cuestan lecturas ni hay que mantener una colección extra.
 *
 * Definen QUÉ se hace (no a quién ni en qué sucursal: eso es la Asignación).
 * Para rutinas de varios días (ej. "martes y jueves"), se deja la frecuencia más
 * cercana del modelo; el día/los días finales se afinan al asignar.
 */

import { RutinaMaestra, TareaRutinaMaestra, TipoRutina } from './rutinas.types';

/** Una rutina dentro de una plantilla (sin id/auditoría: se generan al activar). */
export type RutinaDePlantilla = Omit<
  RutinaMaestra,
  'id' | 'activa' | 'creadoPor' | 'creadoEn' | 'actualizadoPor' | 'actualizadoEn'
>;

export interface PlantillaRutina {
  id: string;
  nombre: string;
  descripcion: string;
  icono: string;                 // emoji para la tarjeta
  departamento: TipoRutina;
  rutinas: RutinaDePlantilla[];
}

/** Atajo para crear una tarea de checklist simple dentro de una rutina. */
function t(text: string, requiresPhoto = false): TareaRutinaMaestra {
  return {
    id: 'ti_' + Math.random().toString(36).slice(2, 9),
    text,
    requiresPhoto,
    requiresAntesDespues: false,
    requiresVariasFotos: false,
    permiteGaleria: false,
    permiteDocumentos: false
  };
}

export const PLANTILLAS_BASE: PlantillaRutina[] = [
  {
    id: 'pl_apertura',
    nombre: 'Apertura de sucursal',
    descripcion: 'Lo primero del día: abrir, encender y dejar listo el piso de venta.',
    icono: '🌅',
    departamento: 'apertura',
    rutinas: [
      {
        nombre: 'Abrir cortina', tipo: 'apertura',
        descripcion: 'Abrir la cortina y dejar acceso libre a la sucursal.',
        frecuencia: 'Diaria', horaInicio: '06:00', horaLimite: '06:15',
        responsableSugerido: 'Encargado', nivelCritico: 'obligatorio',
        tareas: [t('Abrir cortina principal'), t('Quitar candados y alarmas')]
      },
      {
        nombre: 'Encender luces y equipos', tipo: 'apertura',
        descripcion: 'Encender iluminación, refrigeradores y equipos de cobro.',
        frecuencia: 'Diaria', horaInicio: '06:05', horaLimite: '06:30',
        responsableSugerido: 'Encargado', nivelCritico: 'importante',
        tareas: [t('Encender luces de piso'), t('Encender refrigeradores'), t('Prender cajas registradoras')]
      },
      {
        nombre: 'Revisar piso de venta', tipo: 'apertura',
        descripcion: 'Verificar que el piso esté limpio y surtido antes de abrir al público.',
        frecuencia: 'Diaria', horaInicio: '06:30', horaLimite: '07:00',
        responsableSugerido: 'Vendedor', nivelCritico: 'importante',
        tareas: [t('Revisar limpieza general'), t('Revisar producto surtido', true)]
      }
    ]
  },
  {
    id: 'pl_cierre',
    nombre: 'Cierre de caja',
    descripcion: 'Arqueo y revisión de cajas al final del día.',
    icono: '🌇',
    departamento: 'cierre',
    rutinas: [
      {
        nombre: 'Revisar bolsas de cajas', tipo: 'cierre',
        descripcion: 'Revisar y resguardar las bolsas de cada caja.',
        frecuencia: 'Diaria', horaInicio: '17:00', horaLimite: '17:30',
        responsableSugerido: 'Cajero', nivelCritico: 'obligatorio',
        tareas: [t('Contar efectivo de cada bolsa', true), t('Resguardar en caja fuerte')]
      },
      {
        nombre: 'Revisar estado de cajas', tipo: 'cierre',
        descripcion: 'Verificar el estado y arqueo de las cajas (lun, mié y vie).',
        frecuencia: 'Semanal', diaSemana: 'Lunes', horaInicio: '16:00', horaLimite: '16:30',
        responsableSugerido: 'Encargado', nivelCritico: 'importante',
        tareas: [t('Arqueo de caja', true), t('Anotar diferencias')]
      }
    ]
  },
  {
    id: 'pl_limpieza',
    nombre: 'Limpieza semanal',
    descripcion: 'Rutinas de limpieza del piso de venta a lo largo de la semana.',
    icono: '🧹',
    departamento: 'operacion',
    rutinas: [
      {
        nombre: 'Limpiar pasillos', tipo: 'operacion',
        descripcion: 'Barrer y trapear pasillos (lunes a viernes).',
        frecuencia: 'Diaria', horaInicio: '07:00', horaLimite: '07:45',
        responsableSugerido: 'Limpieza', nivelCritico: 'importante',
        tareas: [t('Barrer pasillos'), t('Trapear pasillos'), t('Foto del resultado', true)]
      },
      {
        nombre: 'Limpiar cabeceras', tipo: 'operacion',
        descripcion: 'Limpiar y acomodar cabeceras de exhibición (martes y jueves).',
        frecuencia: 'Semanal', diaSemana: 'Martes', horaInicio: '15:00', horaLimite: '15:45',
        responsableSugerido: 'Vendedor', nivelCritico: 'informativo',
        tareas: [t('Limpiar cabeceras'), t('Reacomodar producto', true)]
      },
      {
        nombre: 'Limpiar áreas administrativas', tipo: 'administracion',
        descripcion: 'Limpieza de oficinas y áreas administrativas.',
        frecuencia: 'Semanal', diaSemana: 'Viernes', horaInicio: '14:00', horaLimite: '15:00',
        responsableSugerido: 'Limpieza', nivelCritico: 'informativo',
        tareas: [t('Limpiar escritorios'), t('Sacar basura'), t('Trapear oficinas')]
      }
    ]
  },
  {
    id: 'pl_contabilidad',
    nombre: 'Contabilidad diaria',
    descripcion: 'Revisión de caja general y compras.',
    icono: '💼',
    departamento: 'contabilidad',
    rutinas: [
      {
        nombre: 'Revisar caja general', tipo: 'contabilidad',
        descripcion: 'Corte y revisión de la caja general.',
        frecuencia: 'Diaria', horaInicio: '17:00', horaLimite: '18:00',
        responsableSugerido: 'Contador', nivelCritico: 'obligatorio',
        tareas: [t('Corte de caja general', true), t('Registrar ingresos del día')]
      },
      {
        nombre: 'Revisar compras / proveedores', tipo: 'administracion',
        descripcion: 'Revisar pedidos y proveedores según necesidad.',
        frecuencia: 'PorEvento', horaInicio: '', horaLimite: '',
        responsableSugerido: 'Encargado', nivelCritico: 'informativo',
        tareas: [t('Revisar pedidos pendientes'), t('Confirmar con proveedores')]
      }
    ]
  }
];
