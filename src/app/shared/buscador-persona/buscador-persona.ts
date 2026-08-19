import { Component, ElementRef, EventEmitter, Input, Output, ViewChild, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/**
 * BUSCADOR DE PERSONA — reemplazo del <select> largo de personal.
 *
 * En la empresa hay más de cien personas: una lista desplegable obliga a
 * recorrerla a mano hasta encontrar el nombre. Aquí se escribe y la lista se va
 * acortando, buscando por nombre O por teléfono, ignorando acentos y mayúsculas
 * ("estefania" encuentra a "Estefanía", "GARCIA" a "García").
 *
 * Se usa como un campo normal:
 *   <app-buscador-persona [personas]="personal()" [uid]="form.responsableUid"
 *                         (elegir)="alElegir($event)"></app-buscador-persona>
 *
 * `elegir` emite la persona completa, o `null` cuando se limpia el campo.
 */
@Component({
  selector: 'app-buscador-persona',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="bp-caja" #caja>
      <input class="bp-input" type="text" autocomplete="off"
             [placeholder]="placeholder"
             [ngModel]="texto()"
             (ngModelChange)="alEscribir($event)"
             (focus)="abrir()"
             (blur)="alSalir()">

      @if (abierta) {
        <!-- mousedown y no click: el blur del campo se dispara antes que el click
             y cerraría la lista sin llegar a elegir a nadie. -->
        <div class="bp-opciones">
          @if (permitirVacio) {
            <button type="button" class="bp-opcion vacia" (mousedown)="elegirA(null)">
              {{ etiquetaVacio }}
            </button>
          }
          @for (p of filtradas(); track p.id || p.uid) {
            <button type="button" class="bp-opcion"
                    [class.elegida]="(p.id || p.uid) === uid"
                    (mousedown)="elegirA(p)">
              <span class="bp-nombre">{{ p.nombre }}</span>
              @if (p.telefono) { <span class="bp-tel">{{ p.telefono }}</span> }
            </button>
          }
          @if (!filtradas().length) {
            <div class="bp-sin">Nadie coincide con "{{ texto() }}".</div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .bp-caja { position: relative; }
    .bp-input {
      width: 100%; border: 1px solid #E2E8F0; border-radius: 9px; padding: 10px 12px;
      font-size: 14px; box-sizing: border-box; background: #fff; font-family: inherit;
    }
    .bp-input:focus { outline: none; border-color: #1F3864; box-shadow: 0 0 0 3px rgba(31,56,100,.08); }
    .bp-opciones {
      position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 60;
      max-height: 260px; overflow-y: auto; background: #fff;
      border: 1px solid #E2E8F0; border-radius: 10px;
      box-shadow: 0 12px 28px -8px rgba(15,23,42,.25);
    }
    .bp-opcion {
      display: flex; justify-content: space-between; align-items: baseline; gap: 10px;
      width: 100%; text-align: left; background: none; border: none;
      border-bottom: 1px solid #F1F5F9; padding: 9px 12px; cursor: pointer; font-size: 13.5px;
    }
    .bp-opcion:last-child { border-bottom: none; }
    .bp-opcion:hover { background: #F8FAFC; }
    .bp-opcion.elegida { background: #EFF6FF; }
    .bp-opcion.vacia { color: #64748B; font-style: italic; }
    .bp-nombre { color: #0F172A; font-weight: 600; }
    .bp-tel { color: #94A3B8; font-size: 12px; white-space: nowrap; }
    .bp-sin { padding: 14px 12px; color: #94A3B8; font-size: 13px; text-align: center; }
  `],
})
export class BuscadorPersonaComponent {
  /** Lista de donde elegir (usuarios con al menos `nombre`). */
  @Input() personas: any[] = [];
  /** Uid de quien está elegido ahora (para marcarlo y para mostrar su nombre). */
  @Input() uid = '';
  @Input() placeholder = 'Escribe el nombre...';
  @Input() etiquetaVacio = '— Sin asignar —';
  /** Si se puede dejar el campo sin nadie. */
  @Input() permitirVacio = true;

  @Output() elegir = new EventEmitter<any | null>();

  @ViewChild('caja') caja?: ElementRef<HTMLElement>;
  abierta = false;

  /**
   * Al abrir la lista se asegura de que quede a la vista.
   *
   * Este buscador se usa dentro de modales que tienen su propio scroll, y la
   * lista se dibuja por debajo del campo: sin esto, al abrirla en el último campo
   * del formulario quedaba cortada por el borde del modal y no se veían las
   * opciones.
   */
  private asomar() {
    setTimeout(() => {
      try { this.caja?.nativeElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      catch { /* si el navegador no lo soporta, no pasa nada */ }
    }, 40);
  }
  /** Lo que se ve en el campo: el nombre elegido, o lo que se está escribiendo. */
  private escrito = signal<string | null>(null);

  texto = computed(() => {
    const e = this.escrito();
    if (e !== null) return e;                 // se está escribiendo
    const p = this.personas.find(x => (x.id || x.uid) === this.uid);
    return p ? String(p.nombre || '') : '';   // se muestra a quien ya está elegido
  });

  /** Quita acentos y mayúsculas para que "estefania" encuentre a "Estefanía". */
  private normalizar(t: any): string {
    return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  filtradas = computed<any[]>(() => {
    const q = this.normalizar(this.escrito());
    if (!q) return this.personas;
    // También por teléfono: a veces se acuerdan del número y no del nombre.
    const digitos = q.replace(/\D/g, '');
    return this.personas.filter(p =>
      this.normalizar(p.nombre).includes(q) ||
      (digitos.length >= 3 && String(p.telefono || '').replace(/\D/g, '').includes(digitos)));
  });

  abrir() { this.abierta = true; this.asomar(); }

  alEscribir(v: string) {
    this.escrito.set(v);
    if (!this.abierta) this.asomar();
    this.abierta = true;
  }

  elegirA(p: any | null) {
    this.escrito.set(null);   // vuelve a mostrar el nombre de quien quedó elegido
    this.abierta = false;
    this.elegir.emit(p);
  }

  /**
   * Al salir del campo se cierra la lista y se descarta lo escrito a medias: si
   * no, quedaría en pantalla un nombre que en realidad no se guardó.
   */
  alSalir() {
    this.abierta = false;
    this.escrito.set(null);
  }
}
