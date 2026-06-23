// Endpoint del ASISTENTE (chat con tool-use).
//
// Corre el BUCLE de herramientas de Claude: el modelo pide una herramienta, el
// servidor la ejecuta de verdad sobre Firestore (firebase-admin), le devuelve el
// resultado, y el modelo sigue hasta terminar.
//
// Herramientas:
//   TAREAS:   agregar_tarea, consultar_tareas, completar_tarea, editar_tarea, eliminar_tarea
//   RUTINAS:  crear_rutina (crea catalogo_rutinas + asignaciones_rutinas)
//   INFO:     consultar_rutinas, resumen_hoy, estadisticas
//
// Variables de entorno (Railway -> Variables):
//   ANTHROPIC_API_KEY, FIREBASE_SERVICE_ACCOUNT, ASISTENTE_MODELO (opcional)

const admin = require('firebase-admin');

let inicializado = false;
function inicializar() {
  if (inicializado) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('Falta variable FIREBASE_SERVICE_ACCOUNT en las variables de entorno.');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  inicializado = true;
}

const MAX_ITERACIONES = 8;

const ROLES = ['Cajero', 'Encargado', 'Auxiliar', 'Supervisor', 'Almacenista', 'Limpieza', 'Vendedor', 'Contador'];
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const FRECUENCIAS = ['Diaria', 'Semanal', 'Catorcenal', 'Mensual', 'Trimestral', 'PorEvento'];
const TIPOS = ['apertura', 'cierre', 'administracion', 'contabilidad', 'operacion'];
const NIVELES = ['obligatorio', 'importante', 'informativo'];

// ---------------------------------------------------------------------------
// Herramientas
// ---------------------------------------------------------------------------
const TOOLS = [
  // --- TAREAS ---
  {
    name: 'agregar_tarea',
    description: 'Crea una tarea/pendiente. Puede ser para una persona, para toda una sucursal, para un rol/cargo, o para TODO el personal del admin. Si no se indica destino, es para el propio usuario. Resuelve fechas relativas a YYYY-MM-DD con la fecha de hoy.',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string' },
        fecha: { type: 'string', description: 'YYYY-MM-DD o vacio' },
        hora_inicio: { type: 'string', description: 'HH:mm' },
        fecha_fin: { type: 'string' }, hora_fin: { type: 'string' },
        prioridad: { type: 'string', enum: ['alta', 'media', 'baja'] },
        para_quien: { type: 'string', description: 'Nombre de UNA persona.' },
        para_sucursal: { type: 'string', description: 'Asigna a TODO el personal de esa sucursal.' },
        para_rol: { type: 'string', enum: ROLES, description: 'Asigna a todos los de ese rol/cargo (puede combinarse con para_sucursal).' },
        para_todos: { type: 'boolean', description: 'true = asigna a TODO el personal en los privilegios del admin.' }
      },
      required: ['titulo']
    }
  },
  {
    name: 'consultar_tareas',
    description: 'Consulta tareas. Por defecto las tuyas; con "persona" puedes ver las de cualquier trabajador (admin). Usala ANTES de completar/editar/eliminar para conocer el id.',
    input_schema: {
      type: 'object',
      properties: {
        filtro: { type: 'string', enum: ['hoy', 'pendientes', 'vencidas', 'todas'] },
        fecha: { type: 'string' },
        persona: { type: 'string', description: 'Nombre de otra persona para ver SUS tareas. Vacio = las tuyas.' }
      },
      required: []
    }
  },
  { name: 'completar_tarea', description: 'Marca una tarea como completada. Requiere id (de consultar_tareas).', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  {
    name: 'editar_tarea', description: 'Modifica una tarea. Requiere id. Solo manda lo que cambia.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, titulo: { type: 'string' }, fecha: { type: 'string' }, hora_inicio: { type: 'string' }, fecha_fin: { type: 'string' }, hora_fin: { type: 'string' }, prioridad: { type: 'string', enum: ['alta', 'media', 'baja'] }, instrucciones: { type: 'string' } }, required: ['id'] }
  },
  { name: 'eliminar_tarea', description: 'Elimina una tarea. Requiere id (de consultar_tareas).', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },

  // --- RUTINAS ---
  {
    name: 'crear_rutina',
    description: 'Crea una rutina recurrente (ej. "todos los lunes y miercoles hacer inventario a las 8am"). Crea la plantilla y la asignacion para que el sistema genere los checklists. Pregunta lo que falte (sucursales y a quien) antes de crear.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre de la rutina.' },
        frecuencia: { type: 'string', enum: FRECUENCIAS, description: 'Diaria, Semanal, Catorcenal, Mensual, Trimestral o PorEvento.' },
        dias_semana: { type: 'array', items: { type: 'string', enum: DIAS }, description: 'Dias (para Semanal/Catorcenal). Ej: ["Lunes","Miércoles"].' },
        dia_mes: { type: 'integer', description: 'Dia del mes (1-31) para Mensual/Trimestral.' },
        hora_inicio: { type: 'string', description: 'HH:mm' },
        hora_limite: { type: 'string', description: 'HH:mm' },
        tipo: { type: 'string', enum: TIPOS, description: 'Tipo de rutina. Por defecto operacion.' },
        nivel_critico: { type: 'string', enum: NIVELES, description: 'Por defecto importante.' },
        sucursales: { type: 'array', items: { type: 'string' }, description: 'Sucursales donde aplica. Usa "todas" para todas las permitidas.' },
        modo: { type: 'string', enum: ['porRol', 'porPersonas'], description: 'Como se asigna.' },
        rol_objetivo: { type: 'string', enum: ROLES, description: 'Si modo=porRol.' },
        personas: { type: 'array', items: { type: 'string' }, description: 'Nombres, si modo=porPersonas.' },
        tareas: { type: 'array', items: { type: 'string' }, description: 'Lista de pasos/tareas del checklist. Opcional.' }
      },
      required: ['nombre', 'frecuencia', 'sucursales', 'modo']
    }
  },

  // --- INFO ---
  {
    name: 'consultar_rutinas',
    description: 'Lista las rutinas activas (asignadas). Usala cuando pregunten que rutinas hay activas o programadas.',
    input_schema: { type: 'object', properties: { sucursal: { type: 'string', description: 'Filtrar por una sucursal. Opcional.' } }, required: [] }
  },
  {
    name: 'resumen_hoy',
    description: 'Da un resumen del dia del usuario: cuantas tareas pendientes tiene para hoy y cuales.',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'estadisticas',
    description: 'Estadisticas (admin: acceso a TODO). Cumplimiento de checklists por SUCURSAL o de TODA la operacion en un dia (completados, pendientes, % cumplimiento). Tambien estadisticas personales de tus tareas.',
    input_schema: {
      type: 'object',
      properties: {
        sucursal: { type: 'string', description: 'Sucursal para el cumplimiento de checklists. Vacio = toda la operacion.' },
        fecha: { type: 'string', description: 'YYYY-MM-DD de los checklists. Por defecto hoy.' },
        dias: { type: 'integer', description: 'Ventana en dias para TUS tareas completadas (por defecto 7).' }
      },
      required: []
    }
  }
];

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
function normaliza(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}
function agendaRef(db, uid) {
  return db.collection('usuarios').doc(uid).collection('agenda');
}
function esAdminGlobal(perfil) {
  const alc = (perfil.alcance || '').toLowerCase();
  return perfil.rol === 'admin' && (alc === 'global' || alc === '' || (perfil.sucursales || []).includes('General (Acceso Total)'));
}
function sucursalesDe(u) {
  return u.sucursales || (u.sucursal ? [u.sucursal] : []);
}
// Sucursales a las que este admin puede asignar.
function sucursalesPermitidas(ctx) {
  if (esAdminGlobal(ctx.perfil)) {
    const set = new Set();
    ctx.usuarios.forEach(u => sucursalesDe(u).forEach(s => { if (s) set.add(s); }));
    return Array.from(set);
  }
  return sucursalesDe(ctx.perfil).filter(s => s && s !== 'General (Acceso Total)');
}
// Distancia de edicion (para tolerar errores de dictado/tipeo).
function levenshtein(a, b) {
  a = a || ''; b = b || '';
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const fila = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = fila[0]; fila[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return fila[n];
}
// ¿Dos palabras se parecen? (tolera 1-2 letras de diferencia segun el largo).
function palabrasParecidas(a, b) {
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  const tol = Math.max(a.length, b.length) >= 6 ? 2 : 1;
  return levenshtein(a, b) <= tol;
}

// Empareja un nombre dictado con un usuario. Devuelve { user, ambiguos }:
//   - user: el usuario si hay UN match claro; null si no.
//   - ambiguos: candidatos cuando hay varios (para que el bot PREGUNTE cual).
// Es estricto para no asignar al equivocado, pero tolera errores de dictado.
function resolverPersona(ctx, nombre) {
  const objetivo = normaliza(nombre);
  if (!objetivo) return { user: null, ambiguos: [] };
  const nombreDe = u => u.nombre || u.correo || '';
  const palabras = objetivo.split(/\s+/).filter(Boolean);

  // 1) Match exacto del nombre completo.
  const exacto = ctx.usuarios.find(u => normaliza(nombreDe(u)) === objetivo);
  if (exacto) return { user: exacto, ambiguos: [] };

  // 2) Match fuerte: el nombre contiene lo dictado (o viceversa), o coinciden
  //    al menos 2 palabras exactas (tipo nombre + apellido).
  const fuertes = ctx.usuarios.filter(u => {
    const n = normaliza(nombreDe(u));
    if (!n) return false;
    if (n.includes(objetivo) || objetivo.includes(n)) return true;
    const set = new Set(n.split(/\s+/));
    return palabras.filter(p => set.has(p)).length >= 2;
  });
  if (fuertes.length === 1) return { user: fuertes[0], ambiguos: [] };
  if (fuertes.length > 1) return { user: null, ambiguos: fuertes.map(nombreDe) };

  // 3) Fuzzy: tolera errores de dictado ("Fransisco" ~ "Francisco"). Cuenta
  //    cuantas palabras dictadas se parecen a alguna palabra del nombre.
  const puntajes = ctx.usuarios.map(u => {
    const tokens = normaliza(nombreDe(u)).split(/\s+/).filter(Boolean);
    let pts = 0;
    for (const p of palabras) if (tokens.some(t => palabrasParecidas(p, t))) pts++;
    return { u, pts };
  });
  const minPts = palabras.length >= 2 ? 2 : 1; // si dictan 2+ palabras, exige 2
  const candidatos = puntajes.filter(c => c.pts >= minPts).sort((a, b) => b.pts - a.pts);
  if (candidatos.length === 1) return { user: candidatos[0].u, ambiguos: [] };
  if (candidatos.length > 1) {
    // Ganador claro por puntaje -> proponerlo (la confirmacion lo valida);
    // empate -> devolver candidatos para que el bot pregunte.
    if (candidatos[0].pts > candidatos[1].pts) return { user: candidatos[0].u, ambiguos: [] };
    return { user: null, ambiguos: candidatos.slice(0, 6).map(c => nombreDe(c.u)) };
  }

  return { user: null, ambiguos: [] };
}

// Personal al que el admin puede asignar (dentro de sus privilegios/sucursales),
// opcionalmente filtrado por sucursal y/o rol(cargo).
function personalAsignable(ctx, opts) {
  opts = opts || {};
  const permitidas = sucursalesPermitidas(ctx);
  const global = esAdminGlobal(ctx.perfil);
  const sNorm = opts.sucursal ? normaliza(opts.sucursal) : null;
  const rNorm = opts.rol ? normaliza(opts.rol) : null;
  return ctx.usuarios.filter(u => {
    if (u.rol !== 'trabajador' && u.rol !== 'admin') return false;
    if (u.id === ctx.uid) return false; // no a uno mismo
    const sus = sucursalesDe(u);
    const enScope = global || sus.some(s => permitidas.some(p => normaliza(p) === normaliza(s)));
    if (!enScope) return false;
    if (sNorm && !sus.some(s => { const x = normaliza(s); return x === sNorm || x.includes(sNorm) || sNorm.includes(x); })) return false;
    if (rNorm && !normaliza(u.cargo || '').includes(rNorm)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Ejecutores
// ---------------------------------------------------------------------------
async function ejecutarHerramienta(db, ctx, nombre, input) {
  input = input || {};

  // ---- TAREAS ----
  if (nombre === 'agregar_tarea') {
    const titulo = String(input.titulo || '').trim();
    if (!titulo) return { ok: false, mensaje: 'Falta el titulo de la tarea.' };
    const construirDoc = (asignadaPor) => ({
      texto: titulo, completada: false, fechaCreacion: Date.now(),
      fecha: input.fecha || '', fechaInicio: input.fecha || '', horaInicio: input.hora_inicio || '',
      fechaFin: input.fecha_fin || '', horaFin: input.hora_fin || '', prioridad: input.prioridad || '',
      instrucciones: '', comentarios: '', adjunto: null, creadaPorVoz: true,
      ...(asignadaPor ? { asignadaPor } : {})
    });

    // Asignacion en GRUPO (sucursal, rol o todos)
    if (input.para_todos || input.para_sucursal || input.para_rol) {
      if (!ctx.esAdmin) return { ok: false, mensaje: 'Solo los administradores pueden asignar a varias personas.' };
      const rol = input.para_rol ? (ROLES.find(r => normaliza(r) === normaliza(input.para_rol)) || input.para_rol) : null;
      const destinatarios = personalAsignable(ctx, { sucursal: input.para_sucursal, rol });
      if (destinatarios.length === 0) return { ok: false, mensaje: 'No encontre personal que coincida con ese grupo en tus sucursales.' };
      for (const u of destinatarios) await agendaRef(db, u.id).add(construirDoc(ctx.nombre));
      const partes = [];
      if (input.para_todos) partes.push('todo tu personal');
      if (rol) partes.push('rol ' + rol);
      if (input.para_sucursal) partes.push('sucursal ' + input.para_sucursal);
      return { ok: true, total: destinatarios.length, mensaje: `Tarea asignada a ${destinatarios.length} persona(s) (${partes.join(', ')}).` };
    }

    // Una sola persona (o uno mismo)
    let uidDestino = ctx.uid, etiqueta = 'tu agenda';
    if (input.para_quien) {
      const r = resolverPersona(ctx, input.para_quien);
      if (!r.user) {
        if (r.ambiguos.length) return { ok: false, mensaje: `Hay varias personas que coinciden con "${input.para_quien}": ${r.ambiguos.slice(0, 6).join(', ')}. ¿A cuál te refieres? Dime el nombre completo.` };
        return { ok: false, mensaje: `No encontre a "${input.para_quien}" en el personal. Verifica el nombre.` };
      }
      uidDestino = r.user.id; etiqueta = r.user.nombre || r.user.correo;
    }
    const ref = await agendaRef(db, uidDestino).add(construirDoc(uidDestino !== ctx.uid ? ctx.nombre : null));
    return { ok: true, id: ref.id, mensaje: `Tarea creada en ${etiqueta}.` };
  }

  if (nombre === 'consultar_tareas') {
    const filtro = input.filtro || 'pendientes', hoy = ctx.fechaHoy;
    let uidConsulta = ctx.uid;
    if (input.persona) {
      const r = resolverPersona(ctx, input.persona);
      if (!r.user) {
        if (r.ambiguos.length) return { ok: false, mensaje: `Hay varias personas que coinciden con "${input.persona}": ${r.ambiguos.slice(0, 6).join(', ')}. Dime el nombre completo.` };
        return { ok: false, mensaje: `No encontre a "${input.persona}" en el personal.` };
      }
      uidConsulta = r.user.id;
    }
    const snap = await agendaRef(db, uidConsulta).get();
    let lista = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
    if (filtro === 'hoy') lista = lista.filter(t => !t.completada && t.fecha === hoy);
    else if (filtro === 'vencidas') lista = lista.filter(t => !t.completada && t.fecha && t.fecha < hoy);
    else if (filtro === 'todas') { /* todas */ }
    else if (input.fecha) lista = lista.filter(t => !t.completada && t.fecha === input.fecha);
    else lista = lista.filter(t => !t.completada);
    return { ok: true, total: lista.length, tareas: lista.map(t => ({ id: t.id, titulo: t.texto, fecha: t.fecha || '', hora_inicio: t.horaInicio || '', prioridad: t.prioridad || '', completada: !!t.completada })) };
  }

  if (nombre === 'completar_tarea') {
    if (!input.id) return { ok: false, mensaje: 'Falta el id.' };
    await agendaRef(db, ctx.uid).doc(input.id).update({ completada: true, completadaEn: Date.now() });
    return { ok: true, mensaje: 'Tarea completada.' };
  }

  if (nombre === 'editar_tarea') {
    if (!input.id) return { ok: false, mensaje: 'Falta el id.' };
    const c = {};
    if (input.titulo != null) c.texto = input.titulo;
    if (input.fecha != null) { c.fecha = input.fecha; c.fechaInicio = input.fecha; }
    if (input.hora_inicio != null) c.horaInicio = input.hora_inicio;
    if (input.fecha_fin != null) c.fechaFin = input.fecha_fin;
    if (input.hora_fin != null) c.horaFin = input.hora_fin;
    if (input.prioridad != null) c.prioridad = input.prioridad;
    if (input.instrucciones != null) c.instrucciones = input.instrucciones;
    if (!Object.keys(c).length) return { ok: false, mensaje: 'No indicaste que cambiar.' };
    await agendaRef(db, ctx.uid).doc(input.id).update(c);
    return { ok: true, mensaje: 'Tarea actualizada.' };
  }

  if (nombre === 'eliminar_tarea') {
    if (!input.id) return { ok: false, mensaje: 'Falta el id.' };
    await agendaRef(db, ctx.uid).doc(input.id).delete();
    return { ok: true, mensaje: 'Tarea eliminada.' };
  }

  // ---- RUTINAS ----
  if (nombre === 'crear_rutina') {
    if (ctx.perfil.rol !== 'admin') return { ok: false, mensaje: 'Solo los administradores pueden crear rutinas.' };
    const nombreR = String(input.nombre || '').trim();
    if (!nombreR) return { ok: false, mensaje: 'Falta el nombre de la rutina.' };
    const frecuencia = FRECUENCIAS.includes(input.frecuencia) ? input.frecuencia : 'Diaria';

    // Sucursales (resolver "todas")
    const permitidas = sucursalesPermitidas(ctx);
    let sucursales = Array.isArray(input.sucursales) ? input.sucursales : [];
    if (sucursales.some(s => normaliza(s) === 'todas') || sucursales.length === 0) sucursales = permitidas;
    // Conservar solo las permitidas (match flexible)
    sucursales = sucursales.filter(s => permitidas.some(p => normaliza(p) === normaliza(s)))
      .map(s => permitidas.find(p => normaliza(p) === normaliza(s)) || s);
    sucursales = Array.from(new Set(sucursales));
    if (sucursales.length === 0) return { ok: false, mensaje: 'No identifique sucursales validas. Sucursales disponibles: ' + permitidas.join(', ') };

    const modo = input.modo === 'porPersonas' ? 'porPersonas' : 'porRol';
    let rolObjetivo = '', empleadosNombres = [];
    if (modo === 'porRol') {
      rolObjetivo = ROLES.find(r => normaliza(r) === normaliza(input.rol_objetivo)) || input.rol_objetivo || 'Encargado';
    } else {
      const nombres = Array.isArray(input.personas) ? input.personas : [];
      if (nombres.length === 0) return { ok: false, mensaje: 'No indicaste a que personas asignar la rutina.' };
      for (const n of nombres) {
        const r = resolverPersona(ctx, n);
        if (!r.user) {
          if (r.ambiguos.length) return { ok: false, mensaje: `Hay varias personas que coinciden con "${n}": ${r.ambiguos.slice(0, 6).join(', ')}. Dime el nombre completo.` };
          return { ok: false, mensaje: `No encontre a "${n}" en el personal.` };
        }
        empleadosNombres.push(r.user.nombre || r.user.correo);
      }
    }

    const dias = Array.isArray(input.dias_semana) ? input.dias_semana.filter(d => DIAS.includes(d)) : [];
    const ahora = Date.now();

    // 1) Plantilla en el catalogo
    const tareasTxt = Array.isArray(input.tareas) && input.tareas.length ? input.tareas : [nombreR];
    const catRef = db.collection('catalogo_rutinas').doc();
    await catRef.set({
      id: catRef.id, nombre: nombreR,
      tipo: TIPOS.includes(input.tipo) ? input.tipo : 'operacion',
      descripcion: '',
      frecuencia,
      diaSemana: dias[0] || '',
      diaMes: input.dia_mes || null,
      horaInicio: input.hora_inicio || '', horaLimite: input.hora_limite || '',
      responsableSugerido: rolObjetivo || 'Encargado',
      nivelCritico: NIVELES.includes(input.nivel_critico) ? input.nivel_critico : 'importante',
      tareas: tareasTxt.map((t, i) => ({
        id: 't' + i + '_' + ahora, text: String(t),
        requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false,
        permiteGaleria: true, permiteDocumentos: true
      })),
      activa: true, creadoPor: ctx.nombre, creadoEn: ahora
    });

    // 2) Asignacion(es). Para Semanal/Catorcenal con varios dias, una por dia.
    const base = {
      catalogoRutinaId: catRef.id, nombreRutina: nombreR,
      sucursales, modoAsignacion: modo, frecuencia,
      horaInicio: input.hora_inicio || '', horaLimite: input.hora_limite || '',
      fechaInicio: ctx.fechaHoy || '', fechaFin: null,
      activa: true, creadoPor: ctx.nombre, creadoEn: ahora
    };
    if (modo === 'porRol') base.rolObjetivo = rolObjetivo; else base.empleadosNombres = empleadosNombres;
    if (frecuencia === 'Mensual' || frecuencia === 'Trimestral') base.diaMes = input.dia_mes || 1;

    let creadas = 0;
    if ((frecuencia === 'Semanal' || frecuencia === 'Catorcenal') && dias.length) {
      for (const d of dias) {
        const aref = db.collection('asignaciones_rutinas').doc();
        await aref.set({ id: aref.id, ...base, diaSemana: d });
        creadas++;
      }
    } else {
      const aref = db.collection('asignaciones_rutinas').doc();
      const extra = (frecuencia === 'Semanal' || frecuencia === 'Catorcenal') ? { diaSemana: dias[0] || 'Lunes' } : {};
      await aref.set({ id: aref.id, ...base, ...extra });
      creadas++;
    }

    const aQuien = modo === 'porRol' ? `rol ${rolObjetivo}` : empleadosNombres.join(', ');
    return { ok: true, mensaje: `Rutina "${nombreR}" creada (${frecuencia}${dias.length ? ' ' + dias.join(', ') : ''}) para ${aQuien} en ${sucursales.join(', ')}.` };
  }

  // ---- INFO ----
  if (nombre === 'consultar_rutinas') {
    const snap = await db.collection('asignaciones_rutinas').get();
    let lista = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) })).filter(a => a.activa !== false);
    if (input.sucursal) lista = lista.filter(a => (a.sucursales || []).some(s => normaliza(s) === normaliza(input.sucursal)));
    return {
      ok: true, total: lista.length,
      rutinas: lista.slice(0, 40).map(a => ({
        nombre: a.nombreRutina, frecuencia: a.frecuencia, dia: a.diaSemana || a.diaMes || '',
        asignado: a.modoAsignacion === 'porRol' ? ('rol ' + (a.rolObjetivo || '')) : (a.empleadosNombres || []).join(', '),
        sucursales: a.sucursales || []
      }))
    };
  }

  if (nombre === 'resumen_hoy') {
    const hoy = ctx.fechaHoy;
    const snap = await agendaRef(db, ctx.uid).get();
    const todas = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
    const deHoy = todas.filter(t => !t.completada && t.fecha === hoy);
    const vencidas = todas.filter(t => !t.completada && t.fecha && t.fecha < hoy);
    return {
      ok: true,
      pendientes_hoy: deHoy.length, vencidas: vencidas.length,
      tareas_hoy: deHoy.map(t => t.texto), tareas_vencidas: vencidas.map(t => t.texto)
    };
  }

  if (nombre === 'estadisticas') {
    // Cumplimiento de checklists del dia (por sucursal o toda la operacion).
    let checklists = null;
    const fecha = input.fecha || ctx.fechaHoy;
    if (fecha) {
      const cs = await db.collection('checklists').where('date', '==', fecha).get();
      let docs = cs.docs.map(d => d.data() || {}).filter(c => !c.eliminado && !c.archivado);
      if (input.sucursal) {
        const s = normaliza(input.sucursal);
        docs = docs.filter(c => { const st = normaliza(c.store || ''); return st === s || st.includes(s) || s.includes(st); });
      }
      const total = docs.length;
      const completados = docs.filter(c => c.enviado === true).length;
      checklists = {
        fecha, sucursal: input.sucursal || 'toda la operacion',
        total, completados, pendientes: total - completados,
        cumplimiento_pct: total ? Math.round(completados * 100 / total) : 0
      };
    }
    // Estadisticas personales del usuario.
    const dias = input.dias && input.dias > 0 ? input.dias : 7;
    const desde = Date.now() - dias * 24 * 60 * 60 * 1000;
    const snap = await agendaRef(db, ctx.uid).get();
    const todas = snap.docs.map(d => d.data() || {});
    const mis_tareas = {
      ventana_dias: dias,
      completadas_en_ventana: todas.filter(t => t.completada && (t.completadaEn || 0) >= desde).length,
      pendientes_totales: todas.filter(t => !t.completada).length
    };
    return { ok: true, checklists, mis_tareas };
  }

  return { ok: false, mensaje: 'Herramienta desconocida: ' + nombre };
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------
async function llamarClaude(apiKey, modelo, system, messages) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: modelo, max_tokens: 1024, system, tools: TOOLS, messages })
  });
  if (!r.ok) {
    const detalle = await r.text().catch(() => '');
    const err = new Error('Claude respondio ' + r.status); err.detalle = detalle; err.status = r.status;
    throw err;
  }
  return r.json();
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    inicializar();

    const authHeader = String(req.headers['authorization'] || '');
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Falta Authorization Bearer token' });
    const decoded = await admin.auth().verifyIdToken(idToken);

    const db = admin.firestore();
    const perfilSnap = await db.collection('usuarios').doc(decoded.uid).get();
    const perfil = perfilSnap.data() || {};

    const body = req.body || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length === 0) return res.status(400).json({ error: 'Faltan mensajes.' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Falta ANTHROPIC_API_KEY en las variables de entorno.' });
    const modelo = process.env.ASISTENTE_MODELO || 'claude-opus-4-8';

    // Cargar usuarios UNA vez (se reutiliza en resolverPersona, sucursales, etc.)
    const usuariosSnap = await db.collection('usuarios').get();
    const usuarios = usuariosSnap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));

    const ctx = {
      uid: decoded.uid, perfil, usuarios,
      nombre: perfil.nombre || perfil.correo || 'Usuario',
      esAdmin: perfil.rol === 'admin',
      fechaHoy: String(body.fechaHoy || '').trim(),
      diaSemana: String(body.diaSemana || '').trim()
    };
    const sucs = sucursalesPermitidas(ctx);

    const system = [
      'Eres el asistente de Mega Dulces Task, una app de tareas para una dulceria.',
      `Hablas con ${ctx.nombre}${ctx.esAdmin ? ' (administrador)' : ''}.`,
      `Hoy es ${ctx.fechaHoy || '(desconocido)'}${ctx.diaSemana ? ' (' + ctx.diaSemana + ')' : ''}.`,
      '',
      'Puedes gestionar TAREAS, crear RUTINAS recurrentes y dar INFORMACION, usando las herramientas.',
      'Contexto para rutinas:',
      '- Sucursales disponibles: ' + (sucs.length ? sucs.join(', ') : '(ninguna)') + '.',
      '- Roles validos: ' + ROLES.join(', ') + '.',
      '- Frecuencias: ' + FRECUENCIAS.join(', ') + '. Dias: ' + DIAS.join(', ') + '.',
      '',
      'Reglas:',
      '- El usuario es administrador con ACCESO TOTAL: puedes consultar tareas de cualquier persona (consultar_tareas con "persona") y estadisticas de cualquier sucursal o de toda la operacion (estadisticas con "sucursal"). No digas que algo es solo personal o que no puedes por sucursal: usa los parametros.',
      '- CONFIRMA ANTES DE ESCRIBIR: antes de crear o asignar (agregar_tarea individual o en grupo, y crear_rutina) RESUME en una frase que haras y a quien, y pide confirmacion. Ej: "Voy a crear: [tarea] para [persona] el [fecha] a las [hora]. ¿Confirmo?". Llama la herramienta SOLO despues de que el usuario diga si/confirme. Si menciona a una persona y no estas 100% seguro de quien es, di a quien entendiste y pide que confirme. Para consultas, resumenes y estadisticas (solo lectura) NO pidas confirmacion: hazlo directo.',
      '- Usa las herramientas para EJECUTAR de verdad; no digas que hiciste algo sin llamarlas.',
      '- Para asignar a VARIAS personas a la vez usa agregar_tarea con para_sucursal, para_rol o para_todos (true). Confirma a cuantas personas quedo asignada.',
      '- Para completar/editar/eliminar una tarea, primero usa consultar_tareas para obtener el id.',
      '- Para crear_rutina necesitas: nombre, frecuencia, sucursales y modo (porRol con rol_objetivo, o porPersonas con personas). Si falta algo, preguntalo corto antes de crear.',
      '- Resuelve fechas relativas a YYYY-MM-DD usando la fecha de hoy.',
      '- Responde SIEMPRE en espanol, breve y claro. Confirma lo hecho en una frase.',
      '- Si una accion falla, dilo con amabilidad y ofrece reintentar.'
    ].join('\n');

    const acciones = [];
    let respuestaTexto = '', data;

    for (let i = 0; i < MAX_ITERACIONES; i++) {
      data = await llamarClaude(apiKey, modelo, system, messages);
      messages.push({ role: 'assistant', content: data.content });

      if (data.stop_reason === 'tool_use') {
        const toolResults = [];
        for (const block of (data.content || [])) {
          if (block.type !== 'tool_use') continue;
          let resultado;
          try { resultado = await ejecutarHerramienta(db, ctx, block.name, block.input); }
          catch (e) { resultado = { ok: false, mensaje: (e && e.message) || 'Error ejecutando la herramienta.' }; }
          if (resultado && resultado.ok) acciones.push({ herramienta: block.name, ...resultado });
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultado), is_error: !(resultado && resultado.ok) });
        }
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      respuestaTexto = (data.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n').trim();
      break;
    }

    if (!respuestaTexto) respuestaTexto = 'Listo.';
    return res.status(200).json({ respuesta: respuestaTexto, acciones, messages });
  } catch (e) {
    console.error('[asistente-chat] error:', e && e.message, e && e.detalle);
    return res.status(500).json({ error: (e && e.message) || 'Error interno' });
  }
};
