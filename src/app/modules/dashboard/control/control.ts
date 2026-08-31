/**
 * 🎛️ CONTROL OPERATIVO · el cascarón de las cuatro pantallas de análisis
 *
 * Monta el marco —header, sidebar, overlay móvil— UNA vez, y deja que el router
 * instancie la pestaña activa dentro. Antes cada una de las cuatro pantallas
 * traía su propio `<app-sidebar>`; ahora el marco es de aquí y ellas son
 * contenido.
 *
 * ─── LAS PESTAÑAS INACTIVAS NO SE MONTAN ───────────────────────────────────
 * Y es deliberado. Las cuatro piden rangos solapados de `mdtask_checklists`
 * —`?desde=hace7`, `?desde&hasta`, otro `?desde=hace7Cs`— y algunas con poll
 * cada 20 o 30 segundos. Montarlas todas volvería esta pantalla la más lenta de
 * la app, justo después de arreglar la del checklist.
 *
 * Con rutas hijas eso sale gratis: el router instancia solo la activa y destruye
 * la anterior. Compartir un solo fetch entre pestañas es la optimización
 * siguiente, no la de hoy.
 *
 * ─── LA PESTAÑA VA EN LA URL ───────────────────────────────────────────────
 * `/control/estadisticas`, no `?tab=`. Tres cosas que eso da:
 *   · el `redirectTo` de la ruta vieja aterriza en SU pestaña, no en la de por
 *     defecto — y hay enlaces viejos circulando por WhatsApp;
 *   · el botón atrás del navegador funciona entre pestañas;
 *   · y el guard por pestaña sale de la propia ruta hija, que es lo que impide
 *     que entrar al cascarón regale acceso a las demás.
 */
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { TABS_CONTROL, tabsVisibles } from './control.tabs';

@Component({
  selector: 'app-control',
  standalone: true,
  imports: [CommonModule, RouterModule, SidebarComponent],
  templateUrl: './control.html',
  styleUrls: ['./control.css'],
})
export class ControlComponent implements OnInit {
  private router = inject(Router);

  currentUser: any = null;
  isMenuOpen = false;

  private usuario = signal<any>(null);

  /**
   * Solo las pestañas de este usuario. La barra NO muestra las que no puede
   * abrir: una pestaña visible que rebota al hacer clic enseña a la gente que la
   * app falla, cuando lo que hay es un permiso que no tiene.
   */
  tabs = computed(() => tabsVisibles(this.usuario()));

  ngOnInit() {
    const s = localStorage.getItem('md_sesion_actual');
    if (!s) { this.router.navigate(['/login']); return; }
    try { this.currentUser = JSON.parse(s); } catch { this.currentUser = null; }
    this.usuario.set(this.currentUser);
  }

  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

  /** Cuántas pestañas existen en total, para poder decir "1 de 4" al construir. */
  totalTabs = TABS_CONTROL.length;
}
