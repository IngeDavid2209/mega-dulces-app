import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';

/**
 * Activación de promociones.
 *
 * Apartado gateado por el privilegio `grupoPromociones`, que se asigna usuario
 * por usuario desde Personal. El guard (promociones.guard.ts) es la puerta real:
 * esconder la opción del menú no basta, porque alguien podría escribir la
 * dirección a mano.
 *
 * De momento la pantalla está armada y vacía a propósito: falta definir qué hace
 * (qué es una promoción aquí, quién la activa, contra qué datos). Preferí dejar
 * el apartado y el permiso funcionando antes de inventar un flujo.
 */
@Component({
  selector: 'app-promociones',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
  templateUrl: './promociones.html',
  styleUrls: ['./promociones.css']
})
export class PromocionesComponent implements OnInit {
  currentUser: any = null;
  isMenuOpen = false;

  private router = inject(Router);

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) {
      try { this.currentUser = JSON.parse(sesion); } catch { this.currentUser = null; }
    }
  }

  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }
  irA(ruta: string) { this.router.navigate([ruta]); this.isMenuOpen = false; }

  iniciales(nombre: string): string {
    if (!nombre) return 'A';
    return nombre.split(' ').filter(Boolean).slice(0, 2).map(p => p.charAt(0)).join('').toUpperCase();
  }
}
