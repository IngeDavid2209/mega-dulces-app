import { Component, signal, OnInit, OnDestroy, inject, effect } from '@angular/core';
import { compararPorOrganigrama } from '../../../shared/organigrama.catalogo';
import { resolverPuesto } from '../../../shared/puesto.util';
import { UsuariosService } from '../../../shared/usuarios.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { Firestore, doc, setDoc, deleteDoc } from '@angular/fire/firestore';
import Swal from 'sweetalert2';

import { ApiService } from '../../../shared/api.service';
import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { esAdminGlobal, sucursalesPermitidas } from '../../../shared/permisos.util';
import { veDescansos } from '../../../shared/audiencias';
import {
  DIAS_SEMANA,
  obtenerSemanaISO,
  desplazarSemanaISO,
  semanaISOATexto,
  idDescanso,
  fechaLunesDeSemana
} from '../../../shared/descansos.util';

@Component({
  selector: 'app-descansos',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
  templateUrl: './descansos.html',
  styleUrls: ['./descansos.css']
})
export class DescansosComponent implements OnInit, OnDestroy {
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }
  cerrarSesion() {
    localStorage.removeItem('md_sesion_actual');
    this.router.navigate(['/login']);
  }

  currentUser: any = null;
  usuarios = signal<any[]>([]);
  descansos = signal<any[]>([]);
  terminoBusqueda = '';
  sucursalSeleccionada = 'Todas';

  semanaActualISO = signal<string>(obtenerSemanaISO(new Date()));
  diasSemana = [...DIAS_SEMANA];

  // Lista interna de sucursales para el filtro
  sucursalesDisponibles = signal<string[]>([]);

  private firestore = inject(Firestore);
  private api = inject(ApiService);
  private router = inject(Router);
  private usuariosSvc = inject(UsuariosService);
  private destructores: (() => void)[] = [];
  private semanasYaCargadas = new Set<string>();
  private guardadoTimers = new Map<string, any>();

  // Effect: lista de usuarios viene del servicio compartido. Recalculamos
  // sucursales disponibles cuando cambia.
  private _usuariosEffect = effect(() => {
    const raw = this.usuariosSvc.usuarios();
    if (!raw) return;
    this.usuarios.set(raw.map((u: any) => ({ ...u, idFirestore: u.id || u.uid })));
    this.recalcularSucursalesDisponibles();
  });

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) { this.currentUser = JSON.parse(sesion); }
    // ── LA TERCERA COPIA DE LA REGLA, retirada el 19/sep ──────────────────
    //
    // Aqui estaba escrita a mano `rol === 'admin' || puedeAdministrarPersonal`.
    // Decia lo mismo que el menu pero con otras palabras, asi que eran DOS
    // definiciones de la misma audiencia libres de discrepar — y una tercera
    // faltaba: la ruta no pedia nada mas que `authGuard`.
    //
    // Ahora la ruta lleva `descansosGuard`, que usa `veDescansos` de
    // `shared/audiencias.ts`, LA MISMA que consulta el menu. Se conserva esta
    // comprobacion como red por si alguien monta el componente por otro camino
    // —quitarla y el guard en el mismo paso dejaria sin nada que recuperar— y
    // ahora llama al predicado compartido en vez de repetirlo.
    //
    // El destino cambia de `/home` a `/tareas`: `/home` tiene su propio guard
    // que puede rebotar a quien no tenga tablero, y encadenar dos redirecciones
    // deja a la persona dando vueltas sin saber por que.
    if (!veDescansos(this.currentUser)) {
      this.router.navigate(['/tareas']);
      return;
    }
    this.usuariosSvc.iniciar();
    this.conectarConLaNube();
  }

  ngOnDestroy() {
    this.destructores.forEach(d => d());
    this.usuariosSvc.detener();
    // Limpiamos timers de guardado pendiente
    this.guardadoTimers.forEach(t => clearTimeout(t));
  }

  conectarConLaNube() {
    // Usuarios viene de UsuariosService (listener compartido) + _usuariosEffect.

    // FERROCARRIL: poll a Postgres (antes onSnapshot).
    const recargarDescansos = async () => {
      const resp = await this.api.get('/api/descansos-semanales').catch((e: any) => { console.error('[descansos] poll', e); return null; });
      if (!resp) return;
      const items: any[] = resp.items || [];
      const lista: any[] = [];
      items.forEach((data: any) => lista.push({ ...data, idFirestore: data.id }));
      this.descansos.set(lista);
    };
    recargarDescansos();
    const idDesc = setInterval(recargarDescansos, 20000);
    this.destructores.push(() => clearInterval(idDesc));
  }

  // ============================================================================
  // FILTRADO DE TRABAJADORES (admin global ve todo, limitado solo sus sucursales)
  // ============================================================================
  get trabajadoresVisibles() {
    let lista = this.usuarios().filter(u => u.rol === 'trabajador');

    if (!esAdminGlobal(this.currentUser)) {
      const permitidas = sucursalesPermitidas(this.currentUser);
      if (permitidas !== null) {
        lista = lista.filter(u => {
          const susSuc = u.sucursales || [u.sucursal || ''];
          return susSuc.some((s: string) => permitidas.includes(s));
        });
      }
    }

    if (this.sucursalSeleccionada && this.sucursalSeleccionada !== 'Todas') {
      lista = lista.filter(u => {
        const susSuc = u.sucursales || [u.sucursal || ''];
        return susSuc.includes(this.sucursalSeleccionada);
      });
    }

    const t = this.terminoBusqueda.toLowerCase().trim();
    if (t) {
      lista = lista.filter(u => (u.nombre || '').toLowerCase().includes(t));
    }

    // Por organigrama: quien cubre a quien se entiende viendo la jerarquia,
    // no un listado alfabetico donde el Encargado cae entre sus anaquelistas.
    return lista.sort(compararPorOrganigrama<any>(
      (x: any) => resolverPuesto(x).puestoId, (x: any) => x.nombre || ''));
  }

  recalcularSucursalesDisponibles() {
    const setSuc = new Set<string>();
    for (const u of this.usuarios()) {
      if (u.rol !== 'trabajador') continue;
      const lista: string[] = u.sucursales || (u.sucursal ? [u.sucursal] : []);
      for (const s of lista) {
        if (s && s !== 'General (Acceso Total)') setSuc.add(s);
      }
    }
    let arr = Array.from(setSuc).sort();
    // Si soy admin limitado, mostrar solo las mías
    if (!esAdminGlobal(this.currentUser)) {
      const permitidas = sucursalesPermitidas(this.currentUser);
      if (permitidas !== null) {
        arr = arr.filter(s => permitidas.includes(s));
      }
    }
    this.sucursalesDisponibles.set(arr);
  }

  // ============================================================================
  // NAVEGACIÓN DE SEMANAS
  // ============================================================================
  cambiarSemana(delta: number) {
    this.semanaActualISO.set(desplazarSemanaISO(this.semanaActualISO(), delta));
  }

  irASemanaActual() {
    this.semanaActualISO.set(obtenerSemanaISO(new Date()));
  }

  esSemanaActualReal(): boolean {
    return this.semanaActualISO() === obtenerSemanaISO(new Date());
  }

  textoSemana(): string {
    return semanaISOATexto(this.semanaActualISO());
  }

  fechaDelDia(diaIndex: number): string {
    // diaIndex: 0 = Lunes, 6 = Domingo
    const lunes = fechaLunesDeSemana(this.semanaActualISO());
    const fecha = new Date(lunes);
    fecha.setUTCDate(lunes.getUTCDate() + diaIndex);
    return `${fecha.getUTCDate()}`;
  }

  // ============================================================================
  // ESTADO Y EDICIÓN DE DESCANSOS
  // ============================================================================
  diasDescansoDe(userId: string): string[] {
    const semana = this.semanaActualISO();
    const doc = this.descansos().find(d => d.userId === userId && d.semanaISO === semana);
    return doc?.dias || [];
  }

  tieneDescansoEnDia(userId: string, dia: string): boolean {
    return this.diasDescansoDe(userId).includes(dia);
  }

  contarDescansosUsuario(userId: string): number {
    return this.diasDescansoDe(userId).length;
  }

  toggleDia(usuario: any, dia: string) {
    const userId = usuario.uid || usuario.idFirestore;
    if (!userId) return;
    const semana = this.semanaActualISO();
    const actuales = this.diasDescansoDe(userId);
    let nuevos: string[];
    if (actuales.includes(dia)) {
      nuevos = actuales.filter(d => d !== dia);
    } else {
      nuevos = [...actuales, dia];
    }
    this.guardarDescansoDebounce(usuario, semana, nuevos);
  }

  /** Guarda con debounce de 400ms para soportar clics rápidos. */
  private guardarDescansoDebounce(usuario: any, semana: string, dias: string[]) {
    const userId = usuario.uid || usuario.idFirestore;
    const docId = idDescanso(userId, semana);

    // Actualización optimista local
    const lista = [...this.descansos()];
    const idx = lista.findIndex(d => d.userId === userId && d.semanaISO === semana);
    const payloadLocal = {
      userId, userNombre: usuario.nombre, semanaISO: semana, dias,
      actualizadoPor: this.currentUser?.nombre || this.currentUser?.usuario || 'desconocido',
      actualizadoEn: Date.now(),
      idFirestore: docId
    };
    if (idx >= 0) lista[idx] = { ...lista[idx], ...payloadLocal };
    else lista.push(payloadLocal);
    this.descansos.set(lista);

    // Debounce a Firestore
    const existente = this.guardadoTimers.get(docId);
    if (existente) clearTimeout(existente);
    const timer = setTimeout(() => {
      this.persistirDescanso(docId, payloadLocal, dias);
    }, 400);
    this.guardadoTimers.set(docId, timer);
  }

  private async persistirDescanso(docId: string, payload: any, diasFinales: string[]) {
    try {
      if (diasFinales.length === 0) {
        // Sin días: borramos el documento para no dejar basura
        await deleteDoc(doc(this.firestore, 'descansos_semanales', docId));
        // FERROCARRIL: dual-write a Postgres (best-effort).
        this.api.borrar('/api/descansos-semanales', docId);
      } else {
        const { idFirestore, ...sinId } = payload;
        await setDoc(doc(this.firestore, 'descansos_semanales', docId), sinId, { merge: true });
        // FERROCARRIL: dual-write a Postgres (best-effort).
        this.api.parchar('/api/descansos-semanales', docId, sinId);
      }
    } catch (e) {
      console.error('Error al guardar descanso:', e);
      Swal.fire('Error', 'No se pudo guardar el descanso. Verifica tu conexión.', 'error');
    }
  }

  // ============================================================================
  // ACCIONES MASIVAS
  // ============================================================================
  limpiarSemanaDelUsuario(usuario: any, event: Event) {
    event.stopPropagation();
    const userId = usuario.uid || usuario.idFirestore;
    if (!userId) return;
    this.guardarDescansoDebounce(usuario, this.semanaActualISO(), []);
  }

  /** Aplica el patrón "Domingo" a todos los empleados visibles que no tengan nada esta semana. */
  async aplicarDomingoATodos() {
    const lista = this.trabajadoresVisibles;
    if (lista.length === 0) {
      Swal.fire('Sin empleados', 'No hay personal visible en esta vista.', 'info');
      return;
    }

    const res = await Swal.fire({
      title: '¿Aplicar Domingo a todos?',
      text: `Marcará el Domingo como día de descanso a los ${lista.length} trabajadores visibles que aún no tienen días marcados esta semana.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, aplicar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: 'var(--action)'
    });
    if (!res.isConfirmed) return;

    let aplicados = 0;
    for (const u of lista) {
      const userId = u.uid || u.idFirestore;
      if (!userId) continue;
      const actuales = this.diasDescansoDe(userId);
      if (actuales.length > 0) continue; // respetar quien ya tiene algo
      this.guardarDescansoDebounce(u, this.semanaActualISO(), ['Domingo']);
      aplicados++;
    }

    Swal.fire({
      toast: true, position: 'top-end', showConfirmButton: false, timer: 3500,
      icon: 'success', title: `Domingo aplicado a ${aplicados} personas`
    });
  }

  trackByUser(_index: number, u: any): any {
    return u.uid || u.idFirestore || u.usuario;
  }
}
