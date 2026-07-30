import {
  Component, Input, OnChanges, OnDestroy, AfterViewInit,
  ElementRef, ViewChild, signal
} from '@angular/core';
import { CommonModule } from '@angular/common';

/** Un pin del mapa: sucursal ubicada + su desempeño de hoy. */
export interface PuntoMapa {
  nombre: string;
  direccion: string;
  ciudad: string;
  lat: number;
  lng: number;
  cumplimiento: number;
  hechas: number;
  total: number;
  /** true cuando la sucursal no reporto ninguna tarea hoy (pin gris, no rojo). */
  sinActividad: boolean;
}

/**
 * Mapa real de sucursales (Leaflet + mosaicos de OpenStreetMap).
 *
 * Por que Leaflet y no Google Maps: OSM no pide llave ni tarjeta. Google Maps
 * cobra por carga de mapa y habria que meter otra cuenta de facturacion.
 *
 * Leaflet se baja de CDN al vuelo (mismo patron que Chart.js en el dashboard)
 * para no engordar el bundle de todos los trabajadores por una pantalla que
 * solo abre direccion. Si el CDN o los mosaicos no cargan (sin internet), el
 * componente avisa en vez de dejar un hueco gris.
 */
@Component({
  selector: 'app-mapa-sucursales',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- Sin coordenadas capturadas: no dibujamos un mapa vacio, explicamos que falta -->
    <div *ngIf="puntos.length === 0" class="mapa-vacio">
      <div class="mapa-vacio-titulo">Mapa sin ubicaciones</div>
      <p class="mapa-vacio-texto">
        Ninguna sucursal tiene coordenadas confirmadas todavia. En cuanto se
        registren las direcciones, cada sucursal aparece aqui con su color de
        cumplimiento del dia.
      </p>
      <div *ngIf="pendientes.length" class="mapa-vacio-lista">
        <span class="mapa-vacio-lista-titulo">Pendientes de ubicar ({{ pendientes.length }})</span>
        <div class="mapa-chips">
          <span class="mapa-chip" *ngFor="let p of pendientes">{{ p }}</span>
        </div>
      </div>
    </div>

    <div *ngIf="puntos.length > 0" class="mapa-wrap">
      <div #contenedor class="mapa-lienzo"></div>

      <div *ngIf="error()" class="mapa-error">
        No se pudo cargar el mapa. Revisa la conexion a internet.
      </div>

      <div class="mapa-leyenda">
        <span class="leyenda-item"><i class="punto punto-ok"></i> 80% o mas</span>
        <span class="leyenda-item"><i class="punto punto-warn"></i> 50 a 79%</span>
        <span class="leyenda-item"><i class="punto punto-bad"></i> Menos de 50%</span>
        <span class="leyenda-item"><i class="punto punto-nulo"></i> Sin actividad</span>
      </div>

      <div *ngIf="pendientes.length" class="mapa-nota">
        {{ pendientes.length }} sin ubicar: {{ pendientes.join(', ') }}
      </div>
    </div>
  `,
  styles: [`
    .mapa-wrap { position: relative; }

    .mapa-lienzo {
      height: 300px;
      width: 100%;
      border-radius: 10px;
      border: 1px solid #E2E8F0;
      background: #EEF2F7;
      z-index: 0;
    }

    .mapa-error {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 16px;
      background: rgba(248, 250, 252, 0.94);
      border-radius: 10px;
      color: #92400E;
      font-size: 13px;
      font-weight: 600;
    }

    .mapa-leyenda {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      margin-top: 10px;
      font-size: 11.5px;
      font-weight: 600;
      color: #64748B;
    }

    .leyenda-item { display: inline-flex; align-items: center; gap: 5px; }

    .punto {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
    }

    .punto-ok   { background: #10B981; }
    .punto-warn { background: #F59E0B; }
    .punto-bad  { background: #EF4444; }
    .punto-nulo { background: #94A3B8; }

    .mapa-nota {
      margin-top: 8px;
      font-size: 11.5px;
      color: #94A3B8;
      line-height: 1.4;
    }

    .mapa-vacio {
      border: 1px dashed #CBD5E1;
      border-radius: 10px;
      padding: 20px;
      background: #F8FAFC;
      min-height: 300px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }

    .mapa-vacio-titulo {
      font-size: 14px;
      font-weight: 800;
      color: #334155;
      margin-bottom: 6px;
    }

    .mapa-vacio-texto {
      font-size: 12.5px;
      color: #64748B;
      line-height: 1.5;
      margin-bottom: 14px;
      max-width: 460px;
    }

    .mapa-vacio-lista-titulo {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.4px;
      text-transform: uppercase;
      color: #94A3B8;
    }

    .mapa-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }

    .mapa-chip {
      font-size: 11.5px;
      font-weight: 600;
      color: #475569;
      background: #FFF;
      border: 1px solid #E2E8F0;
      border-radius: 999px;
      padding: 3px 10px;
    }

    @media screen and (max-width: 768px) {
      .mapa-lienzo { height: 240px; }
    }
  `]
})
export class MapaSucursalesComponent implements AfterViewInit, OnChanges, OnDestroy {

  /** Solo sucursales CON coordenadas. Las demas van en `pendientes`. */
  @Input() puntos: PuntoMapa[] = [];
  /** Nombres de sucursales sin coordenadas, para ser transparentes sobre la cobertura. */
  @Input() pendientes: string[] = [];

  @ViewChild('contenedor') contenedor?: ElementRef<HTMLDivElement>;

  error = signal(false);

  private mapa: any = null;
  private capaPines: any = null;
  private listo = false;

  ngAfterViewInit() { this.intentarDibujar(); }

  ngOnChanges() {
    // Si se quedo sin puntos (cambio de permisos), el *ngIf destruye el div y el
    // mapa quedaria apuntando a un nodo huerfano. Lo soltamos para que la
    // proxima vez se construya limpio.
    if (this.puntos.length === 0) {
      if (this.mapa) { this.mapa.remove(); this.mapa = null; this.capaPines = null; }
      this.listo = false;
      return;
    }
    // El contenedor puede no existir todavia (la primera carga llega sin datos).
    if (this.listo) this.pintarPines();
    else this.intentarDibujar();
  }

  ngOnDestroy() {
    if (this.mapa) { this.mapa.remove(); this.mapa = null; }
    this.listo = false;
  }

  private async intentarDibujar() {
    if (this.listo || this.puntos.length === 0) return;
    // El *ngIf recien creo el div: esperamos un tick para tener el elemento.
    await new Promise(r => setTimeout(r, 0));
    if (!this.contenedor) return;

    const L = await this.cargarLeaflet().catch(() => null);
    if (!L) { this.error.set(true); return; }

    this.error.set(false);
    this.mapa = L.map(this.contenedor.nativeElement, {
      zoomControl: true,
      scrollWheelZoom: false,   // que la rueda no secuestre el scroll del tablero
      attributionControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap'
    }).addTo(this.mapa);

    this.capaPines = L.layerGroup().addTo(this.mapa);
    this.listo = true;
    this.pintarPines();
  }

  private pintarPines() {
    const L = (window as any).L;
    if (!L || !this.mapa || !this.capaPines) return;

    this.capaPines.clearLayers();
    const coords: any[] = [];

    for (const p of this.puntos) {
      const color = this.colorDe(p);
      const marcador = L.circleMarker([p.lat, p.lng], {
        radius: 9,
        color: '#FFFFFF',
        weight: 2,
        fillColor: color,
        fillOpacity: 0.95
      });

      const detalle = p.sinActividad
        ? 'Sin tareas reportadas hoy'
        : `${p.cumplimiento}% de cumplimiento &middot; ${p.hechas} de ${p.total} tareas`;

      marcador.bindPopup(
        `<strong>${this.limpiar(p.nombre)}</strong><br>` +
        (p.direccion ? `<span style="color:#64748B">${this.limpiar(p.direccion)}</span><br>` : '') +
        `<span style="color:${color}; font-weight:700">${detalle}</span>`
      );
      marcador.bindTooltip(this.limpiar(p.nombre), { direction: 'top' });

      marcador.addTo(this.capaPines);
      coords.push([p.lat, p.lng]);
    }

    if (coords.length === 1) this.mapa.setView(coords[0], 14);
    else if (coords.length > 1) this.mapa.fitBounds(coords, { padding: [30, 30] });

    // Leaflet mide mal el contenedor si nacio oculto o si el panel cambio de alto.
    setTimeout(() => this.mapa && this.mapa.invalidateSize(), 60);
  }

  private colorDe(p: PuntoMapa): string {
    if (p.sinActividad) return '#94A3B8';
    if (p.cumplimiento >= 80) return '#10B981';
    if (p.cumplimiento >= 50) return '#F59E0B';
    return '#EF4444';
  }

  /** Los nombres van dentro de HTML del popup: no confiamos en que vengan limpios. */
  private limpiar(txt: string): string {
    return (txt || '').replace(/[<>&"]/g, c =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' } as any)[c]
    );
  }

  // ------------------------------------------------------------------
  // Carga de Leaflet (JS + CSS) desde CDN, una sola vez por sesion.
  // ------------------------------------------------------------------
  private static cargando: Promise<any> | null = null;

  private cargarLeaflet(): Promise<any> {
    const yaEsta = (window as any).L;
    if (yaEsta) return Promise.resolve(yaEsta);
    if (MapaSucursalesComponent.cargando) return MapaSucursalesComponent.cargando;

    MapaSucursalesComponent.cargando = new Promise((resolve, reject) => {
      if (!document.getElementById('leaflet-css')) {
        const css = document.createElement('link');
        css.id = 'leaflet-css';
        css.rel = 'stylesheet';
        css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(css);
      }

      const js = document.createElement('script');
      js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      js.async = true;
      js.onload = () => {
        const L = (window as any).L;
        if (L) resolve(L);
        else reject(new Error('Leaflet cargo pero no expuso L'));
      };
      js.onerror = () => {
        // Que un fallo de red no deje el candado puesto para siempre.
        MapaSucursalesComponent.cargando = null;
        reject(new Error('No se pudo bajar Leaflet'));
      };
      document.head.appendChild(js);
    });

    return MapaSucursalesComponent.cargando;
  }
}
