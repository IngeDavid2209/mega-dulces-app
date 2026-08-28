import { Component, Input, Output, EventEmitter, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { APP_BUILD_SELLO } from '../version';
import { esAdminDeCanindo } from '../permisos.util';
import { cerrarSesionSegura } from '../sesion.util';

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

  // El badge de "conflictos de rutinas" desapareció junto con el modelo de
  // rutinas. Ya no hay conflicto que detectar: nadie asigna una rutina a una
  // persona que descansa, porque nadie asigna nada — el puesto decide y el
  // robot ya omite a quien descansa o está fuera de turno.
  ngOnInit() { /* sin listeners propios */ }
  ngOnDestroy() { /* sin listeners propios */ }

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
