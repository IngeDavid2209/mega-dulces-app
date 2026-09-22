import { Component, Input, Output, EventEmitter, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { APP_BUILD_SELLO } from '../version';
import { esAdminDeCanindo } from '../permisos.util';
import { cerrarSesionSegura } from '../sesion.util';
import { SwUpdate } from '@angular/service-worker';
import { decidirRefresco } from '../refresco.util';
import { menuDe, totalVisible } from './nav.config';

/**
 * Sidebar compartido del panel administrativo.
 * Reemplaza los 11 sidebars duplicados que había en cada pantalla.
 *
 * Uso:
 *   <app-sidebar
 *     [currentUser]="currentUser"
 *     [isMenuOpen]="isMenuOpen"
 *     (closeMenu)="isMenuOpen = false">
 *   </app-sidebar>
 */
@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './sidebar.html',
  styleUrls: ['./sidebar.css']
})
export class SidebarComponent implements OnInit, OnDestroy {
  @Input() currentUser: any = null;
  @Input() isMenuOpen = false;
  /** Se emite cuando el usuario hace click en un nav-item o cierra el menú móvil. */
  @Output() closeMenu = new EventEmitter<void>();

  /** Sello de versión del build (fecha + hora). Se muestra al pie del sidebar. */
  readonly buildSello = APP_BUILD_SELLO;

  private router = inject(Router);
  private swUpdate = inject(SwUpdate);

  // ══════════════════════════════════════════════════════════════════════════
  //  BUSCAR ACTUALIZACIÓN A MANO — 22/sep/2026
  //
  //  Instrucción de David: «crea un botón de refresh para que estén refrescando
  //  la página aunque la tengan descargada», y «que se vea en un apartado en
  //  donde no estorbe».
  //
  //  POR QUÉ HACE FALTA SI YA SE BUSCA SOLA. `app.ts` consulta cada 2 minutos,
  //  al volver del segundo plano, al enfocar y al recuperar señal, y cuando
  //  encuentra algo saca la barra de «Actualizar / Ahora no». Todo eso es
  //  automático: lo que no existía era que la PERSONA pudiera pedirlo. Con la
  //  app instalada y nunca cerrada, quien sospecha que tiene una versión vieja
  //  no tenía ningún gesto que hacer — y en una PWA no hay barra del navegador
  //  donde pulsar recargar.
  //
  //  VA EN EL PIE DEL MENÚ, junto al sello de versión, por las dos mitades de
  //  lo que pidió: es el sitio donde alguien va a buscar «qué versión tengo», y
  //  el menú HAY QUE ABRIRLO A PROPÓSITO, así que nadie lo pulsa por accidente
  //  a media captura.
  // ══════════════════════════════════════════════════════════════════════════

  /** Qué está haciendo el botón. Lo lee la plantilla; no se guarda en ningún lado. */
  estadoRefresco: 'listo' | 'buscando' | 'aplicando' | 'aldia' | 'sinred' | 'error' = 'listo';
  /** Lo que se le dice a la persona debajo del botón. Vacío = no se pinta nada. */
  mensajeRefresco = '';
  private relojMensaje: any = null;

  /**
   * ⚠ NO RECARGA SI YA ESTÁ AL DÍA, Y ESA ES LA DECISIÓN DEL BOTÓN.
   *
   * Una recarga se lleva lo que la persona tenga a medias —un motivo de retraso
   * a medio escribir, una foto elegida y sin subir, el desplazamiento en una
   * lista larga—. Es el mismo argumento por el que el 13/sep se dejó de aplicar
   * la actualización sola. Si no hay versión nueva que traer, ese costo no
   * compra nada: se dice qué versión tiene y no se toca la pantalla.
   *
   * Así el botón solo interrumpe cuando de verdad hay algo que actualizar.
   */
  async buscarActualizacion() {
    if (this.estadoRefresco === 'buscando' || this.estadoRefresco === 'aplicando') return;
    this.ponerMensaje('buscando', 'Buscando actualización…', 0);

    // La decisión vive en `refresco.util.ts` y no aquí: lo que decide es SI SE
    // RECARGA, y eso se lleva lo que la persona tenga a medias. Ahí se puede
    // probar con las seis ramas; dentro de este componente sólo se podría con
    // un service worker de verdad, y en headless `isEnabled` es false, así que
    // un arnés recorrería siempre la misma y daría verde sin ejercer ninguna.
    const plan = await decidirRefresco({
      enLinea: navigator.onLine,
      swActivo: this.swUpdate.isEnabled,
      version: this.buildSello,
      buscar: () => this.swUpdate.checkForUpdate(),
      activar: () => this.swUpdate.activateUpdate().then(() => undefined),
    });

    this.ponerMensaje(plan.estado, plan.mensaje, plan.recargar ? 0 : 6000);
    // El respiro es para que alcance a leerse «Actualizando…» antes de que la
    // pantalla se vaya; sin él, la recarga se come su propio aviso.
    if (plan.recargar) setTimeout(() => document.location.reload(), 300);
  }

  /** `ms` = 0 deja el mensaje fijo (lo que sigue lo sustituye). */
  private ponerMensaje(estado: typeof this.estadoRefresco, texto: string, ms = 6000) {
    this.estadoRefresco = estado;
    this.mensajeRefresco = texto;
    if (this.relojMensaje) { clearTimeout(this.relojMensaje); this.relojMensaje = null; }
    if (ms > 0) {
      this.relojMensaje = setTimeout(() => {
        this.estadoRefresco = 'listo';
        this.mensajeRefresco = '';
      }, ms);
    }
  }

  /**
   * El menú de quien entró, agrupado por sección. Se calcula, no se escribe.
   *
   * Es un método y no un `computed` porque `currentUser` llega por `@Input()`,
   * no por signal: envolverlo en un signal aquí obligaría a tocar las once
   * pantallas que le pasan el usuario, y eso es otro paso. Angular lo llama en
   * cada ciclo de detección, pero son 21 entradas con predicados de una línea —
   * el costo es despreciable y medible si algún día deja de serlo.
   */
  private _cacheUser: any = null;
  private _cacheMenu: any[] = [];

  /**
   * ⚠️ DEVUELVE LA MISMA REFERENCIA MIENTRAS EL USUARIO NO CAMBIE.
   *
   * Antes era `return menuDe(this.currentUser)` a secas, y eso CONGELABA LA APP
   * en produccion (1/sep/2026). `sidebar.html` hace
   * `*ngFor="let grupo of menu()"` con otro `*ngFor` anidado y un `[ngSwitch]`
   * de 21 ramas de SVG dentro. Angular llama `menu()` en CADA ciclo de
   * deteccion de cambios, y al comparar por identidad veia un arreglo nuevo:
   * destruia y recreaba las 21 entradas completas —con sus SVG y sus
   * `routerLinkActive`, que se re-suscriben— en cada click, cada respuesta HTTP
   * y cada tick de los cuatro polls.
   *
   * La comparacion es por IDENTIDAD y eso basta porque `currentUser` llega por
   * `@Input()` desde un campo plano del padre (`home.ts:39`), no de un getter
   * que fabrique objetos.
   */
  menu() {
    if (this.currentUser !== this._cacheUser) {
      this._cacheUser = this.currentUser;
      this._cacheMenu = menuDe(this.currentUser);
    }
    return this._cacheMenu;
  }

  /**
   * Cuántas entradas ve. El objetivo del documento 4 es SIETE por nivel, y hoy
   * un admin global ve bastante más: alcanzarlo exige fundir Estadísticas,
   * Ranking, Productividad y Checkstore en una sola pantalla con pestañas, que
   * es el resto del paso 4.1. Se expone el número para que el avance sea
   * medible en vez de una impresión.
   */
  totalEntradas(): number {
    return totalVisible(this.currentUser);
  }

  // El badge de "conflictos de rutinas" desapareció junto con el modelo de
  // rutinas. Ya no hay conflicto que detectar: nadie asigna una rutina a una
  // persona que descansa, porque nadie asigna nada — el puesto decide y el
  // robot ya omite a quien descansa o está fuera de turno.
  ngOnInit() { /* sin listeners propios */ }
  ngOnDestroy() {
    // El único temporizador propio: el que borra el mensaje del botón de
    // actualizar. Se limpia porque este componente se monta y se destruye en
    // cada pantalla, y un `setTimeout` huérfano escribiendo en un componente
    // muerto es el mismo descuido que dejó 20 `setInterval` corriendo en
    // Checklist (ver el «FIX MEMORY LEAK» de `iniciarRobotNotificador`).
    if (this.relojMensaje) { clearTimeout(this.relojMensaje); this.relojMensaje = null; }
  }

  /**
   * ¿Se le muestra "Promociones" (activación, formato MKTN001)?
   *
   * Con CUALQUIERA de sus dos oficios basta: `promocionesFormato` (captura el
   * formato y alcanza todo) o `promocionesExpediente` (solo llena el expediente
   * de su sucursal). `grupoPromociones` es la bandera vieja de cuando el
   * apartado era un permiso único; se acepta mientras haya sesiones firmadas
   * antes del cambio. Ni el rol admin abre esta puerta por sí solo.
   */
  get verPromociones(): boolean {
    const u = this.currentUser;
    return u?.promocionesFormato === true
        || u?.promocionesExpediente === true
        || u?.grupoPromociones === true;
  }

  /**
   * ¿Se le muestra "Venta de Promos"?
   *
   * Con CUALQUIERA de los tres permisos basta: la sección es una sola y adentro
   * cada quien ve lo suyo. Ni el rol admin abre esta puerta por sí solo — es a
   * propósito, igual que Promociones y el Espacio TEC.
   */
  get verVentaPromos(): boolean {
    const u = this.currentUser;
    return u?.ventaPromosCaja === true
        || u?.ventaPromosVendedor === true
        || u?.ventaPromosMonitor === true;
  }

  /** Solo los admins de Canindo (o admin global) ven/configuran turnos. */
  get esAdminCanindo(): boolean {
    return esAdminDeCanindo(this.currentUser);
  }

  onNavClick() {
    this.closeMenu.emit();
  }

  async cerrarSesion() {
    await cerrarSesionSegura(); // cierra Firebase + borra sesión local
    this.router.navigate(['/login']);
  }
}
