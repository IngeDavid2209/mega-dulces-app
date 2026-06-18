import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { Firestore, collection, query, onSnapshot, addDoc, doc, updateDoc, deleteDoc } from '@angular/fire/firestore';
import Swal from 'sweetalert2';

import { SidebarComponent } from '../shared/sidebar/sidebar';

/**
 * Espacio TEC — apartado colaborativo dentro de la app, visible solo para
 * usuarios con el privilegio `grupoTec` (que solo el admin activa) o admins.
 *
 * Tablero COMPARTIDO entre los miembros: tareas e ideas/notas.
 *
 * Datos en Firestore:
 *   - tec_tareas: { texto, completada, creadoPor, creadoPorUid, creadoEn, completadaPor, completadaEn }
 *   - tec_notas:  { titulo, texto, autor, autorUid, creadoEn, actualizadoEn }
 */
@Component({
  selector: 'app-espacio-tec',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
  templateUrl: './espacio-tec.html',
  styleUrls: ['./espacio-tec.css']
})
export class EspacioTecComponent implements OnInit, OnDestroy {
  currentUser: any = null;
  isMenuOpen = false;
  vista: 'tareas' | 'notas' = 'tareas';

  // Tareas compartidas
  tareas: any[] = [];
  nuevaTareaTexto = '';
  private radarTareas: (() => void) | null = null;

  // Ideas / notas compartidas
  notas: any[] = [];
  nuevaNotaTitulo = '';
  nuevaNotaTexto = '';
  notaEnEdicionId: string | null = null;
  edicionTitulo = '';
  edicionTexto = '';
  private radarNotas: (() => void) | null = null;

  private firestore = inject(Firestore);
  private router = inject(Router);

  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (!sesion) { this.router.navigate(['/login']); return; }
    this.currentUser = JSON.parse(sesion);
    this.conectar();
  }

  ngOnDestroy() {
    if (this.radarTareas) { this.radarTareas(); this.radarTareas = null; }
    if (this.radarNotas) { this.radarNotas(); this.radarNotas = null; }
  }

  private miUid(): string {
    return this.currentUser?.uid || this.currentUser?.id || '';
  }

  private conectar() {
    const tareasRef = collection(this.firestore, 'tec_tareas');
    this.radarTareas = onSnapshot(query(tareasRef), snap => {
      this.tareas = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .sort((a, b) => (Number(a.completada) - Number(b.completada)) || (Number(b.creadoEn || 0) - Number(a.creadoEn || 0)));
    });

    const notasRef = collection(this.firestore, 'tec_notas');
    this.radarNotas = onSnapshot(query(notasRef), snap => {
      this.notas = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .sort((a, b) => Number(b.creadoEn || 0) - Number(a.creadoEn || 0));
    });
  }

  cambiarVista(v: 'tareas' | 'notas') { this.vista = v; }

  // ===================== TAREAS =====================
  async agregarTarea() {
    const texto = this.nuevaTareaTexto.trim();
    if (!texto) return;
    try {
      await addDoc(collection(this.firestore, 'tec_tareas'), {
        texto,
        completada: false,
        creadoPor: this.currentUser?.nombre || this.currentUser?.usuario || 'TEC',
        creadoPorUid: this.miUid(),
        creadoEn: Date.now()
      });
      this.nuevaTareaTexto = '';
    } catch (e) {
      console.error('[tec] agregarTarea', e);
      Swal.fire({ icon: 'error', title: 'No se pudo agregar', text: 'Intenta de nuevo.', confirmButtonColor: '#0F172A' });
    }
  }

  async toggleTarea(t: any) {
    try {
      const completada = !t.completada;
      await updateDoc(doc(this.firestore, 'tec_tareas', t.id), {
        completada,
        completadaPor: completada ? (this.currentUser?.nombre || this.currentUser?.usuario || 'TEC') : null,
        completadaEn: completada ? Date.now() : null
      });
    } catch (e) { console.error('[tec] toggleTarea', e); }
  }

  async eliminarTarea(t: any) {
    const r = await Swal.fire({
      title: 'Eliminar tarea', text: '¿Seguro que quieres eliminar esta tarea?',
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Sí, eliminar', cancelButtonText: 'Cancelar', confirmButtonColor: '#DC2626'
    });
    if (!r.isConfirmed) return;
    try {
      await deleteDoc(doc(this.firestore, 'tec_tareas', t.id));
    } catch (e) { console.error('[tec] eliminarTarea', e); }
  }

  get tareasPendientes(): number {
    return this.tareas.filter(t => !t.completada).length;
  }

  // ===================== NOTAS / IDEAS =====================
  async agregarNota() {
    const titulo = this.nuevaNotaTitulo.trim();
    const texto = this.nuevaNotaTexto.trim();
    if (!titulo && !texto) return;
    try {
      await addDoc(collection(this.firestore, 'tec_notas'), {
        titulo: titulo || '(Sin título)',
        texto,
        autor: this.currentUser?.nombre || this.currentUser?.usuario || 'TEC',
        autorUid: this.miUid(),
        creadoEn: Date.now(),
        actualizadoEn: Date.now()
      });
      this.nuevaNotaTitulo = '';
      this.nuevaNotaTexto = '';
    } catch (e) {
      console.error('[tec] agregarNota', e);
      Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: 'Intenta de nuevo.', confirmButtonColor: '#0F172A' });
    }
  }

  empezarEdicionNota(n: any) {
    this.notaEnEdicionId = n.id;
    this.edicionTitulo = n.titulo || '';
    this.edicionTexto = n.texto || '';
  }

  cancelarEdicionNota() {
    this.notaEnEdicionId = null;
    this.edicionTitulo = '';
    this.edicionTexto = '';
  }

  async guardarEdicionNota(n: any) {
    try {
      await updateDoc(doc(this.firestore, 'tec_notas', n.id), {
        titulo: this.edicionTitulo.trim() || '(Sin título)',
        texto: this.edicionTexto.trim(),
        actualizadoEn: Date.now()
      });
      this.cancelarEdicionNota();
    } catch (e) { console.error('[tec] guardarEdicionNota', e); }
  }

  async eliminarNota(n: any) {
    const r = await Swal.fire({
      title: 'Eliminar nota', text: '¿Seguro que quieres eliminar esta idea/nota?',
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Sí, eliminar', cancelButtonText: 'Cancelar', confirmButtonColor: '#DC2626'
    });
    if (!r.isConfirmed) return;
    try {
      await deleteDoc(doc(this.firestore, 'tec_notas', n.id));
    } catch (e) { console.error('[tec] eliminarNota', e); }
  }

  // ===================== UTILIDADES =====================
  formatearFecha(ts: number | undefined): string {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  }
}
