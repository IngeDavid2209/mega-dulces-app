import { Component, Input, Output, EventEmitter, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { APP_BUILD_SELLO } from '../version';
import { esAdminDeCanindo } from '../permisos.util';
import { cerrarSesionSegura } from '../sesion.util';
import { ConflictosRutinasService } from '../conflictos-rutinas.service';

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
  private conflictosSvc = inject(ConflictosRutinasService);
  private conflictosActivo = false;

  /** ¿Este usuario gestiona rutinas? (para mostrar el badge de conflictos). */
  get gestionaRutinas(): boolean {
    return this.currentUser?.rol === 'admin' || !!this.currentUser?.puedeCrearRutinas;
  }
  /** Conteo de conflictos de rutinas (próximos 7 días). */
  get conflictosRutinas(): number {
    return this.gestionaRutinas ? this.conflictosSvc.count() : 0;
  }

  ngOnInit() {
    if (this.gestionaRutinas) { this.conflictosActivo = true; this.conflictosSvc.iniciar(); }
  }
  ngOnDestroy() {
    if (this.conflictosActivo) this.conflictosSvc.detener();
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
