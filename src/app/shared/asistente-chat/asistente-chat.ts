import { Component, ElementRef, NgZone, ViewChild, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Auth } from '@angular/fire/auth';

/**
 * Asistente de Mega Dulces Task: panel de CHAT con tool-use.
 *
 * El frontend solo lleva la conversacion y muestra el chat. Toda la inteligencia
 * y las acciones (crear/consultar/completar/editar/eliminar tareas) ocurren en el
 * servidor (/api/asistente-chat), donde Claude usa herramientas que escriben en
 * Firestore con firebase-admin.
 *
 * - `mensajes`: lo que se ve en pantalla (burbujas).
 * - `historial`: los mensajes en formato de la API (incluye bloques de tool-use),
 *    se manda completo en cada turno para mantener el contexto.
 *
 * Entrada por texto y por voz (dictado con Web Speech API). Las respuestas se
 * leen en voz con una voz en espanol natural.
 */
@Component({
  selector: 'app-asistente-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './asistente-chat.html',
  styleUrls: ['./asistente-chat.css']
})
export class AsistenteChatComponent implements OnDestroy {
  private auth = inject(Auth);
  private zone = inject(NgZone);

  @ViewChild('cuerpo') cuerpo?: ElementRef<HTMLDivElement>;

  abierto = false;
  entrada = '';
  cargando = false;
  escuchando = false;
  hablando = false;   // true mientras el TTS esta leyendo una respuesta

  mensajes: { de: 'user' | 'bot'; texto: string; whatsapps?: { telefono: string; nombre: string; texto: string }[] }[] = [];
  private historial: any[] = [];

  private reconocedor: any = null;

  constructor() {
    // Precargar voces de TTS (Chrome las carga async).
    try {
      const synth = (window as any).speechSynthesis;
      if (synth) {
        synth.getVoices();
        if (synth.addEventListener) synth.addEventListener('voiceschanged', () => synth.getVoices());
      }
    } catch (_) {}
  }

  ngOnDestroy() { this.detenerReconocedor(); }

  get hayVoz(): boolean {
    const w = window as any;
    return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
  }

  abrir() {
    this.abierto = true;
    if (this.mensajes.length === 0) {
      this.mensajes.push({ de: 'bot', texto: 'Hola, soy tu asistente. Puedo crear, consultar, completar o eliminar tus tareas. ¿Qué necesitas?' });
    }
    this.scrollAbajo();
  }

  cerrar() {
    this.detenerReconocedor();
    this.detenerVoz();
    this.escuchando = false;
    this.abierto = false;
  }

  // Abre WhatsApp (web/app) con el mensaje pre-armado para esa persona.
  abrirWhatsapp(w: { telefono: string; texto: string }) {
    const url = 'https://wa.me/' + w.telefono + '?text=' + encodeURIComponent(w.texto || '');
    window.open(url, '_blank');
  }

  // --- Enviar mensaje ---
  async enviar() {
    const texto = (this.entrada || '').trim();
    if (!texto || this.cargando) return;

    this.detenerVoz();   // si estaba leyendo una respuesta anterior, callarla
    this.entrada = '';
    this.mensajes.push({ de: 'user', texto });
    this.historial.push({ role: 'user', content: texto });
    this.cargando = true;
    this.scrollAbajo();

    try {
      const token = await this.auth.currentUser?.getIdToken();
      if (!token) {
        this.cargando = false;
        this.mensajes.push({ de: 'bot', texto: 'Tu sesión expiró. Vuelve a iniciar sesión.' });
        return;
      }

      const hoy = new Date();
      const off = hoy.getTimezoneOffset() * 60000;
      const fechaHoy = new Date(hoy.getTime() - off).toISOString().split('T')[0];
      const diaSemana = hoy.toLocaleDateString('es-MX', { weekday: 'long' });

      const resp = await fetch('/api/asistente-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ messages: this.historial, fechaHoy, diaSemana })
      });

      if (!resp.ok) {
        this.cargando = false;
        // Leemos el detalle real que manda el servidor (no romper si no es JSON).
        let detalle = '';
        try { const err = await resp.json(); detalle = (err && err.error) || ''; } catch (_) { /* sin cuerpo JSON */ }
        console.error('[asistente-chat] respuesta', resp.status, detalle);
        // A los admins les mostramos la causa técnica para poder diagnosticar;
        // al resto, el mensaje genérico.
        let esAdmin = false;
        try { esAdmin = (JSON.parse(localStorage.getItem('md_sesion_actual') || '{}').rol) === 'admin'; } catch (_) { /* noop */ }
        const texto = esAdmin && detalle
          ? `El asistente falló (${resp.status}): ${detalle}`
          : 'El asistente no está disponible en este momento. Intenta más tarde.';
        this.mensajes.push({ de: 'bot', texto });
        this.scrollAbajo();
        return;
      }

      const data = await resp.json();
      // Reemplazar el historial por el que devuelve el servidor (incluye los
      // turnos de herramientas para mantener el contexto en el siguiente mensaje).
      if (Array.isArray(data.messages)) this.historial = data.messages;
      const respuesta = (data.respuesta || 'Listo.').trim();
      // Botones de WhatsApp si alguna accion (crear_checklist) trae datos.
      const wa = (data.acciones || []).map((a: any) => a.whatsapp).filter((x: any) => x && x.telefono);
      this.cargando = false;
      this.mensajes.push({ de: 'bot', texto: respuesta, whatsapps: wa.length ? wa : undefined });
      this.scrollAbajo();
      this.hablar(respuesta);
    } catch (_) {
      this.cargando = false;
      this.mensajes.push({ de: 'bot', texto: 'No me pude conectar. Revisa tu internet e intenta de nuevo.' });
      this.scrollAbajo();
    }
  }

  // --- Dictado por voz: llena el campo y envia ---
  dictar() {
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    this.detenerVoz();   // si el asistente esta hablando, callarlo YA antes de escuchar
    if (this.escuchando) { this.detenerReconocedor(); this.escuchando = false; return; }

    this.detenerReconocedor();
    const rec = new SR();
    rec.lang = 'es-MX';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    let texto = '';
    rec.onresult = (event: any) => {
      let t = '';
      for (let i = 0; i < event.results.length; i++) t += event.results[i][0].transcript;
      texto = t.trim();
      this.zone.run(() => { this.entrada = texto; });
    };
    rec.onerror = () => { this.zone.run(() => { this.escuchando = false; }); };
    rec.onend = () => {
      this.zone.run(() => {
        this.escuchando = false;
        if (texto) this.enviar();
      });
    };

    this.reconocedor = rec;
    this.escuchando = true;
    try { rec.start(); } catch (_) {}
  }

  private detenerReconocedor() {
    if (this.reconocedor) {
      try { this.reconocedor.onend = null; this.reconocedor.abort(); } catch (_) {}
      this.reconocedor = null;
    }
  }

  // --- Voz de respuesta ---
  private elegirVoz(): any {
    try {
      const synth = (window as any).speechSynthesis;
      if (!synth) return null;
      const voces = synth.getVoices() || [];
      const es = voces.filter((v: any) => /^es/i.test(v.lang || ''));
      return (
        es.find((v: any) => /google/i.test(v.name || '')) ||
        es.find((v: any) => /natural|premium|enhanced/i.test(v.name || '')) ||
        es.find((v: any) => /es[-_]mx/i.test(v.lang || '')) ||
        es[0] || null
      );
    } catch { return null; }
  }

  // Limpia el texto SOLO para la voz (la pantalla conserva su formato):
  // quita emojis/pictogramas y simbolos de markdown que no se deben leer.
  private limpiarTextoParaVoz(texto: string): string {
    if (!texto) return '';
    let t = texto;
    // Emojis, pictogramas, banderas y selectores de variacion / ZWJ.
    t = t.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '');        // banderas (indicadores regionales)
    t = t.replace(/\p{Extended_Pictographic}/gu, '');    // caritas, simbolos, pictogramas
    t = t.replace(/[\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu, '');
    // Markdown: vinetas de lista al inicio de linea ("- ", "* ", "• ").
    t = t.replace(/^\s*[-*•]\s+/gm, '');
    // Encabezados (#) y citas (>) al inicio de linea.
    t = t.replace(/^\s{0,3}#{1,6}\s*/gm, '');
    t = t.replace(/^\s{0,3}>\s?/gm, '');
    // Enfasis y codigo: ** * _ ~ ` (se queda el texto, se van los simbolos).
    t = t.replace(/[*_~`]+/g, '');
    // Colapsar espacios dobles y limpiar por linea.
    t = t.replace(/[ \t]{2,}/g, ' ');
    t = t.split('\n').map(l => l.trim()).filter((l, i, arr) => l || (i > 0 && arr[i - 1])).join('. ');
    return t.replace(/\.\s*\./g, '.').trim();
  }

  // Corta la voz al instante (aunque este a media frase).
  private detenerVoz() {
    try { (window as any).speechSynthesis?.cancel(); } catch (_) {}
    this.hablando = false;
  }

  private hablar(texto: string) {
    try {
      const synth = (window as any).speechSynthesis;
      if (!synth) return;
      const limpio = this.limpiarTextoParaVoz(texto);
      if (!limpio) return;
      const u = new (window as any).SpeechSynthesisUtterance(limpio);
      const voz = this.elegirVoz();
      if (voz) u.voice = voz;
      u.lang = (voz && voz.lang) || 'es-MX';
      u.rate = 0.98;
      u.pitch = 1.05;
      u.onstart = () => this.zone.run(() => { this.hablando = true; });
      u.onend = () => this.zone.run(() => { this.hablando = false; });
      u.onerror = () => this.zone.run(() => { this.hablando = false; });
      synth.cancel();
      synth.speak(u);
    } catch (_) {}
  }

  private scrollAbajo() {
    setTimeout(() => {
      try {
        const el = this.cuerpo?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      } catch (_) {}
    }, 50);
  }
}
