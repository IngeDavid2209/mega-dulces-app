import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { DragDropModule, CdkDragDrop, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { Firestore, collection, query, onSnapshot, addDoc, doc, updateDoc, deleteDoc } from '@angular/fire/firestore';
import Swal from 'sweetalert2';

import { SidebarComponent } from '../shared/sidebar/sidebar';

interface Subtarea { id: string; texto: string; hecha: boolean; }

/**
 * Espacio TEC — sección colaborativa dentro de la app (privilegio `grupoTec`).
 * Fase 1: Tablero Kanban (tipo Trello) + Ideas/Notas.
 *
 * Firestore:
 *   - tec_tareas: tarjetas del tablero
 *       { titulo, columna, orden, color, asignado, fechaLimite, subtareas[],
 *         creadoPor, creadoPorUid, creadoEn, actualizadoEn }
 *   - tec_notas: ideas/notas { titulo, texto, autor, autorUid, creadoEn, actualizadoEn }
 */
@Component({
  selector: 'app-espacio-tec',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, DragDropModule, SidebarComponent],
  templateUrl: './espacio-tec.html',
  styleUrls: ['./espacio-tec.css']
})
export class EspacioTecComponent implements OnInit, OnDestroy {
  currentUser: any = null;
  isMenuOpen = false;
  vista: 'tablero' | 'notas' = 'tablero';

  // ---------------- Tablero Kanban ----------------
  readonly columnas = [
    { id: 'porhacer', nombre: 'Por hacer' },
    { id: 'hoy',      nombre: 'Para hoy' },
    { id: 'progreso', nombre: 'En progreso' },
    { id: 'hecho',    nombre: 'Hecho' },
  ];
  readonly colores = ['#A78BFA', '#34D399', '#FCD34D', '#F472B6', '#60A5FA', '#FB923C', '#E2E8F0'];
  readonly idsColumnas = this.columnas.map(c => c.id);

  /** Tarjetas agrupadas por columna (lo que consume el tablero / CDK). */
  tablero: Record<string, any[]> = { porhacer: [], hoy: [], progreso: [], hecho: [] };
  private radarTareas: (() => void) | null = null;

  // Alta rápida inline por columna
  agregandoEnColumna: string | null = null;
  nuevoCardTexto = '';

  // Modal de detalle de tarjeta
  isCardModalOpen = false;
  tarjeta: any = null;            // copia editable de la tarjeta abierta
  nuevaSubtareaTexto = '';

  // ---------------- Ideas / Notas ----------------
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

  private miUid(): string { return this.currentUser?.uid || this.currentUser?.id || ''; }
  private miNombre(): string { return this.currentUser?.nombre || this.currentUser?.usuario || 'TEC'; }

  private conectar() {
    const tareasRef = collection(this.firestore, 'tec_tareas');
    this.radarTareas = onSnapshot(query(tareasRef), snap => {
      const cards = snap.docs.map(d => this.normalizar({ id: d.id, ...(d.data() as any) }));
      const nuevo: Record<string, any[]> = { porhacer: [], hoy: [], progreso: [], hecho: [] };
      for (const c of cards) {
        const col = nuevo[c.columna] ? c.columna : 'porhacer';
        nuevo[col].push(c);
      }
      for (const k of Object.keys(nuevo)) nuevo[k].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
      this.tablero = nuevo;
    });

    const notasRef = collection(this.firestore, 'tec_notas');
    this.radarNotas = onSnapshot(query(notasRef), snap => {
      this.notas = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .sort((a, b) => Number(b.creadoEn || 0) - Number(a.creadoEn || 0));
    });
  }

  /** Tolera tarjetas viejas (modelo simple texto/completada). */
  private normalizar(c: any): any {
    return {
      ...c,
      titulo: c.titulo || c.texto || '(sin título)',
      columna: c.columna || (c.completada ? 'hecho' : 'porhacer'),
      orden: typeof c.orden === 'number' ? c.orden : 0,
      color: c.color || '#E2E8F0',
      subtareas: Array.isArray(c.subtareas) ? c.subtareas : [],
    };
  }

  cambiarVista(v: 'tablero' | 'notas') { this.vista = v; }

  // ===================== KANBAN =====================
  nombreColumna(id: string): string { return this.columnas.find(c => c.id === id)?.nombre || id; }

  progresoSub(c: any): { hechas: number; total: number } {
    const total = (c.subtareas || []).length;
    const hechas = (c.subtareas || []).filter((s: Subtarea) => s.hecha).length;
    return { hechas, total };
  }

  async agregarCard(colId: string) {
    const titulo = this.nuevoCardTexto.trim();
    if (!titulo) { this.agregandoEnColumna = null; return; }
    const orden = (this.tablero[colId]?.length || 0);
    try {
      await addDoc(collection(this.firestore, 'tec_tareas'), {
        titulo, columna: colId, orden,
        color: '#E2E8F0', asignado: '', fechaLimite: '',
        subtareas: [],
        creadoPor: this.miNombre(), creadoPorUid: this.miUid(),
        creadoEn: Date.now(), actualizadoEn: Date.now()
      });
      this.nuevoCardTexto = '';
      this.agregandoEnColumna = null;
    } catch (e) {
      console.error('[tec] agregarCard', e);
      Swal.fire({ icon: 'error', title: 'No se pudo agregar', confirmButtonColor: '#0F172A' });
    }
  }

  /** Drop de CDK: mueve dentro o entre columnas y persiste el orden. */
  async soltarTarjeta(event: CdkDragDrop<any[]>, colDestinoId: string) {
    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
      await this.persistirColumna(colDestinoId);
    } else {
      const colOrigenId = event.previousContainer.id;
      transferArrayItem(event.previousContainer.data, event.container.data, event.previousIndex, event.currentIndex);
      await Promise.all([this.persistirColumna(colOrigenId), this.persistirColumna(colDestinoId)]);
    }
  }

  /** Reescribe columna + orden de todas las tarjetas de una columna. */
  private async persistirColumna(colId: string) {
    const lista = this.tablero[colId] || [];
    await Promise.all(lista.map((c, i) => {
      c.columna = colId; c.orden = i;
      return updateDoc(doc(this.firestore, 'tec_tareas', c.id), { columna: colId, orden: i, actualizadoEn: Date.now() })
        .catch(e => console.error('[tec] persistir', e));
    }));
  }

  // ---- Modal de tarjeta ----
  abrirTarjeta(c: any) {
    // Copia editable (para no mutar el tablero hasta guardar)
    this.tarjeta = { ...c, subtareas: (c.subtareas || []).map((s: Subtarea) => ({ ...s })) };
    this.nuevaSubtareaTexto = '';
    this.isCardModalOpen = true;
  }
  cerrarTarjeta() { this.isCardModalOpen = false; this.tarjeta = null; }

  elegirColor(color: string) { if (this.tarjeta) this.tarjeta.color = color; }

  agregarSubtareaModal() {
    const t = this.nuevaSubtareaTexto.trim();
    if (!t || !this.tarjeta) return;
    this.tarjeta.subtareas = [...(this.tarjeta.subtareas || []), { id: 's_' + Date.now() + Math.random().toString(36).slice(2, 5), texto: t, hecha: false }];
    this.nuevaSubtareaTexto = '';
  }
  toggleSubtareaModal(s: Subtarea) { s.hecha = !s.hecha; }
  eliminarSubtareaModal(s: Subtarea) { this.tarjeta.subtareas = this.tarjeta.subtareas.filter((x: Subtarea) => x.id !== s.id); }

  async guardarTarjeta() {
    if (!this.tarjeta) return;
    const titulo = (this.tarjeta.titulo || '').trim();
    if (!titulo) { Swal.fire({ icon: 'info', title: 'Ponle un título a la tarjeta', confirmButtonColor: '#0F172A' }); return; }
    try {
      await updateDoc(doc(this.firestore, 'tec_tareas', this.tarjeta.id), {
        titulo,
        color: this.tarjeta.color || '#E2E8F0',
        asignado: this.tarjeta.asignado || '',
        fechaLimite: this.tarjeta.fechaLimite || '',
        subtareas: this.tarjeta.subtareas || [],
        actualizadoEn: Date.now()
      });
      this.cerrarTarjeta();
    } catch (e) {
      console.error('[tec] guardarTarjeta', e);
      Swal.fire({ icon: 'error', title: 'No se pudo guardar', confirmButtonColor: '#0F172A' });
    }
  }

  async eliminarTarjeta() {
    if (!this.tarjeta) return;
    const r = await Swal.fire({
      title: 'Eliminar tarjeta', text: '¿Seguro que quieres eliminarla?', icon: 'warning',
      showCancelButton: true, confirmButtonText: 'Sí, eliminar', cancelButtonText: 'Cancelar', confirmButtonColor: '#DC2626'
    });
    if (!r.isConfirmed) return;
    try {
      await deleteDoc(doc(this.firestore, 'tec_tareas', this.tarjeta.id));
      this.cerrarTarjeta();
    } catch (e) { console.error('[tec] eliminarTarjeta', e); }
  }

  // ===================== NOTAS / IDEAS =====================
  async agregarNota() {
    const titulo = this.nuevaNotaTitulo.trim();
    const texto = this.nuevaNotaTexto.trim();
    if (!titulo && !texto) return;
    try {
      await addDoc(collection(this.firestore, 'tec_notas'), {
        titulo: titulo || '(Sin título)', texto,
        autor: this.miNombre(), autorUid: this.miUid(),
        creadoEn: Date.now(), actualizadoEn: Date.now()
      });
      this.nuevaNotaTitulo = ''; this.nuevaNotaTexto = '';
    } catch (e) {
      console.error('[tec] agregarNota', e);
      Swal.fire({ icon: 'error', title: 'No se pudo guardar', confirmButtonColor: '#0F172A' });
    }
  }
  empezarEdicionNota(n: any) { this.notaEnEdicionId = n.id; this.edicionTitulo = n.titulo || ''; this.edicionTexto = n.texto || ''; }
  cancelarEdicionNota() { this.notaEnEdicionId = null; this.edicionTitulo = ''; this.edicionTexto = ''; }
  async guardarEdicionNota(n: any) {
    try {
      await updateDoc(doc(this.firestore, 'tec_notas', n.id), {
        titulo: this.edicionTitulo.trim() || '(Sin título)', texto: this.edicionTexto.trim(), actualizadoEn: Date.now()
      });
      this.cancelarEdicionNota();
    } catch (e) { console.error('[tec] guardarEdicionNota', e); }
  }
  async eliminarNota(n: any) {
    const r = await Swal.fire({
      title: 'Eliminar nota', text: '¿Seguro?', icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Sí, eliminar', cancelButtonText: 'Cancelar', confirmButtonColor: '#DC2626'
    });
    if (!r.isConfirmed) return;
    try { await deleteDoc(doc(this.firestore, 'tec_notas', n.id)); } catch (e) { console.error('[tec] eliminarNota', e); }
  }

  // ===================== UTIL =====================
  inicial(nombre: string | undefined): string { return (nombre || '?').trim().charAt(0).toUpperCase(); }

  formatearFecha(ts: number | undefined): string {
    if (!ts) return '';
    try { return new Date(ts).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  }
  formatearDia(iso: string | undefined): string {
    if (!iso) return '';
    try { return new Date(iso + 'T00:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }); }
    catch { return iso; }
  }
}
