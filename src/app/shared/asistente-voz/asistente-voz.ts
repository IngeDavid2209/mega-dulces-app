import { Component, NgZone, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Firestore, collection, addDoc } from '@angular/fire/firestore';
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

  private reconocedor: any = null;

  ngOnDestroy() {
    this.detenerReconocedor();
  }

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
        this.mensajeError = 'Pronto podras consultar tus tareas por voz. Por ahora solo puedo crear tareas.';
        this.estado = 'info';
        this.hablar(this.mensajeError);
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

    const sesion = localStorage.getItem('md_sesion_actual');
    const user = sesion ? JSON.parse(sesion) : null;
    const userId = user?.uid || user?.id || user?.idUsuario || user?.correo || '';
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
