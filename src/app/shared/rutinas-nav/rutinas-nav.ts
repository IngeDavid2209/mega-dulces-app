import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

/**
 * Riel de flujo de Rutinas: Catálogo → Asignación → Programación.
 * Se coloca arriba de las tres pantallas para interconectarlas visualmente y
 * permitir saltar entre ellas. Muestra el contador de conflictos (opcional).
 */
@Component({
  selector: 'app-rutinas-nav',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <nav class="rutnav" aria-label="Flujo de rutinas">
      <a class="rutnav-step" routerLink="/rutinas" routerLinkActive="activo">
        <span class="rutnav-num">1</span>
        <span class="rutnav-lbl">Catálogo</span>
      </a>
      <span class="rutnav-flecha" aria-hidden="true">→</span>
      <a class="rutnav-step" routerLink="/asignaciones-rutinas" routerLinkActive="activo">
        <span class="rutnav-num">2</span>
        <span class="rutnav-lbl">Asignación</span>
        <span class="rutnav-badge" *ngIf="conflictos > 0">{{ conflictos }}</span>
      </a>
      <span class="rutnav-flecha" aria-hidden="true">→</span>
      <a class="rutnav-step" routerLink="/programacion-rutinas" routerLinkActive="activo">
        <span class="rutnav-num">3</span>
        <span class="rutnav-lbl">Programación</span>
      </a>
    </nav>
  `,
  styles: [`
    .rutnav {
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 999px;
      padding: 6px; margin-bottom: 18px; width: max-content; max-width: 100%;
      box-shadow: 0 1px 2px rgba(15,23,42,.04);
    }
    .rutnav-step {
      display: inline-flex; align-items: center; gap: 8px;
      text-decoration: none; color: #64748B; font-weight: 600; font-size: 13.5px;
      padding: 7px 15px; border-radius: 999px; transition: background .15s, color .15s;
    }
    .rutnav-step:hover { background: #F1F5F9; color: #0F172A; }
    .rutnav-num {
      width: 19px; height: 19px; border-radius: 50%; background: #E2E8F0; color: #64748B;
      font-size: 11px; font-weight: 800; display: grid; place-items: center;
    }
    .rutnav-step.activo { background: #0F172A; color: #fff; }
    .rutnav-step.activo .rutnav-num { background: rgba(255,255,255,.25); color: #fff; }
    .rutnav-flecha { color: #CBD5E1; font-size: 13px; }
    .rutnav-badge {
      background: #DC2626; color: #fff; font-size: 11px; font-weight: 800;
      border-radius: 999px; padding: 1px 7px; min-width: 18px; text-align: center;
    }
    .rutnav-step.activo .rutnav-badge { background: #fff; color: #DC2626; }
    @media (max-width: 560px) {
      .rutnav-lbl { display: none; }
      .rutnav-step { padding: 7px 11px; }
    }
  `]
})
export class RutinasNavComponent {
  @Input() conflictos = 0;
}
