/**
 * 🤖 ROBOT DE RUTINAS V2 (Fase 4)
 *
 * Genera checklists del día leyendo:
 *   - catalogo_rutinas    (qué se hace)
 *   - asignaciones_rutinas (a quién y cuándo)
 *
 * Antes (V1, legacy): el robot leía `moldes_checklists`, que mezclaban
 *                     "qué" + "quién" + "cuándo" en un solo doc.
 *
 * Para la transición segura: V1 y V2 corren EN PARALELO. Cada uno usa un prefijo
 * de ID distinto para que no se pisen:
 *   V1 → `${moldeId}_${periodo}`
 *   V2 → `asigv2_${asignacionId}_${periodo}_${sucursalSlug}_${empleadoSlug}`
 *
 * Cuando el cliente complete la migración (Fase 5) se podrá apagar V1.
 */

import { Injectable, inject } from '@angular/core';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';

import { RutinaMaestra, TareaRutinaMaestra } from './rutinas.types';
import { AsignacionRutina } from './asignaciones.types';
import { asignacionAplicaEnFecha, nombreDiaSemana } from './programacion.util';
import { normalizarNombre } from './permisos.util';
import { ConfigTurnos, fechaISO, rutinaPermitidaEnTurno } from './turnos.util';

/** Hooks opcionales que recibe el robot (lógica que vive en el componente). */
export interface RobotV2Hooks {
  esDiaCerrado?: (sucursal: string, fecha: Date) => boolean;
  esSucursalAdministrativa?: (sucursal: string) => boolean;
}

@Injectable({ providedIn: 'root' })
export class RobotRutinasV2Service {
  private firestore = inject(Firestore);

  /**
   * Genera los checklists que corresponden a la fecha dada (por defecto: hoy).
   *
   * Idempotente: si un checklist ya existe, no lo vuelve a crear.
   *
   * @returns número de checklists creados en esta corrida.
   */
  async generarChecklistsDeFecha(
    catalogo: RutinaMaestra[],
    asignaciones: AsignacionRutina[],
    usuarios: any[],
    fecha: Date = new Date(),
    hooks: RobotV2Hooks = {}
  ): Promise<number> {
    if (!catalogo.length || !asignaciones.length) return 0;

    const fechaYmd = this.toYmd(fecha);
    const esDomingo = fecha.getDay() === 0;
    let creados = 0;

    // 🕐 Config de turnos de Canindo: para no generar rutinas a quien esa hora
    // cae fuera de su turno. Mapa nombre->uid para resolver al destinatario.
    let configTurnos: ConfigTurnos | null = null;
    try {
      const ct = await getDoc(doc(this.firestore, 'config', 'turnos'));
      if (ct.exists()) configTurnos = ct.data() as ConfigTurnos;
    } catch { /* sin config => sin restriccion */ }
    const diaISO = fechaISO(fecha);
    const nombreAUid = new Map<string, string>();
    if (configTurnos?.habilitado) {
      for (const u of usuarios) {
        const id = u.id || u.uid;
        if (id && u.nombre) nombreAUid.set(normalizarNombre(u.nombre), id);
      }
    }

    for (const asig of asignaciones) {
      if (!asignacionAplicaEnFecha(asig, fecha)) continue;

      // Buscar la rutina maestra
      const rutina = catalogo.find(r => r.id === asig.catalogoRutinaId && r.activa !== false);
      if (!rutina) continue;
      if (!rutina.tareas || rutina.tareas.length === 0) continue;

      // Por cada sucursal de la asignación
      for (const sucursal of asig.sucursales || []) {
        // Reglas heredadas del V1
        if (hooks.esDiaCerrado?.(sucursal, fecha)) continue;
        if (esDomingo && hooks.esSucursalAdministrativa?.(sucursal) && asig.frecuencia === 'Diaria') continue;

        // Expandir destinatarios (rol → personas, o personas explícitas)
        const destinatarios = this.expandirDestinatarios(asig, usuarios, sucursal);
        if (destinatarios.length === 0) continue;

        // Hora efectiva de esta rutina (misma que se guarda en el checklist).
        const horaRutina = asig.horaLimite || rutina.horaLimite || '23:59';

        for (const dest of destinatarios) {
          // 🕐 Restriccion de turno: si el destinatario tiene turno y la hora de
          // la rutina cae fuera de su turno ese dia, no se le genera.
          if (configTurnos?.habilitado) {
            const uid = nombreAUid.get(normalizarNombre(dest.nombre));
            if (uid && !rutinaPermitidaEnTurno(configTurnos, uid, diaISO, horaRutina)) continue;
          }

          const periodo = this.llavePeriodo(asig, fecha);
          const checklistId = this.idemKey(asig.id, periodo, sucursal, dest.nombre);

          const ref = doc(this.firestore, 'checklists', checklistId);
          const snap = await getDoc(ref);
          if (snap.exists()) continue;

          const payload = this.armarChecklist({
            checklistId, asig, rutina, sucursal, destinatario: dest.nombre,
            fechaYmd
          });

          await setDoc(ref, payload);
          creados++;
        }
      }
    }

    return creados;
  }

  // ============================================================================
  // INTERNAL
  // ============================================================================

  /**
   * Devuelve la lista de nombres de personas que deben recibir esta asignación
   * en `sucursal`. Si modoAsignacion = 'porRol', busca usuarios cuyo cargo
   * contenga el rol y que estén asignados a la sucursal.
   */
  private expandirDestinatarios(
    asig: AsignacionRutina,
    usuarios: any[],
    sucursal: string
  ): { nombre: string }[] {
    if (asig.modoAsignacion === 'porPersonas') {
      return (asig.empleadosNombres || []).map(n => ({ nombre: n }));
    }
    // porRol
    const rolLower = (asig.rolObjetivo || '').toLowerCase().trim();
    if (!rolLower) return [];
    return usuarios
      .filter(u => {
        // Incluir trabajadores Y admins: hay cargos operativos (Encargado,
        // Supervisor) con cuenta admin que igual deben recibir la rutina.
        if (u.rol !== 'trabajador' && u.rol !== 'admin') return false;
        const cargo = (u.cargo || '').toLowerCase();
        if (!cargo.includes(rolLower)) return false;
        const susSuc = u.sucursales || (u.sucursal ? [u.sucursal] : []);
        return susSuc.includes(sucursal);
      })
      .map(u => ({ nombre: u.nombre }));
  }

  /** Llave de periodo para idempotencia (Diaria→fecha, Semanal→semana, etc.) */
  private llavePeriodo(asig: AsignacionRutina, fecha: Date): string {
    const y = fecha.getFullYear();
    const m = fecha.getMonth() + 1;
    const d = fecha.getDate();
    switch (asig.frecuencia) {
      case 'Diaria':       return `${y}-${m}-${d}`;
      case 'Mensual':      return `${y}-${m}`;
      case 'Trimestral':   return `${y}-Q${Math.ceil(m / 3)}`;
      case 'Semanal':      return `${y}-W${this.weekNumber(fecha)}`;
      case 'Catorcenal':   return `${y}-C${Math.ceil(this.weekNumber(fecha) / 2)}`;
      case 'PorEvento':    return `${y}-${m}-${d}`;
      default:             return `${y}-${m}-${d}`;
    }
  }

  /** ISO week number. */
  private weekNumber(d: Date): number {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  /** ID idempotente. Prefijo `asigv2_` para distinguir del robot V1. */
  private idemKey(asignacionId: string, periodo: string, sucursal: string, empleado: string): string {
    return `asigv2_${asignacionId}_${periodo}_${this.slug(sucursal)}_${this.slug(empleado)}`;
  }

  private slug(s: string): string {
    return (s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')   // quita tildes
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40);
  }

  private toYmd(d: Date): string {
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().split('T')[0];
  }

  /**
   * Construye el payload del checklist con el shape que la UI ya conoce.
   * Si la UI cambia, este es el único lugar donde hay que tocar.
   */
  private armarChecklist(args: {
    checklistId: string;
    asig: AsignacionRutina;
    rutina: RutinaMaestra;
    sucursal: string;
    destinatario: string;
    fechaYmd: string;
  }): any {
    const { checklistId, asig, rutina, sucursal, destinatario, fechaYmd } = args;

    const items = (rutina.tareas || []).map((t: TareaRutinaMaestra) => ({
      id: t.id || ('item_' + Math.random().toString(36).slice(2)),
      text: t.text,
      checked: false,
      photo: null,
      photoTime: null,
      photoAntes: null,
      photoAntesTime: null,
      photoAntesTimestamp: null,
      photos: [],
      horaInicio: asig.horaInicio || rutina.horaInicio || null,
      horaLimite: asig.horaLimite || rutina.horaLimite || null,
      requiresPhoto: !!t.requiresPhoto,
      requiresAntesDespues: !!t.requiresAntesDespues,
      requiresVariasFotos: !!t.requiresVariasFotos,
      tiempoEstimadoMin: t.tiempoEstimadoMin || null,
      requiereMonto: !!t.requiereMonto,
      requiereFolio: !!t.requiereFolio,
      requiereComentario: !!t.requiereComentario
    }));

    return {
      id: checklistId,
      timestampCreacion: Date.now(),
      name: `${rutina.nombre} (${asig.frecuencia})`,
      assigned: destinatario,
      store: sucursal,
      date: fechaYmd,
      time: asig.horaLimite || rutina.horaLimite || '23:59',
      status: 'pendiente',
      enviado: false,
      createdBy: 'Robot V2',
      notaEmpleado: '',
      items,
      // Metadatos del nuevo modelo (útiles para debugging y futuras migraciones)
      _v2: true,
      _asignacionId: asig.id,
      _catalogoRutinaId: rutina.id
    };
  }
}
