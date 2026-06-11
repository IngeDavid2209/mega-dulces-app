// =============================================================================
// Migracion Firestore → PostgreSQL
// =============================================================================
// Lee TODAS las colecciones de Firestore con firebase-admin y las inserta en
// Postgres mediante Prisma. Es IDEMPOTENTE: se puede re-ejecutar sin duplicar
// datos gracias al upsert por `docIdFirebase` (id original del doc Firestore).
//
// Uso:
//   1. Configurar FIREBASE_SERVICE_ACCOUNT en .env (el JSON del service account
//      pegado como una sola linea), O bien GOOGLE_APPLICATION_CREDENTIALS con
//      la ruta a un archivo JSON.
//   2. npm run migrate:firestore
//
// Orden de ejecucion (respeta dependencias):
//   1. usuarios          (referenciado por TareaUnica, Checklist.createdByUid)
//   2. areas + areas_operativas (consolidadas)
//   3. rutinas_catalogo
//   4. asignaciones_rutinas  (FK opcional → RutinaCatalogo)
//   5. moldes_checklists
//   6. tareas_equipo
//   7. checklists        (refs a catalogoRutinaId, asignacionId, moldeId)
//   8. notificaciones
//   9. descansos_semanales
//  10. tareas_unicas     (subcollection bajo cada usuario)
//
// IMPORTANTE: si en Firestore hay un campo `password` en texto plano (legacy),
// se hashea con bcrypt antes de guardarlo. Si no existe, passwordHash queda
// null y se reporta para que el admin reinicie esas passwords.
import 'dotenv/config';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import { prisma } from '../src/services/prisma.js';
import { hashPassword } from '../src/utils/password.js';
import type { Rol, Alcance } from '@prisma/client';

// =============================================================================
// INICIALIZACION DE firebase-admin
// =============================================================================
function initFirebase(): Firestore {
  if (admin.apps.length === 0) {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (sa) {
      const parsed = JSON.parse(sa);
      admin.initializeApp({ credential: admin.credential.cert(parsed) });
    } else if (credPath) {
      admin.initializeApp({ credential: admin.credential.applicationDefault() });
    } else {
      throw new Error(
        'Falta credencial Firebase. Configurar FIREBASE_SERVICE_ACCOUNT (JSON inline) ' +
        'o GOOGLE_APPLICATION_CREDENTIALS (path al JSON) en .env'
      );
    }
  }
  return admin.firestore();
}

// =============================================================================
// HELPERS
// =============================================================================
type Stats = { coleccion: string; leidos: number; insertados: number; actualizados: number; saltados: number; errores: number };

function stat(coleccion: string): Stats {
  return { coleccion, leidos: 0, insertados: 0, actualizados: 0, saltados: 0, errores: 0 };
}

function log(s: Stats, mas?: string): void {
  const linea = `  ${s.coleccion.padEnd(26)} ${String(s.leidos).padStart(5)} leidos | ` +
    `${String(s.insertados).padStart(5)} insertados | ${String(s.actualizados).padStart(5)} actualizados | ` +
    `${String(s.saltados).padStart(5)} saltados | ${String(s.errores).padStart(3)} errores`;
  console.log(linea + (mas ? `  ${mas}` : ''));
}

// Convierte un valor "fecha" de Firestore a Date.
// Acepta Timestamp, string 'YYYY-MM-DD', Date, number (ms).
function aDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'number') return new Date(v);
  if (typeof v === 'object' && typeof v.toDate === 'function') return v.toDate();
  if (typeof v === 'object' && '_seconds' in v) return new Date(v._seconds * 1000);
  return null;
}

function aBigInt(v: any): bigint | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return BigInt(Math.floor(v));
  if (typeof v === 'bigint') return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v);
  if (typeof v === 'object' && '_seconds' in v) return BigInt(v._seconds * 1000);
  return null;
}

// =============================================================================
// MAPAS DE IDs Firestore → Postgres (para resolver FKs durante la migracion)
// =============================================================================
const mapaRutinaCatalogo = new Map<string, string>();    // docIdFirebase → Postgres uuid
const mapaAsignacion     = new Map<string, string>();
const mapaMolde          = new Map<string, string>();
const mapaUsuarioPorUid  = new Map<string, string>();    // uidFirebase → usuarioId Postgres
const mapaUsuarioPorNombre = new Map<string, string>();  // nombre lowercase → usuarioId

// =============================================================================
// 1. USUARIOS
// =============================================================================
async function migrarUsuarios(db: Firestore): Promise<Stats> {
  const s = stat('usuarios');
  const snapMain   = await db.collection('usuarios').get();
  const snapLegacy = await db.collection('users').get();
  const docs = [...snapMain.docs, ...snapLegacy.docs];
  s.leidos = docs.length;

  let sinPassword = 0;

  for (const d of docs) {
    const data = d.data() as any;
    try {
      const docId = d.id;
      const passwordHash = data.password ? await hashPassword(String(data.password)) : null;
      if (!passwordHash) sinPassword++;

      const valores = {
        uidFirebase:  docId,                                  // doc id en Firestore = uid de Firebase Auth
        usuario:      (data.usuario || data.user || docId).toString().toLowerCase().trim(),
        nombre:       data.nombre || data.name || docId,
        correo:       data.correo || data.email || null,
        passwordHash,
        cargo:        data.cargo || data.puesto || null,
        rol:          (data.rol || 'trabajador') as Rol,
        alcance:      (data.alcance ?? null) as Alcance | null,
        sucursales:   Array.isArray(data.sucursales) ? data.sucursales : (data.sucursal ? [data.sucursal] : []),
        areas:        Array.isArray(data.areas) ? data.areas : [],
        telefono:     data.telefono || null,
        puedeCrearChecklists:     !!data.puedeCrearChecklists,
        puedeCrearRutinas:        !!data.puedeCrearRutinas,
        puedeCrearTareasUnicas:   !!data.puedeCrearTareasUnicas,
        puedeVerCheckstore:       !!data.puedeVerCheckstore,
        puedeVerEstadisticas:     !!data.puedeVerEstadisticas,
        puedeVerHistorial:        !!data.puedeVerHistorial,
        puedeAdministrarPersonal: !!data.puedeAdministrarPersonal,
        puedeVerCalendario:       !!data.puedeVerCalendario,
        puedeAdministrarAreas:    !!data.puedeAdministrarAreas,
        ultimoLatido:  aBigInt(data.ultimoLatido),
        ultimaEdicion: aBigInt(data.ultimaEdicion),
        raw: data,
      };

      const existe = await prisma.usuario.findUnique({ where: { uidFirebase: docId } });
      let saved;
      if (existe) {
        saved = await prisma.usuario.update({
          where: { uidFirebase: docId },
          data: { ...valores, ...(valores.passwordHash ? {} : { passwordHash: undefined }) },
        });
        s.actualizados++;
      } else {
        saved = await prisma.usuario.create({ data: valores });
        s.insertados++;
      }
      mapaUsuarioPorUid.set(docId, saved.id);
      if (saved.nombre) mapaUsuarioPorNombre.set(saved.nombre.toLowerCase().trim(), saved.id);
    } catch (e: any) {
      s.errores++;
      console.error(`  [usuarios] error doc ${d.id}:`, e.message);
    }
  }

  log(s, sinPassword > 0 ? `(${sinPassword} sin password — pedir reset)` : '');
  return s;
}

// =============================================================================
// 2. AREAS (consolida `areas` + `areas_operativas`)
// =============================================================================
async function migrarAreas(db: Firestore): Promise<Stats> {
  const s = stat('areas (+ areas_operativas)');
  const snap1 = await db.collection('areas').get().catch(() => null);
  const snap2 = await db.collection('areas_operativas').get().catch(() => null);
  const docs = [...(snap1?.docs ?? []), ...(snap2?.docs ?? [])];
  s.leidos = docs.length;

  // dedup por nombre (consolidacion)
  const vistos = new Set<string>();
  for (const d of docs) {
    const data = d.data() as any;
    const nombre = (data.nombre || data.name || d.id).toString().trim();
    if (!nombre || vistos.has(nombre.toLowerCase())) { s.saltados++; continue; }
    vistos.add(nombre.toLowerCase());

    try {
      const valores = {
        docIdFirebase: d.id,
        nombre,
        descripcion:        data.descripcion || data.description || null,
        activa:             data.activa !== false,
        bloqueada:          !!data.bloqueada,
        fechaBloqueo:       aDate(data.fechaBloqueo),
        fechaAsignada:      data.fechaAsignada || null,
        horaEntrada:        data.horaEntrada || null,
        horaSalida:         data.horaSalida || null,
        turnoAsignado:      data.turnoAsignado || null,
        esRecurrente:       !!data.esRecurrente,
        fechaCreacion:      data.fechaCreacion || null,
        fechaModificacion:  data.fechaModificacion || null,
        raw: data,
      };
      await prisma.area.upsert({
        where: { nombre },
        update: valores,
        create: valores,
      });
      s.insertados++;
    } catch (e: any) {
      s.errores++;
      console.error(`  [areas] error doc ${d.id}:`, e.message);
    }
  }
  log(s);
  return s;
}

// =============================================================================
// 3. RUTINAS CATALOGO (V2)
// =============================================================================
async function migrarRutinasCatalogo(db: Firestore): Promise<Stats> {
  const s = stat('rutinas_catalogo');
  const snap = await db.collection('catalogo_rutinas').get().catch(() => null);
  if (!snap) { log(s); return s; }
  s.leidos = snap.docs.length;

  for (const d of snap.docs) {
    const data = d.data() as any;
    try {
      const valores = {
        docIdFirebase: d.id,
        nombre:        data.nombre || data.name || d.id,
        descripcion:   data.descripcion || null,
        tipo:          data.tipo || null,
        frecuencia:    data.frecuencia || null,
        diaSemana:     data.diaSemana || null,
        diaMes:        data.diaMes ?? null,
        horaInicio:    data.horaInicio || null,
        horaLimite:    data.horaLimite || null,
        responsableSugerido: data.responsableSugerido || null,
        nivelCritico:  data.nivelCritico || null,
        evidencia:     data.evidencia || null,
        tiempoEstimado: data.tiempoEstimado ?? null,
        tareas:        data.tareas ?? data.items ?? [],
        activa:        data.activa !== false,
        creadoPor:     data.creadoPor || null,
        creadoEn:      aBigInt(data.creadoEn),
        actualizadoPor: data.actualizadoPor || null,
        actualizadoEn:  aBigInt(data.actualizadoEn),
        raw: data,
      };
      const saved = await prisma.rutinaCatalogo.upsert({
        where: { docIdFirebase: d.id },
        update: valores,
        create: valores,
      });
      mapaRutinaCatalogo.set(d.id, saved.id);
      s.insertados++;
    } catch (e: any) {
      s.errores++;
      console.error(`  [rutinas_catalogo] error doc ${d.id}:`, e.message);
    }
  }
  log(s);
  return s;
}

// =============================================================================
// 4. ASIGNACIONES RUTINAS
// =============================================================================
async function migrarAsignaciones(db: Firestore): Promise<Stats> {
  const s = stat('asignaciones_rutinas');
  const snap = await db.collection('asignaciones_rutinas').get().catch(() => null);
  if (!snap) { log(s); return s; }
  s.leidos = snap.docs.length;

  for (const d of snap.docs) {
    const data = d.data() as any;
    try {
      const rutinaIdFs = data.rutinaId || data.idRutina || null;
      const rutinaIdPg = rutinaIdFs ? mapaRutinaCatalogo.get(rutinaIdFs) ?? null : null;

      const valores = {
        docIdFirebase:  d.id,
        rutinaId:       rutinaIdPg,
        rutinaIdLegacy: rutinaIdFs && !rutinaIdPg ? rutinaIdFs : null,
        rutinaNombre:   data.rutinaNombre || data.nombre || null,
        modoAsignacion: data.modoAsignacion || data.modo || null,
        asignados:      Array.isArray(data.asignados) ? data.asignados : (Array.isArray(data.empleadosNombres) ? data.empleadosNombres : []),
        rolObjetivo:    data.rolObjetivo || null,
        store:          data.store || data.sucursal || null,
        area:           data.area || null,
        frecuencia:     data.frecuencia || null,
        diaSemana:      data.diaSemana || null,
        diaMes:         data.diaMes ?? null,
        fechaInicio:    aDate(data.fechaInicio),
        fechaFin:       aDate(data.fechaFin),
        horaInicio:     data.horaInicio || null,
        horaLimite:     data.horaLimite || null,
        activa:         data.activa !== false,
        raw: data,
      };
      const saved = await prisma.asignacionRutina.upsert({
        where: { docIdFirebase: d.id },
        update: valores,
        create: valores,
      });
      mapaAsignacion.set(d.id, saved.id);
      s.insertados++;
    } catch (e: any) {
      s.errores++;
      console.error(`  [asignaciones_rutinas] error doc ${d.id}:`, e.message);
    }
  }
  log(s);
  return s;
}

// =============================================================================
// 5. MOLDES CHECKLISTS (V1 legacy)
// =============================================================================
async function migrarMoldes(db: Firestore): Promise<Stats> {
  const s = stat('moldes_checklists');
  const snap = await db.collection('moldes_checklists').get().catch(() => null);
  if (!snap) { log(s); return s; }
  s.leidos = snap.docs.length;

  for (const d of snap.docs) {
    const data = d.data() as any;
    try {
      const valores = {
        docIdFirebase: d.id,
        name:          data.name || data.nombre || d.id,
        assigned:      data.assigned || data.asignado || '',
        store:         data.store || data.sucursal || null,
        frecuencia:    data.frecuencia || null,
        diaSemana:     data.diaSemana || null,
        diaMes:        data.diaMes ?? null,
        fechaInicio:   aDate(data.fechaInicio),
        fechaFin:      aDate(data.fechaFin),
        horaInicio:    data.horaInicio || null,
        horaLimite:    data.horaLimite || null,
        items:         data.items ?? [],
        activo:        data.activo !== false,
        raw: data,
      };
      const saved = await prisma.moldeChecklist.upsert({
        where: { docIdFirebase: d.id },
        update: valores,
        create: valores,
      });
      mapaMolde.set(d.id, saved.id);
      s.insertados++;
    } catch (e: any) {
      s.errores++;
      console.error(`  [moldes_checklists] error doc ${d.id}:`, e.message);
    }
  }
  log(s);
  return s;
}

// =============================================================================
// 6. TAREAS DE EQUIPO
// =============================================================================
async function migrarTareasEquipo(db: Firestore): Promise<Stats> {
  const s = stat('tareas_equipo');
  const snap = await db.collection('tareas_equipo').get().catch(() => null);
  if (!snap) { log(s); return s; }
  s.leidos = snap.docs.length;

  for (const d of snap.docs) {
    const data = d.data() as any;
    try {
      const valores = {
        docIdFirebase:    d.id,
        titulo:           data.titulo || data.title || data.nombre || d.id,
        descripcion:      data.descripcion || null,
        jefeEquipo:       data.jefeEquipo || data.jefe || null,
        integrantes:      Array.isArray(data.integrantes) ? data.integrantes : [],
        store:            data.store || data.sucursal || null,
        fechaInicio:      aDate(data.fechaInicio),
        fechaFin:         aDate(data.fechaFin),
        cerrado:          !!data.cerrado,
        fases:            data.fases ?? [],
        timestampCreacion: aBigInt(data.timestampCreacion),
        raw: data,
      };
      await prisma.tareaEquipo.upsert({
        where: { docIdFirebase: d.id },
        update: valores,
        create: valores,
      });
      s.insertados++;
    } catch (e: any) {
      s.errores++;
      console.error(`  [tareas_equipo] error doc ${d.id}:`, e.message);
    }
  }
  log(s);
  return s;
}

// =============================================================================
// 7. CHECKLISTS (la mas grande — tiene FK a Usuario.uidFirebase)
// =============================================================================
async function migrarChecklists(db: Firestore): Promise<Stats> {
  const s = stat('checklists');
  const snap = await db.collection('checklists').get();
  s.leidos = snap.docs.length;

  for (const d of snap.docs) {
    const data = d.data() as any;
    try {
      const fecha = aDate(data.date) || aDate(data.fecha);
      if (!fecha) { s.saltados++; continue; }   // sin fecha no se puede insertar

      const valores: any = {
        docIdFirebase:      d.id,
        name:               data.name || data.nombre || '(sin nombre)',
        assigned:           data.assigned || data.asignado || '(sin asignado)',
        store:              data.store || data.sucursal || '(sin sucursal)',
        fecha,
        horaLimite:         data.time || data.horaLimite || null,
        status:             data.status || 'pendiente',
        enviado:            !!data.enviado,
        eliminado:          !!data.eliminado,
        archivado:          !!data.archivado,
        archivadoMes:       data.archivadoMes || null,
        archivadoEn:        aDate(data.archivadoEn),
        archivadoPor:       data.archivadoPor || null,
        fotosBorradas:      !!data.fotosBorradas,
        fotosBorradasEn:    aDate(data.fotosBorradasEn),
        fotosBorradasCount: data.fotosBorradasCount ?? null,
        notaEmpleado:       data.notaEmpleado || null,
        entregaConRetraso:  !!data.entregaConRetraso,
        motivoCategoria:    data.motivoCategoria || null,
        motivoComentario:   data.motivoComentario || null,
        createdBy:          data.createdBy || null,
        createdByUid:       null,                                  // se resuelve abajo si existe el uid
        timestampCreacion:  aBigInt(data.timestampCreacion),
        catalogoRutinaId:   data._catalogoRutinaId || data.catalogoRutinaId || null,
        asignacionId:       data._asignacionId || data.asignacionId || null,
        moldeId:            data._moldeId || data.moldeId || null,
        mantenimiento:      data.mantenimiento ?? null,
        subtareas:          data.subtareas ?? [],
        items:              data.items ?? [],
        raw: data,
      };

      // Resolver createdByUid si createdBy es un nombre conocido
      if (data.createdBy && typeof data.createdBy === 'string') {
        const uid = mapaUsuarioPorNombre.get(data.createdBy.toLowerCase().trim());
        if (uid) {
          const u = await prisma.usuario.findUnique({ where: { id: uid } });
          if (u?.uidFirebase) valores.createdByUid = u.uidFirebase;
        }
      }

      await prisma.checklist.upsert({
        where: { docIdFirebase: d.id },
        update: valores,
        create: valores,
      });
      s.insertados++;
    } catch (e: any) {
      s.errores++;
      console.error(`  [checklists] error doc ${d.id}:`, e.message);
    }
  }
  log(s);
  return s;
}

// =============================================================================
// 8. NOTIFICACIONES
// =============================================================================
async function migrarNotificaciones(db: Firestore): Promise<Stats> {
  const s = stat('notificaciones');
  const snap = await db.collection('notificaciones').get().catch(() => null);
  if (!snap) { log(s); return s; }
  s.leidos = snap.docs.length;

  for (const d of snap.docs) {
    const data = d.data() as any;
    try {
      const valores = {
        docIdFirebase:  d.id,
        empleado:       data.empleado || data.destinatario || '',
        empleadoUid:    data.empleadoUid || null,
        remitente:      data.remitente || data.de || null,
        titulo:         data.titulo || data.title || null,
        mensaje:        data.mensaje || data.body || null,
        leido:          !!data.leido,
        fechaCreacion:  aDate(data.fechaCreacion) || aDate(data.createdAt) || new Date(),
        raw: data,
      };
      await prisma.notificacion.upsert({
        where: { docIdFirebase: d.id },
        update: valores,
        create: valores,
      });
      s.insertados++;
    } catch (e: any) {
      s.errores++;
      console.error(`  [notificaciones] error doc ${d.id}:`, e.message);
    }
  }
  log(s);
  return s;
}

// =============================================================================
// 9. DESCANSOS SEMANALES
// =============================================================================
async function migrarDescansos(db: Firestore): Promise<Stats> {
  const s = stat('descansos_semanales');
  const snap = await db.collection('descansos_semanales').get().catch(() => null);
  if (!snap) { log(s); return s; }
  s.leidos = snap.docs.length;

  for (const d of snap.docs) {
    const data = d.data() as any;
    try {
      const empleado = data.empleado || data.nombre || '';
      const semanaIso = data.semanaIso || data.semana || data.iso || '';
      if (!empleado || !semanaIso) { s.saltados++; continue; }

      // En Firestore el shape tradicional era `dias: string[]` con multiples
      // dias por semana. Tambien aceptamos legacy `diaDescanso` single como
      // un array de 1 elemento. Si no hay nada, dejamos array vacio.
      let dias: string[] = [];
      if (Array.isArray(data.dias)) dias = data.dias.filter((x: any) => typeof x === 'string');
      else if (typeof data.diaDescanso === 'string' && data.diaDescanso) dias = [data.diaDescanso];
      else if (typeof data.dia === 'string' && data.dia) dias = [data.dia];

      const valores = {
        docIdFirebase: d.id,
        empleado,
        userId:        data.userId || null,
        semanaIso,
        dias,
        actualizadoPor: data.actualizadoPor || null,
        actualizadoEn:  aBigInt(data.actualizadoEn),
        raw: data,
      };
      await prisma.descansoSemanal.upsert({
        where: { empleado_semanaIso: { empleado, semanaIso } },
        update: valores,
        create: valores,
      });
      s.insertados++;
    } catch (e: any) {
      s.errores++;
      console.error(`  [descansos_semanales] error doc ${d.id}:`, e.message);
    }
  }
  log(s);
  return s;
}

// =============================================================================
// 10. TAREAS UNICAS (subcollection bajo cada usuario)
// =============================================================================
async function migrarTareasUnicas(db: Firestore): Promise<Stats> {
  const s = stat('tareas_unicas (sub)');

  for (const [uidFirebase, usuarioId] of mapaUsuarioPorUid.entries()) {
    let snap;
    try {
      snap = await db.collection('usuarios').doc(uidFirebase).collection('tareas_unicas').get();
    } catch {
      continue;
    }
    if (snap.empty) continue;
    s.leidos += snap.docs.length;

    for (const d of snap.docs) {
      const data = d.data() as any;
      try {
        const valores = {
          docIdFirebase: d.id,
          usuarioId,
          texto:         data.texto || data.text || '(sin texto)',
          completada:    !!data.completada,
          fechaCreacion: aBigInt(data.fechaCreacion) ?? BigInt(Date.now()),
          instrucciones: data.instrucciones || null,
          subtareas:     data.subtareas ?? [],
          raw: data,
        };
        await prisma.tareaUnica.upsert({
          where: { docIdFirebase: d.id },
          update: valores,
          create: valores,
        });
        s.insertados++;
      } catch (e: any) {
        s.errores++;
        console.error(`  [tareas_unicas] error doc ${uidFirebase}/${d.id}:`, e.message);
      }
    }
  }
  log(s);
  return s;
}

// =============================================================================
// MAIN
// =============================================================================
async function main(): Promise<void> {
  console.log('============================================================');
  console.log('  MIGRACION FIRESTORE → POSTGRESQL');
  console.log('============================================================');
  const inicio = Date.now();

  const db = initFirebase();
  console.log('[firebase] inicializado correctamente\n');

  const stats: Stats[] = [];

  console.log('--- Etapa 1: identidad ---');
  stats.push(await migrarUsuarios(db));

  console.log('\n--- Etapa 2: catalogos ---');
  stats.push(await migrarAreas(db));
  stats.push(await migrarRutinasCatalogo(db));

  console.log('\n--- Etapa 3: configuracion ---');
  stats.push(await migrarAsignaciones(db));
  stats.push(await migrarMoldes(db));
  stats.push(await migrarTareasEquipo(db));

  console.log('\n--- Etapa 4: operacion ---');
  stats.push(await migrarChecklists(db));
  stats.push(await migrarNotificaciones(db));
  stats.push(await migrarDescansos(db));

  console.log('\n--- Etapa 5: subcollections ---');
  stats.push(await migrarTareasUnicas(db));

  // Resumen final
  console.log('\n============================================================');
  console.log('  RESUMEN');
  console.log('============================================================');
  let totLeidos = 0, totIns = 0, totAct = 0, totSalt = 0, totErr = 0;
  for (const s of stats) {
    totLeidos += s.leidos; totIns += s.insertados; totAct += s.actualizados;
    totSalt += s.saltados; totErr += s.errores;
  }
  console.log(`  TOTAL: ${totLeidos} leidos | ${totIns} insertados | ${totAct} actualizados | ${totSalt} saltados | ${totErr} errores`);
  console.log(`  Tiempo total: ${((Date.now() - inicio) / 1000).toFixed(1)}s`);
  console.log('============================================================');

  if (totErr > 0) {
    console.log('\nHubo errores. Revisar la consola y volver a ejecutar para reintentar (es idempotente).');
  }

  await prisma.$disconnect();
  process.exit(totErr > 0 ? 2 : 0);
}

main().catch(async (err) => {
  console.error('\nFATAL:', err);
  await prisma.$disconnect();
  process.exit(1);
});
