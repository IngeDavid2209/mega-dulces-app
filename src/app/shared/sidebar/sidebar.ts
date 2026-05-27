import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { APP_BUILD_SELLO } from '../version';

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
export class SidebarComponent {
  @Input() currentUser: any = null;
  @Input() isMenuOpen = false;
  /** Se emite cuando el usuario hace click en un nav-item o cierra el menú móvil. */
  @Output() closeMenu = new EventEmitter<void>();

  /** Sello de versión del build (fecha + hora). Se muestra al pie del sidebar. */
  readonly buildSello = APP_BUILD_SELLO;

  private router = inject(Router);

  onNavClick() {
    this.closeMenu.emit();
  }

  cerrarSesion() {
    localStorage.removeItem('md_sesion_actual');
    this.router.navigate(['/login']);
  }
}
