import { Component, NgZone, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Firestore, collection, addDoc, getDocs, query } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';

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
  mensajeError = '';

  // Datos de la tarea interpretada (editables antes de guardar)
  tareaTexto = '';
  tareaFecha = '';
  tareaInstrucciones = '';
  respuestaIA = '';

  // Resultados de consultar tareas por voz (Fase 2)
  resultados: any[] = [];
  tituloConsulta = '';

  private reconocedor: any = null;

  ngOnDestroy() {
    this.detenerReconocedor();
  }

  // --- Usuario y fecha actual ---
  private obtenerUserId(): string {
    const sesion = localStorage.getItem('md_sesion_actual');
    const user = sesion ? JSON.parse(sesion) : null;
    return user?.uid || user?.id || user?.idUsuario || user?.correo || '';
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
    const SR = this.obtenerSpeechRecognition();
    if (!SR) {
      this.estado = 'noSoportado';
      return;
    }
    this.reset();
    this.estado = 'idle';
    this.iniciarEscucha();
  }

  cerrar() {
    this.detenerReconocedor();
    this.estado = 'cerrado';
  }

  private reset() {
    this.transcript = '';
    this.mensajeError = '';
    this.tareaTexto = '';
    this.tareaFecha = '';
    this.tareaInstrucciones = '';
    this.respuestaIA = '';
    this.resultados = [];
    this.tituloConsulta = '';
  }

  // --- Reconocimiento de voz ---
  iniciarEscucha() {
    const SR = this.obtenerSpeechRecognition();
    if (!SR) { this.estado = 'noSoportado'; return; }

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
        return;
      }

      const data = await resp.json();
      this.respuestaIA = data.respuesta || '';

      if (data.accion === 'crear') {
        this.tareaTexto = data.texto || this.transcript;
        this.tareaFecha = data.fecha || '';
        this.tareaInstrucciones = data.instrucciones || '';
        this.estado = 'confirmar';
      } else if (data.accion === 'consultar') {
        await this.consultarTareas(data.filtro || 'pendientes', data.fecha || '');
      } else if (data.accion === 'asignar') {
        this.mensajeError = 'Pronto podras asignar tareas a otros por voz. Por ahora solo puedo crear tus tareas.';
        this.estado = 'info';
        this.hablar(this.mensajeError);
      } else {
        this.mensajeError = data.respuesta || 'No te entendi bien. Intenta de nuevo.';
        this.estado = 'error';
        this.hablar(this.mensajeError);
      }
    } catch (_) {
      this.mensajeError = 'No me pude conectar. Revisa tu internet e intenta de nuevo.';
      this.estado = 'error';
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
        fecha: this.tareaFecha || '',
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
    this.estado = 'idle';
    this.iniciarEscucha();
  }

  // --- Voz de respuesta (texto a voz) ---
  private hablar(texto: string) {
    try {
      const synth = (window as any).speechSynthesis;
      if (!synth || !texto) return;
      const u = new (window as any).SpeechSynthesisUtterance(texto);
      u.lang = 'es-MX';
      u.rate = 1;
      synth.cancel();
      synth.speak(u);
    } catch (_) {}
  }
}
