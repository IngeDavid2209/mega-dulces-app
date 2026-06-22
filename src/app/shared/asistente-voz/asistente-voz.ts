import { Component, NgZone, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Firestore, collection, addDoc, getDocs, query } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';

import { esAdminGlobal, sucursalesPermitidas } from '../permisos.util';

/**
 * Asistente de voz - FASE 1: Crear tareas hablando.
 *
 * Flujo:
 *   1. El trabajador toca el microfono y dicta (voz -> texto con Web Speech API).
 *   2. El texto se manda a /api/asistente-voz, donde la IA (Claude) entiende la
 *      intencion en lenguaje natural y devuelve una tarea estructurada.
 *   3. Se muestra una confirmacion editable; al aceptar se guarda en la agenda
 *      personal del usuario (usuarios/{uid}/agenda) y el asistente responde por voz.
 *
 * Notas:
 *   - El reconocimiento de voz es gratuito y funciona muy bien en Chrome/Android.
 *     En iPhone (Safari) puede ser inestable; se muestra un aviso si no hay soporte.
 *   - Los callbacks del navegador corren fuera de la zona de Angular, por eso se
 *     envuelven en ngZone.run(...) para que la pantalla se actualice.
 */
@Component({
  selector: 'app-asistente-voz',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './asistente-voz.html',
  styleUrls: ['./asistente-voz.css']
})
export class AsistenteVozComponent implements OnDestroy {
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private zone = inject(NgZone);

  /** cerrado | idle | escuchando | procesando | confirmar | guardando | listo | info | error | noSoportado */
  estado: string = 'cerrado';

  transcript = '';
  entradaManual = '';   // texto escrito/dictado con el teclado (iPhone y fallback)
  mensajeError = '';

  // Datos de la tarea interpretada (editables antes de guardar)
  tareaTexto = '';
  tareaFechaInicio = '';   // YYYY-MM-DD
  tareaHoraInicio = '';    // HH:mm
  tareaFechaFin = '';      // YYYY-MM-DD
  tareaHoraFin = '';       // HH:mm
  tareaInstrucciones = '';
  respuestaIA = '';

  // Resultados de consultar tareas por voz (Fase 2)
  resultados: any[] = [];
  tituloConsulta = '';

  // Asignar tareas a otros por voz (Fase 3)
  asignables: any[] = [];          // personas a las que el jefe puede asignar
  asignadoSeleccionadoId = '';     // id del trabajador elegido
  nombreDictado = '';              // nombre que se entendio por voz

  private reconocedor: any = null;

  constructor() {
    // Precargar las voces de TTS (Chrome las carga de forma asincrona; si no se
    // piden antes, la primera vez sale la voz robotica por defecto).
    try {
      const synth = (window as any).speechSynthesis;
      if (synth) {
        synth.getVoices();
        if (synth.addEventListener) {
          synth.addEventListener('voiceschanged', () => synth.getVoices());
        }
      }
    } catch (_) {}
  }

  ngOnDestroy() {
    this.detenerReconocedor();
  }

  // --- Usuario y fecha actual ---
  private obtenerUsuario(): any {
    const sesion = localStorage.getItem('md_sesion_actual');
    return sesion ? JSON.parse(sesion) : null;
  }

  private obtenerUserId(): string {
    const user = this.obtenerUsuario();
    return user?.uid || user?.id || user?.idUsuario || user?.correo || '';
  }

  private normaliza(s: string): string {
    return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  }

  /** Campos de fecha/hora de inicio y fin que se guardan en la tarea.
   *  `fecha` se mantiene = fechaInicio para que la agenda siga ordenando/mostrando. */
  private camposFechaHora() {
    return {
      fecha: this.tareaFechaInicio || '',
      fechaInicio: this.tareaFechaInicio || '',
      horaInicio: this.tareaHoraInicio || '',
      fechaFin: this.tareaFechaFin || '',
      horaFin: this.tareaHoraFin || ''
    };
  }

  private hoyISO(): string {
    const d = new Date();
    const off = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - off).toISOString().split('T')[0];
  }

  formatearFecha(iso: string | undefined): string {
    if (!iso) return '';
    try {
      return new Date(iso + 'T00:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short' });
    } catch { return iso; }
  }

  esHoy(iso: string | undefined): boolean { return !!iso && iso === this.hoyISO(); }
  estaVencida(t: any): boolean { return !!t?.fecha && !t?.completada && t.fecha < this.hoyISO(); }

  // --- Soporte del navegador ---
  private obtenerSpeechRecognition(): any {
    const w = window as any;
    return w.SpeechRecognition || w.webkitSpeechRecognition || null;
  }

  // --- Abrir / cerrar el panel ---
  abrir() {
    this.reset();
    const SR = this.obtenerSpeechRecognition();
    if (SR) {
      // Android/Chrome: el asistente saluda por voz y LUEGO empieza a escuchar
      // (asi el microfono no capta su propio saludo).
      this.estado = 'idle';
      this.hablar('Hola, dime qué necesitas.', () => {
        if (this.estado === 'idle') this.iniciarEscucha();
      });
    } else {
      // iPhone/Safari u otros sin soporte: modo escribir/dictar con el teclado.
      this.estado = 'manual';
    }
  }

  // Cambiar a modo manual (escribir o dictar con el teclado) desde cualquier punto.
  irAManual() {
    this.detenerReconocedor();
    if (this.transcript) this.entradaManual = this.transcript;
    this.estado = 'manual';
  }

  enviarManual() {
    const t = (this.entradaManual || '').trim();
    if (!t) return;
    this.transcript = t;
    this.procesar();
  }

  cerrar() {
    this.detenerReconocedor();
    this.estado = 'cerrado';
  }

  private reset() {
    this.transcript = '';
    this.entradaManual = '';
    this.mensajeError = '';
    this.tareaTexto = '';
    this.tareaFechaInicio = '';
    this.tareaHoraInicio = '';
    this.tareaFechaFin = '';
    this.tareaHoraFin = '';
    this.tareaInstrucciones = '';
    this.respuestaIA = '';
    this.resultados = [];
    this.tituloConsulta = '';
    this.asignables = [];
    this.asignadoSeleccionadoId = '';
    this.nombreDictado = '';
  }

  // --- Reconocimiento de voz ---
  iniciarEscucha() {
    const SR = this.obtenerSpeechRecognition();
    if (!SR) { this.estado = 'manual'; return; }

    this.detenerReconocedor();
    this.transcript = '';
    this.mensajeError = '';

    const rec = new SR();
    rec.lang = 'es-MX';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    rec.onresult = (event: any) => {
      let texto = '';
      for (let i = 0; i < event.results.length; i++) {
        texto += event.results[i][0].transcript;
      }
      this.zone.run(() => { this.transcript = texto.trim(); });
    };

    rec.onerror = (event: any) => {
      this.zone.run(() => {
        if (event.error === 'no-speech') {
          this.mensajeError = 'No escuche nada. Toca el microfono e intenta de nuevo.';
        } else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          this.mensajeError = 'Necesito permiso para usar el microfono. Actívalo en el navegador.';
        } else {
          this.mensajeError = 'Hubo un problema al escuchar. Intenta de nuevo.';
        }
        this.estado = 'error';
      });
    };

    rec.onend = () => {
      this.zone.run(() => {
        if (this.estado === 'escuchando') {
          if (this.transcript) {
            this.procesar();
          } else {
            this.estado = 'idle';
          }
        }
      });
    };

    this.reconocedor = rec;
    this.estado = 'escuchando';
    try {
      rec.start();
    } catch (_) {
      // start() puede lanzar si ya estaba corriendo; lo ignoramos.
    }
  }

  detenerDictado() {
    // El usuario toca "Listo" para terminar de hablar antes de tiempo.
    if (this.reconocedor) {
      try { this.reconocedor.stop(); } catch (_) {}
    }
  }

  private detenerReconocedor() {
    if (this.reconocedor) {
      try { this.reconocedor.onend = null; this.reconocedor.abort(); } catch (_) {}
      this.reconocedor = null;
    }
  }

  // --- Enviar a la IA ---
  async procesar() {
    if (!this.transcript) { this.estado = 'idle'; return; }
    this.estado = 'procesando';

    try {
      const token = await this.auth.currentUser?.getIdToken();
      if (!token) {
        this.mensajeError = 'Tu sesion expiro. Vuelve a iniciar sesion.';
        this.estado = 'error';
        return;
      }

      const hoy = new Date();
      const off = hoy.getTimezoneOffset() * 60000;
      const fechaHoy = new Date(hoy.getTime() - off).toISOString().split('T')[0];
      const diaSemana = hoy.toLocaleDateString('es-MX', { weekday: 'long' });

      const resp = await fetch('/api/asistente-voz', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ transcript: this.transcript, fechaHoy, diaSemana })
      });

      if (!resp.ok) {
        this.mensajeError = 'El asistente no esta disponible en este momento. Intenta mas tarde.';
        this.estado = 'error';
        this.hablar('Ahorita no estoy disponible. Intenta más tarde.');
        return;
      }

      const data = await resp.json();
      this.respuestaIA = data.respuesta || '';

      if (data.accion === 'crear') {
        this.tareaTexto = data.texto || this.transcript;
        this.tareaFechaInicio = data.fecha || '';
        this.tareaInstrucciones = data.instrucciones || '';
        this.estado = 'confirmar';
        this.hablar(`Entendí: ${this.tareaTexto}. Revisa la fecha y la hora de inicio y fin, y confirma.`);
      } else if (data.accion === 'consultar') {
        await this.consultarTareas(data.filtro || 'pendientes', data.fecha || '');
      } else if (data.accion === 'asignar') {
        await this.prepararAsignacion(data);
      } else {
        this.mensajeError = data.respuesta || 'No te entendi bien. Intenta de nuevo.';
        this.estado = 'error';
        this.hablar(this.mensajeError);
      }
    } catch (_) {
      this.mensajeError = 'No me pude conectar. Revisa tu internet e intenta de nuevo.';
      this.estado = 'error';
      this.hablar('No me pude conectar. Revisa tu internet e intenta de nuevo.');
    }
  }

  // --- Guardar la tarea ---
  async confirmarCrear() {
    const texto = (this.tareaTexto || '').trim();
    if (!texto) { return; }

    const userId = this.obtenerUserId();
    if (!userId) {
      this.mensajeError = 'No encontre tu usuario. Vuelve a iniciar sesion.';
      this.estado = 'error';
      return;
    }

    this.estado = 'guardando';
    try {
      await addDoc(collection(this.firestore, `usuarios/${userId}/agenda`), {
        texto,
        completada: false,
        fechaCreacion: Date.now(),
        ...this.camposFechaHora(),
        instrucciones: this.tareaInstrucciones || '',
        comentarios: '',
        adjunto: null,
        creadaPorVoz: true
      });

      this.estado = 'listo';
      const frase = this.respuestaIA || 'Listo, ya agende tu tarea.';
      this.hablar(frase);
      setTimeout(() => { this.zone.run(() => this.cerrar()); }, 2200);
    } catch (_) {
      this.mensajeError = 'No pude guardar la tarea. Intenta de nuevo.';
      this.estado = 'error';
    }
  }

  // --- Asignar tareas a otros por voz (Fase 3) ---
  async prepararAsignacion(data: any) {
    const usuario = this.obtenerUsuario();

    // Solo admin/jefe puede asignar a otros.
    if (!usuario || usuario.rol !== 'admin') {
      this.mensajeError = 'Solo los jefes pueden asignar tareas a otros. Tu puedes crear tus propias tareas.';
      this.estado = 'info';
      this.hablar('Solo los jefes pueden asignar tareas a otros.');
      return;
    }

    if (!data.texto) {
      this.mensajeError = 'No entendi que tarea asignar. Intenta de nuevo.';
      this.estado = 'error';
      return;
    }

    try {
      // Cargar la gente a la que este jefe puede asignar (misma logica que la agenda).
      const usersRef = collection(this.firestore, 'usuarios');
      const snap = await getDocs(query(usersRef));
      let lista = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

      if (!esAdminGlobal(usuario)) {
        const permitidas = sucursalesPermitidas(usuario);
        if (permitidas !== null) {
          lista = lista.filter((u: any) => {
            if (u.rol === 'admin') return false;
            const susSuc: string[] = u.sucursales || (u.sucursal ? [u.sucursal] : []);
            return susSuc.some((s: string) => permitidas.includes(s));
          });
        }
      }
      // No asignarse a si mismo por esta via.
      const miId = this.obtenerUserId();
      lista = lista.filter((u: any) => u.id !== miId);
      // Orden alfabetico por nombre.
      lista.sort((a: any, b: any) => (a.nombre || a.correo || '').localeCompare(b.nombre || b.correo || ''));

      this.asignables = lista;
      this.nombreDictado = data.asignadoA || '';
      this.tareaTexto = data.texto || '';
      this.tareaFechaInicio = data.fecha || '';
      this.tareaInstrucciones = data.instrucciones || '';

      // Intentar emparejar el nombre dictado con un trabajador.
      const objetivo = this.normaliza(this.nombreDictado);
      let preseleccion = '';
      if (objetivo) {
        const candidatos = lista.filter((u: any) => {
          const n = this.normaliza(u.nombre || u.correo || '');
          return n.includes(objetivo) || objetivo.includes(n) ||
                 n.split(' ')[0] === objetivo.split(' ')[0];
        });
        if (candidatos.length === 1) preseleccion = candidatos[0].id;
      }
      this.asignadoSeleccionadoId = preseleccion;

      this.estado = 'asignar';
      this.hablar(`Vas a asignar: ${this.tareaTexto}. Elige a la persona y confirma.`);
    } catch (_) {
      this.mensajeError = 'No pude cargar la lista de personal. Intenta de nuevo.';
      this.estado = 'error';
    }
  }

  async confirmarAsignar() {
    const texto = (this.tareaTexto || '').trim();
    if (!texto) return;
    if (!this.asignadoSeleccionadoId) {
      this.mensajeError = 'Elige a quien asignarle la tarea.';
      return;
    }

    const usuario = this.obtenerUsuario();
    const destino = this.asignables.find(u => u.id === this.asignadoSeleccionadoId);
    if (!destino) {
      this.mensajeError = 'No encontre a esa persona.';
      return;
    }

    this.estado = 'guardando';
    try {
      await addDoc(collection(this.firestore, `usuarios/${destino.id}/agenda`), {
        texto,
        completada: false,
        fechaCreacion: Date.now(),
        ...this.camposFechaHora(),
        instrucciones: this.tareaInstrucciones || '',
        comentarios: '',
        adjunto: null,
        creadaPorVoz: true,
        asignadaPor: usuario?.nombre || usuario?.correo || 'Un jefe'
      });

      const nombre = destino.nombre || destino.correo || 'la persona';
      this.respuestaIA = `Listo, le asigne a ${nombre}: ${texto}.`;
      this.estado = 'listo';
      this.hablar(this.respuestaIA);
      setTimeout(() => { this.zone.run(() => this.cerrar()); }, 2400);
    } catch (_) {
      this.mensajeError = 'No pude asignar la tarea. Intenta de nuevo.';
      this.estado = 'error';
    }
  }

  // --- Consultar tareas por voz (Fase 2) ---
  async consultarTareas(filtro: string, fecha: string) {
    const userId = this.obtenerUserId();
    if (!userId) {
      this.mensajeError = 'No encontre tu usuario. Vuelve a iniciar sesion.';
      this.estado = 'error';
      return;
    }

    try {
      const agendaRef = collection(this.firestore, `usuarios/${userId}/agenda`);
      const snap = await getDocs(query(agendaRef));
      const todas = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      const hoy = this.hoyISO();

      let lista: any[] = [];
      let titulo = '';

      switch (filtro) {
        case 'hoy':
          lista = todas.filter(t => !t.completada && t.fecha === hoy);
          titulo = 'Pendientes de hoy';
          break;
        case 'vencidas':
          lista = todas.filter(t => !t.completada && t.fecha && t.fecha < hoy);
          titulo = 'Tareas vencidas';
          break;
        case 'fecha':
          lista = todas.filter(t => !t.completada && t.fecha === fecha);
          titulo = 'Tareas del ' + (this.formatearFecha(fecha) || fecha);
          break;
        case 'todas':
          lista = todas.filter(t => !t.completada);
          titulo = 'Todas tus tareas';
          break;
        default: // pendientes
          lista = todas.filter(t => !t.completada);
          titulo = 'Tus pendientes';
          break;
      }

      // Orden: con fecha primero (cronologico), luego sin fecha
      lista.sort((a, b) => {
        if (a.fecha && b.fecha) return a.fecha.localeCompare(b.fecha);
        if (a.fecha && !b.fecha) return -1;
        if (!a.fecha && b.fecha) return 1;
        return (b.fechaCreacion || 0) - (a.fechaCreacion || 0);
      });

      this.resultados = lista;
      this.tituloConsulta = titulo;
      this.estado = 'resultados';
      this.hablar(this.construirResumen(lista, filtro));
    } catch (_) {
      this.mensajeError = 'No pude leer tus tareas. Intenta de nuevo.';
      this.estado = 'error';
    }
  }

  private construirResumen(lista: any[], filtro: string): string {
    const cuando = filtro === 'hoy' ? ' para hoy'
      : filtro === 'vencidas' ? ' vencidas'
      : '';
    if (lista.length === 0) {
      return 'No tienes pendientes' + cuando + '.';
    }
    const n = lista.length;
    const encabezado = n === 1 ? 'Tienes 1 pendiente' + cuando : `Tienes ${n} pendientes${cuando}`;
    // Leer en voz hasta 5 para no hacerlo eterno
    const nombres = lista.slice(0, 5).map(t => t.texto).filter(Boolean);
    if (nombres.length === 0) return encabezado + '.';
    let detalle = nombres.join(', ');
    if (n > 5) detalle += ', y mas';
    return encabezado + ': ' + detalle + '.';
  }

  reintentar() {
    this.reset();
    const SR = this.obtenerSpeechRecognition();
    if (SR) {
      this.estado = 'idle';
      this.iniciarEscucha();
    } else {
      this.estado = 'manual';
    }
  }

  // Elige la voz en espanol mas natural disponible (las "Google" suenan mucho
  // mejor que la voz robotica por defecto). Devuelve null si no hay ninguna.
  private elegirVoz(): any {
    try {
      const synth = (window as any).speechSynthesis;
      if (!synth) return null;
      const voces = synth.getVoices() || [];
      if (!voces.length) return null;
      const es = voces.filter((v: any) => /^es/i.test(v.lang || ''));
      return (
        es.find((v: any) => /google/i.test(v.name || '')) ||              // Google es (la mejor en Chrome/Android)
        es.find((v: any) => /natural|premium|enhanced/i.test(v.name || '')) ||
        es.find((v: any) => /es[-_]mx/i.test(v.lang || '')) ||            // espanol de Mexico
        es[0] ||
        null
      );
    } catch {
      return null;
    }
  }

  // --- Voz de respuesta (texto a voz) ---
  // Si se pasa "alTerminar", se ejecuta cuando termina de hablar (para encadenar
  // "habla y luego escucha" sin que el microfono capte la propia voz).
  private hablar(texto: string, alTerminar?: () => void) {
    try {
      const synth = (window as any).speechSynthesis;
      if (!synth || !texto) { if (alTerminar) alTerminar(); return; }
      const u = new (window as any).SpeechSynthesisUtterance(texto);
      const voz = this.elegirVoz();
      if (voz) u.voice = voz;
      u.lang = (voz && voz.lang) || 'es-MX';
      u.rate = 0.98;
      u.pitch = 1.05;
      let listo = false;
      const fin = () => {
        if (listo) return;
        listo = true;
        if (alTerminar) this.zone.run(() => alTerminar());
      };
      u.onend = fin;
      u.onerror = fin;
      synth.cancel();
      synth.speak(u);
      // Respaldo: algunos navegadores no disparan onend de forma confiable.
      if (alTerminar) setTimeout(fin, 5000);
    } catch (_) {
      if (alTerminar) alTerminar();
    }
  }
}
