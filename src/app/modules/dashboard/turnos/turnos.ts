import { Component, signal, OnInit, OnDestroy, inject, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { Firestore, doc, setDoc } from '@angular/fire/firestore';
import Swal from 'sweetalert2';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { UsuariosService } from '../../../shared/usuarios.service';
import { ApiService } from '../../../shared/api.service';
import { esAdminDeCanindo, normalizarNombre } from '../../../shared/permisos.util';
import {
  ConfigTurnos, Turno, ExcepcionTurno, MiembroTurno,
  configTurnosPorDefecto, turnoEfectivo, etiquetaTurno, fechaISO, excepcionActiva
} from '../../../shared/turnos.util';

/**
 * Configuracion de TURNOS de la sucursal Canindo.
 * Solo accesible/editable por admins de Canindo (o admin global).
 *
 * Permite: activar el control, definir horarios manana/tarde, asignar quien va
 * en cada grupo (semana base), activar rotacion automatica cada lunes y registrar
 * excepciones temporales (cuando alguien entra en otro turno por necesidad).
 */
@Component({
  selector: 'app-turnos',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
  templateUrl: './turnos.html',
  styleUrls: ['./turnos.css']
})
export class TurnosComponent implements OnInit, OnDestroy {
  isMenuOpen = false;
  currentUser: any = null;
  autorizado = false;

  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

  private firestore = inject(Firestore);
  private router = inject(Router);
  private usuariosSvc = inject(UsuariosService);
  private api = inject(ApiService);
  private destructores: (() => void)[] = [];

  // Config en edicion (copia local editable).
  config = signal<ConfigTurnos>(configTurnosPorDefecto());
  guardando = signal(false);
  hoyISO = fechaISO(new Date());

  // Candidatos: personal de Canindo (trabajadores y admins) que puede entrar en turnos.
  usuarios = signal<any[]>([]);
  candidatos = computed(() => {
    const canindo = normalizarNombre('Canindo');
    return this.usuarios()
      // Solo trabajadores (no admins) con Canindo EXPLICITO en su lista.
      // No se incluye por el comodin 'General (Acceso Total)' para que no se
      // cuelen gerencia general ni cuentas de otras sucursales.
      .filter(u => u.rol === 'trabajador')
      .filter(u => {
        const sus: string[] = u.sucursales || (u.sucursal ? [u.sucursal] : []);
        return sus.some(s => normalizarNombre(s) === canindo);
      })
      .map(u => ({ uid: u.id || u.uid, nombre: u.nombre || u.correo || '(sin nombre)' }))
      .filter(u => !!u.uid)
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  // Buscador y filtro de la lista de personas.
  buscarPersona = signal('');
  filtroTurno = signal<'todos' | 'manana' | 'tarde' | 'sin'>('todos');

  candidatosFiltrados = computed(() => {
    const q = normalizarNombre(this.buscarPersona());
    const ft = this.filtroTurno();
    return this.candidatos().filter(c => {
      if (q && !normalizarNombre(c.nombre).includes(q)) return false;
      if (ft !== 'todos') {
        const base = this.turnoBaseDe(c.uid);
        if (ft === 'sin') return base === null;
        return base === ft;
      }
      return true;
    });
  });

  // Contadores del grupo base.
  cuentaManana = computed(() => this.config().grupoManana.length);
  cuentaTarde = computed(() => this.config().grupoTarde.length);
  cuentaSinTurno = computed(() => {
    const enTurno = new Set([...this.config().grupoManana, ...this.config().grupoTarde].map(m => m.uid));
    return this.candidatos().filter(c => !enTurno.has(c.uid)).length;
  });

  // Formulario de nueva excepcion.
  nuevaExc = { uid: '', turno: 'tarde' as Turno, desde: this.hoyISO, hasta: this.hoyISO, motivo: '' };

  private _usuariosEffect = effect(() => {
    const raw = this.usuariosSvc.usuarios();
    if (!raw) return;
    this.usuarios.set(raw.map((u: any) => ({ ...u, id: u.id || u.uid })));
  });

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) this.currentUser = JSON.parse(sesion);
    this.autorizado = esAdminDeCanindo(this.currentUser);
    if (!this.autorizado) {
      this.router.navigate(['/home']);
      return;
    }
    this.usuariosSvc.iniciar();
    this.cargarConfig();
  }

  ngOnDestroy() {
    this.destructores.forEach(apagar => apagar());
    this.destructores = [];
    this.usuariosSvc.detener();
  }

  private cargarConfig() {
    // FERROCARRIL Etapa 9 (config): turnos desde Postgres (poll; antes onSnapshot).
    const recargarTurnos = async () => {
      const resp = await this.api.get('/api/config?id=turnos').catch(() => null);
      if (!resp) return;
      const data = (resp.item || null) as ConfigTurnos | null;
      if (data) {
        // Mezcla con defaults para tolerar documentos viejos / campos faltantes.
        this.config.set({ ...configTurnosPorDefecto(), ...data,
          horarios: { ...configTurnosPorDefecto().horarios, ...(data.horarios || {}) },
          grupoManana: data.grupoManana || [],
          grupoTarde: data.grupoTarde || [],
          excepciones: data.excepciones || [],
        });
      } else {
        this.config.set(configTurnosPorDefecto());
      }
    };
    recargarTurnos();
    const idTurnos = setInterval(recargarTurnos, 20000);
    this.destructores.push(() => clearInterval(idTurnos));
  }

  // === Setters simples (los templates de Angular no soportan spread) ===
  setHabilitado(v: boolean) { this.config.set({ ...this.config(), habilitado: v }); }
  setRotacion(v: boolean) { this.config.set({ ...this.config(), rotacionAutomatica: v }); }
  setHorario(turno: Turno, campo: 'inicio' | 'fin', valor: string) {
    const c = this.config();
    const horarios = { ...c.horarios, [turno]: { ...c.horarios[turno], [campo]: valor } };
    this.config.set({ ...c, horarios });
  }

  // === Grupos ===

  /** Turno BASE asignado (semana base) a un candidato, o null. */
  turnoBaseDe(uid: string): Turno | null {
    const c = this.config();
    if (c.grupoManana.some(m => m.uid === uid)) return 'manana';
    if (c.grupoTarde.some(m => m.uid === uid)) return 'tarde';
    return null;
  }

  /** Turno EFECTIVO de hoy (considera rotacion + excepciones). */
  turnoHoyDe(uid: string): Turno | null {
    return turnoEfectivo(this.config(), uid, this.hoyISO);
  }

  /** Asigna (o quita) un candidato a un grupo base. */
  setTurnoBase(cand: MiembroTurno, turno: Turno | null) {
    const c = { ...this.config() };
    c.grupoManana = c.grupoManana.filter(m => m.uid !== cand.uid);
    c.grupoTarde = c.grupoTarde.filter(m => m.uid !== cand.uid);
    if (turno === 'manana') c.grupoManana = [...c.grupoManana, { ...cand }];
    if (turno === 'tarde') c.grupoTarde = [...c.grupoTarde, { ...cand }];
    this.config.set(c);
  }

  etiqueta(t: Turno | null) { return etiquetaTurno(t); }

  // === Excepciones ===

  agregarExcepcion() {
    const e = this.nuevaExc;
    if (!e.uid) { Swal.fire('Falta la persona', 'Elige a quien aplica la excepcion.', 'warning'); return; }
    if (e.desde > e.hasta) { Swal.fire('Fechas invalidas', 'La fecha "desde" no puede ser mayor que "hasta".', 'warning'); return; }
    const cand = this.candidatos().find(c => c.uid === e.uid);
    const exc: ExcepcionTurno = {
      uid: e.uid, nombre: cand?.nombre, turno: e.turno,
      desde: e.desde, hasta: e.hasta, motivo: (e.motivo || '').trim(),
      creadoPor: this.currentUser?.nombre || ''
    };
    const c = { ...this.config(), excepciones: [...this.config().excepciones, exc] };
    this.config.set(c);
    this.nuevaExc = { uid: '', turno: 'tarde', desde: this.hoyISO, hasta: this.hoyISO, motivo: '' };
  }

  quitarExcepcion(i: number) {
    const arr = [...this.config().excepciones];
    arr.splice(i, 1);
    this.config.set({ ...this.config(), excepciones: arr });
  }

  excActiva(e: ExcepcionTurno): boolean {
    return e.desde <= this.hoyISO && this.hoyISO <= e.hasta;
  }

  // === Guardar ===

  async guardar() {
    const c = this.config();
    if (c.habilitado && c.grupoManana.length === 0 && c.grupoTarde.length === 0) {
      const r = await Swal.fire({
        title: 'Sin personal en turnos',
        text: 'Activaste el control pero no asignaste a nadie a un turno. Asi no se restringe a nadie. ¿Guardar de todos modos?',
        icon: 'warning', showCancelButton: true, confirmButtonText: 'Guardar igual', cancelButtonText: 'Cancelar'
      });
      if (!r.isConfirmed) return;
    }
    this.guardando.set(true);
    try {
      const payload: ConfigTurnos = {
        ...c,
        sucursal: 'Canindo',
        actualizadoPor: this.currentUser?.nombre || '',
        actualizadoEn: Date.now(),
      };
      await setDoc(doc(this.firestore, 'config', 'turnos'), payload, { merge: true });
      // FERROCARRIL Etapa 9 (config): dual-write a Postgres.
      await this.api.parchar('/api/config', 'turnos', payload);
      Swal.fire({ icon: 'success', title: 'Turnos guardados', timer: 1400, showConfirmButton: false });
    } catch (err: any) {
      Swal.fire('Error al guardar', err?.message || String(err), 'error');
    } finally {
      this.guardando.set(false);
    }
  }

  /** Reinicia la rotacion para que ESTA semana sea la "semana base". */
  reiniciarRotacion() {
    this.config.set({ ...this.config(), semanaBase: this.hoyISO });
    Swal.fire({ icon: 'info', title: 'Rotacion reiniciada a esta semana', text: 'No olvides Guardar.', timer: 2000, showConfirmButton: false });
  }
}
