import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';

/**
 * Panel "Tareas que asigne": el admin ve TODAS las tareas que ha repartido a
 * otras personas (las que tienen asignadaPor), de todas las agendas, con filtros.
 * No es la agenda personal; es un tablero de lo asignado a otros.
 *
 * Lee del endpoint /api/tareas-asignadas (firebase-admin junta todas las agendas).
 */
@Component({
  selector: 'app-tareas-asignadas',
  standalone: true,
  imports: [CommonModule, FormsModule, SidebarComponent],
  templateUrl: './tareas-asignadas.html',
  styleUrls: ['./tareas-asignadas.css']
})
export class TareasAsignadasComponent implements OnInit {
  private auth = inject(Auth);
  private router = inject(Router);

  isMenuOpen = false;
  currentUser: any = null;

  cargando = true;
  error = '';
  tareas: any[] = [];
  personas: string[] = [];
  sucursales: string[] = [];

  // Filtros
  filtroPersona = '';
  filtroSucursal = '';
  filtroEstado = '';   // '' | 'pendiente' | 'completada'
  filtroFecha = '';    // YYYY-MM-DD

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (!sesion) { this.router.navigate(['/login']); return; }
    this.currentUser = JSON.parse(sesion);
    this.cargar();
  }

  async cargar() {
    this.cargando = true;
    this.error = '';
    try {
      const token = await this.auth.currentUser?.getIdToken();
      if (!token) { this.error = 'Tu sesión expiró. Vuelve a iniciar sesión.'; this.cargando = false; return; }
      const resp = await fetch('/api/tareas-asignadas', { headers: { 'Authorization': 'Bearer ' + token } });
      if (!resp.ok) { this.error = 'No se pudieron cargar las tareas asignadas.'; this.cargando = false; return; }
      const data = await resp.json();
      this.tareas = data.tareas || [];
      this.personas = data.personas || [];
      this.sucursales = data.sucursales || [];
    } catch (_) {
      this.error = 'No me pude conectar. Revisa tu internet.';
    }
    this.cargando = false;
  }

  get tareasFiltradas(): any[] {
    return this.tareas.filter(t => {
      if (this.filtroPersona && t.persona !== this.filtroPersona) return false;
      if (this.filtroSucursal && t.sucursal !== this.filtroSucursal) return false;
      if (this.filtroEstado === 'pendiente' && t.completada) return false;
      if (this.filtroEstado === 'completada' && !t.completada) return false;
      if (this.filtroFecha && t.fecha !== this.filtroFecha) return false;
      return true;
    });
  }

  get totalPendientes(): number { return this.tareasFiltradas.filter(t => !t.completada).length; }
  get totalCompletadas(): number { return this.tareasFiltradas.filter(t => t.completada).length; }

  limpiarFiltros() {
    this.filtroPersona = '';
    this.filtroSucursal = '';
    this.filtroEstado = '';
    this.filtroFecha = '';
  }

  formatearFecha(iso: string): string {
    if (!iso) return 'Sin fecha';
    try { return new Date(iso + 'T00:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short' }); }
    catch { return iso; }
  }

  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

  async cerrarSesion() {
    try { if (this.auth) await this.auth.signOut(); } catch (_) {}
    localStorage.removeItem('md_sesion_actual');
    this.router.navigate(['/login']);
  }
}
