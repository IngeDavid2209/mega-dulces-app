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
import { Firestore, doc, setDoc } from '@angular/fire/firestore';

import { RutinaMaestra, TareaRutinaMaestra } from './rutinas.types';
import { AsignacionRutina } from './asignaciones.types';
import { asignacionAplicaEnFecha, nombreDiaSemana } from './programacion.util';
import { normalizarNombre, existeEmpleadoEnUsuarios } from './permisos.util';
import { ConfigTurnos, fechaISO, rutinaPermitidaEnTurno } from './turnos.util';
import { esDiaDescansoEnFecha, obtenerSemanaISO } from './descansos.util';
import { ApiService } from './api.service'; // FERROCARRIL Etapa 3

/** Hooks opcionales que recibe el robot (lógica que vive en el componente). */
export interface RobotV2Hooks {
  esDiaCerrado?: (sucursal: string, fecha: Date) => boolean;
  esSucursalAdministrativa?: (sucursal: string) => boolean;
}

@Injectable({ providedIn: 'root' })
export class RobotRutinasV2Service {
  private firestore = inject(Firestore);
  private api = inject(ApiService); // FERROCARRIL Etapa 3: checklists en Postgres

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
      // FERROCARRIL Etapa 9 (config): turnos desde Postgres (antes getDoc).
      const respCt = await this.api.get('/api/config?id=turnos').catch(() => null);
      if (respCt?.item) configTurnos = respCt.item as ConfigTurnos;
    } catch { /* sin config => sin restriccion */ }
    const diaISO = fechaISO(fecha);
    // Mapa nombre->uid (siempre, lo usan turnos y descansos).
    const nombreAUid = new Map<string, string>();
    for (const u of usuarios) {
      const id = u.id || u.uid;
      if (id && u.nombre) nombreAUid.set(normalizarNombre(u.nombre), id);
    }

    // 📅 Días de descanso de la semana: para no generar rutinas a quien descansa.
    let descansosSemana: any[] = [];
    try {
      const sem = obtenerSemanaISO(fecha);
      // FERROCARRIL: descansos_semanales desde Postgres (?semanaISO), resp.items
      const resp = await this.api.get('/api/descansos-semanales?semanaISO=' + encodeURIComponent(sem));
      descansosSemana = resp?.items || [];
    } catch { /* sin descansos => no se omite a nadie por descanso */ }

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
        const baseDest = this.expandirDestinatarios(asig, usuarios, sucursal);

        // 🔧 Aplica las EXCEPCIONES de esta fecha (resolución de conflictos):
        //  - personaOriginal con reemplazo  → ese día lo hace otra persona
        //  - personaOriginal con reemplazo null → se omite ese día
        //  - personaOriginal '' con reemplazo → "sin asignar" resuelto a mano
        const excHoy = (asig.excepciones || []).filter(e => e.fecha === fechaYmd);
        const destinatarios = baseDest.flatMap(d => {
          const ex = excHoy.find(e => normalizarNombre(e.personaOriginal || '') === normalizarNombre(d.nombre));
          if (!ex) return [d];
          if (ex.reemplazo == null) return [];
          return [{ nombre: ex.reemplazo }];
        });
        for (const e of excHoy) {
          if (!(e.personaOriginal || '') && e.reemplazo &&
              !destinatarios.some(d => normalizarNombre(d.nombre) === normalizarNombre(e.reemplazo!))) {
            destinatarios.push({ nombre: e.reemplazo });
          }
        }
        if (destinatarios.length === 0) continue;

        // Hora efectiva de esta rutina (misma que se guarda en el checklist).
        const horaRutina = asig.horaLimite || rutina.horaLimite || '23:59';

        // Disponibilidad: ¿esta persona puede ese día/hora? (no descansa, en turno)
        const disponible = (uid: string | undefined): boolean => {
          if (uid && esDiaDescansoEnFecha(fecha, descansosSemana.filter(d => d.userId === uid))) return false;
          if (configTurnos?.habilitado && uid && !rutinaPermitidaEnTurno(configTurnos, uid, diaISO, horaRutina)) return false;
          return true;
        };

        const yaAsignados = new Set<string>();

        for (const dest of destinatarios) {
          let nombreFinal = dest.nombre;

          if (!disponible(nombreAUid.get(normalizarNombre(dest.nombre)))) {
            if (!asig.reasignacionAuto) continue;   // Fase D: omitir si no hay auto-reasignación
            // 🔁 Auto-reasignación: primer disponible de la sucursal no asignado aún.
            const reemplazo = this.primerDisponible(asig, usuarios, sucursal, yaAsignados, disponible, nombreAUid);
            if (!reemplazo) continue;               // nadie disponible → el detector lo marca
            nombreFinal = reemplazo;
          }

          const claveNombre = normalizarNombre(nombreFinal);
          if (yaAsignados.has(claveNombre)) continue;  // evita duplicar a la misma persona
          yaAsignados.add(claveNombre);

          const periodo = this.llavePeriodo(asig, fecha);
          const checklistId = this.idemKey(asig.id, periodo, sucursal, nombreFinal);

          const ref = doc(this.firestore, 'checklists', checklistId);
          // FERROCARRIL Etapa 3: idempotencia leyendo el checklist desde Postgres.
          // ⚠️ FAIL-SAFE: si la consulta de existencia FALLA (parpadeo de red, 500,
          // cold-start del serverless), NO debemos asumir que no existe: al recrearlo
          // sobreescribiríamos con items vacíos un checklist YA ENTREGADO (upsert), y
          // el trabajador vería "se borró su progreso". Ante la duda, asumimos que SÍ
          // existe y NO recreamos. Si de verdad faltaba, se creará en el siguiente ciclo.
          const existe = await this.api.get('/api/checklists?id=' + encodeURIComponent(String(checklistId)))
            .then((r: any) => !!r?.checklist).catch(() => true);
          if (existe) continue;

          const payload = this.armarChecklist({
            checklistId, asig, rutina, sucursal, destinatario: nombreFinal,
            destinatarioUid: nombreAUid.get(normalizarNombre(nombreFinal)) || null,
            fechaYmd
          });

          await setDoc(ref, payload);
          // FERROCARRIL Etapa 3: dual-write del checklist del día a Postgres
          await this.api.guardarChecklist(payload);
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
   * Primer empleado disponible de la sucursal (mismo rol si la asignación es
   * porRol) que aún no esté asignado ese día. Para la auto-reasignación.
   */
  private primerDisponible(
    asig: AsignacionRutina,
    usuarios: any[],
    sucursal: string,
    yaAsignados: Set<string>,
    disponible: (uid: string | undefined) => boolean,
    nombreAUid: Map<string, string>
  ): string | null {
    // 1) Backups priorizados (ordenReemplazo): se prueban EN ORDEN.
    for (const nombre of (asig.ordenReemplazo || [])) {
      const clave = normalizarNombre(nombre);
      const uid = nombreAUid.get(clave);
      if (!clave || !uid || yaAsignados.has(clave)) continue;
      if (disponible(uid)) return nombre;
    }
    // 2) Fallback: primer disponible de la sucursal.
    const objetivo = normalizarNombre(sucursal);
    const comodin = normalizarNombre('General (Acceso Total)');
    const rol = asig.modoAsignacion === 'porRol' ? normalizarNombre(asig.rolObjetivo || '') : '';
    for (const u of usuarios) {
      if (u.rol !== 'trabajador' && u.rol !== 'admin') continue;
      const sucs = (u.sucursales && u.sucursales.length) ? u.sucursales : (u.sucursal ? [u.sucursal] : []);
      const enSuc = sucs.some((s: string) => { const n = normalizarNombre(s); return n === objetivo || n === comodin; });
      if (!enSuc) continue;
      if (rol && !normalizarNombre(u.cargo || '').includes(rol)) continue;
      const clave = normalizarNombre(u.nombre || '');
      if (!clave || yaAsignados.has(clave)) continue;
      if (!disponible(u.id || u.uid)) continue;
      return u.nombre;
    }
    return null;
  }

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
      // Solo personas que SIGUEN existiendo en el sistema. Si a alguien lo dieron
      // de baja pero su nombre quedó en la asignación, ya NO se le genera la tarea
      // (antes se creaba un checklist fantasma que nadie podía completar/enviar).
      //
      // Usamos `existeEmpleadoEnUsuarios` (tolerante) y NO `mismoEmpleadoNombre`:
      // este último exige 2+ palabras en común, así que dejaba fuera a personas
      // reales cuya asignación quedó con el nombre corto (p. ej. "María" en vez
      // de "María López") y el robot dejaba de generarles sus tareas.
      return (asig.empleadosNombres || [])
        .filter(n => existeEmpleadoEnUsuarios(n, usuarios))
        .map(n => ({ nombre: n }));
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
    destinatarioUid?: string | null;
    fechaYmd: string;
  }): any {
    const { checklistId, asig, rutina, sucursal, destinatario, destinatarioUid, fechaYmd } = args;

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
      assignedUid: destinatarioUid || null,
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
