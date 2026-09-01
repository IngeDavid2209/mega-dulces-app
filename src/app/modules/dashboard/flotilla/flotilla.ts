import { Component, signal, computed, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import Swal from 'sweetalert2';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { ApiService } from '../../../shared/api.service';
import { UsuariosService } from '../../../shared/usuarios.service';
import { NotificacionesService } from '../../../services/notificaciones';

/**
 * MODULO FLOTILLA — reservas / itinerario de los vehiculos de la empresa.
 *
 * Resuelve el problema de que "toman los coches sin permiso": para usar un
 * vehiculo hay que APARTARLO (fecha, hora de salida y regreso, destino, motivo).
 * La reserva nace PENDIENTE y un admin la APRUEBA o RECHAZA. Un vehiculo no
 * puede quedar apartado por dos personas en el mismo horario (regla anti-choque
 * validada en el backend: /api/reservas-vehiculos responde 409 si hay traslape).
 *
 * Vistas:
 *   - Itinerario: tarjeta por vehiculo con su estado actual y proximas salidas.
 *   - Apartar:    formulario para solicitar un vehiculo.
 *   - Solicitudes:(solo admin) aprobar/rechazar pendientes.
 *   - Vehiculos:  (solo admin) alta/baja del catalogo de coches.
 */
type Vista = 'itinerario' | 'apartar' | 'solicitudes' | 'vehiculos';

@Component({
  selector: 'app-flotilla',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
  templateUrl: './flotilla.html',
  styleUrls: ['./flotilla.css'],
})
export class FlotillaComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private usuariosSvc = inject(UsuariosService);
  private noti = inject(NotificacionesService);

  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

  currentUser: any = null;
  vista = signal<Vista>('itinerario');

  vehiculos = signal<any[]>([]);
  reservas = signal<any[]>([]);
  cargando = signal<boolean>(true);
  ahora = signal<number>(Date.now());
  private timer: any = null;

  // Filtros del itinerario
  filtroSucursal = '';

  // Formulario "apartar"
  formVehiculoId = '';
  formFecha = '';
  formHoraSalida = '';
  formHoraRegreso = '';
  formDestino = '';
  formMotivo = '';
  enviando = false;

  // Formulario "nuevo vehiculo" (admin)
  vehNombre = '';
  vehSucursal = '';
  vehPlaca = '';
  guardandoVehiculo = false;

  get esAdmin(): boolean { return this.currentUser?.rol === 'admin'; }

  // Sucursales unicas presentes en el catalogo (para el filtro).
  sucursales = computed<string[]>(() => {
    const set = new Set<string>();
    for (const v of this.vehiculos()) if (v.sucursal) set.add(v.sucursal);
    return Array.from(set).sort();
  });

  vehiculosActivos = computed(() =>
    this.vehiculos().filter(v => v.activo !== false)
  );

  // Vehiculos que se muestran en el itinerario (aplica filtro de sucursal).
  vehiculosItinerario = computed(() => {
    const suc = this.filtroSucursal;
    return this.vehiculosActivos().filter(v => !suc || v.sucursal === suc);
  });

  // Reservas pendientes (para el panel del admin), mas recientes primero.
  pendientes = computed(() =>
    this.reservas()
      .filter(r => r.estatus === 'pendiente')
      .sort((a, b) => (a.desde || 0) - (b.desde || 0))
  );

  // Mis reservas (las que yo solicite), proximas primero.
  misReservas = computed(() => {
    const uid = this.currentUser?.uid;
    return this.reservas()
      .filter(r => r.usuarioUid === uid && r.estatus !== 'rechazada')
      .sort((a, b) => (a.desde || 0) - (b.desde || 0));
  });

  async ngOnInit() {
    try { this.currentUser = JSON.parse(localStorage.getItem('md_sesion_actual') || 'null'); }
    catch { this.currentUser = null; }
    this.usuariosSvc.iniciar();
    await this.cargarTodo();
    // Refresco ligero cada 30s (mismo criterio que el resto de la app) + reloj.
    this.timer = setInterval(() => { this.ahora.set(Date.now()); this.cargarReservas(); }, 30000);
  }

  ngOnDestroy() {
    this.usuariosSvc.detener();
    if (this.timer) clearInterval(this.timer);
  }

  async cargarTodo() {
    this.cargando.set(true);
    await Promise.all([this.cargarVehiculos(), this.cargarReservas()]);
    this.cargando.set(false);
  }

  async cargarVehiculos() {
    try {
      const r = await this.api.get('/api/vehiculos');
      this.vehiculos.set(r.items || []);
    } catch (e) { console.warn('[flotilla] no se pudieron cargar vehiculos', e); }
  }

  async cargarReservas() {
    try {
      // Itinerario: desde el inicio de hoy hasta 45 dias adelante.
      const inicioHoy = new Date(); inicioHoy.setHours(0, 0, 0, 0);
      const desde = inicioHoy.getTime();
      const hasta = desde + 45 * 24 * 60 * 60 * 1000;
      const r = await this.api.get(
        `/api/reservas-vehiculos?rangoDesde=${desde}&rangoHasta=${hasta}`
      );
      this.reservas.set(r.items || []);
    } catch (e) { console.warn('[flotilla] no se pudieron cargar reservas', e); }
  }

  // ── Itinerario: estado y proximas salidas por vehiculo ────────────────────

  /** Reserva aprobada que ocupa el vehiculo AHORA mismo (o null si esta libre). */
  ocupadaAhora(vehiculoId: string): any {
    const now = this.ahora();
    return this.reservas().find(r =>
      r.vehiculoId === vehiculoId && r.estatus === 'aprobada' &&
      r.desde <= now && r.hasta > now
    ) || null;
  }

  /** Proximas reservas aprobadas del vehiculo (a futuro), ordenadas. */
  proximas(vehiculoId: string): any[] {
    const now = this.ahora();
    return this.reservas()
      .filter(r => r.vehiculoId === vehiculoId && r.estatus === 'aprobada' && r.hasta > now)
      .sort((a, b) => a.desde - b.desde)
      .slice(0, 4);
  }

  // ── Apartar (solicitar) ───────────────────────────────────────────────────

  async solicitar() {
    if (this.enviando) return;
    if (!this.formVehiculoId) { this.aviso('Elige un vehiculo.'); return; }
    if (!this.formFecha || !this.formHoraSalida || !this.formHoraRegreso) {
      this.aviso('Indica la fecha, la hora de salida y la de regreso.'); return;
    }
    const desde = new Date(`${this.formFecha}T${this.formHoraSalida}`).getTime();
    const hasta = new Date(`${this.formFecha}T${this.formHoraRegreso}`).getTime();
    if (isNaN(desde) || isNaN(hasta)) { this.aviso('Fecha u hora invalida.'); return; }
    if (!(hasta > desde)) { this.aviso('La hora de regreso debe ser posterior a la de salida.'); return; }

    this.enviando = true;
    const id = 'res_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const reserva = {
      id,
      vehiculoId: this.formVehiculoId,
      usuarioUid: this.currentUser?.uid || '',
      desde, hasta,
      estatus: 'pendiente',
      // Datos descriptivos (van al jsonb):
      solicitante: this.currentUser?.nombre || this.currentUser?.correo || 'Desconocido',
      sucursal: this.vehiculoPorId(this.formVehiculoId)?.sucursal || '',
      destino: this.formDestino.trim(),
      motivo: this.formMotivo.trim(),
      creadaEn: Date.now(),
    };

    try {
      await this.api.post('/api/reservas-vehiculos', reserva);
      // Avisar a los admins que hay una solicitud por aprobar.
      const admins = this.adminUids();
      if (admins.length) {
        this.noti.enviar({
          titulo: 'Nueva solicitud de vehiculo',
          cuerpo: `${reserva.solicitante} pide ${this.nombreVehiculo(reserva.vehiculoId)} — ${this.fmtRango(reserva)}`,
          url: '/flotilla',
          uids: admins,
        });
      }
      this.limpiarFormReserva();
      await this.cargarReservas();
      this.vista.set('itinerario');
      Swal.fire({
        icon: 'success',
        title: 'Solicitud enviada',
        text: 'Un administrador debe aprobarla. Te avisaremos cuando responda.',
        confirmButtonColor: 'var(--action)',
      });
    } catch (e: any) {
      this.manejarChoque(e, 'No se pudo apartar el vehiculo.');
    } finally {
      this.enviando = false;
    }
  }

  // ── Aprobar / rechazar (admin) ────────────────────────────────────────────

  async aprobar(r: any) {
    try {
      await this.api.patch('/api/reservas-vehiculos', {
        id: r.id,
        estatus: 'aprobada',
        aprobadoPor: this.currentUser?.nombre || 'Admin',
        aprobadaEn: Date.now(),
      });
      if (r.usuarioUid) {
        this.noti.enviar({
          titulo: 'Vehiculo aprobado',
          cuerpo: `Tu solicitud de ${this.nombreVehiculo(r.vehiculoId)} (${this.fmtRango(r)}) fue APROBADA.`,
          url: '/flotilla',
          uids: [r.usuarioUid],
        });
      }
      await this.cargarReservas();
    } catch (e: any) {
      this.manejarChoque(e, 'No se pudo aprobar la solicitud.');
    }
  }

  async rechazar(r: any) {
    const { value: motivo, isConfirmed } = await Swal.fire({
      title: 'Rechazar solicitud',
      input: 'text',
      inputLabel: 'Motivo (opcional)',
      inputPlaceholder: 'Ej. el coche esta en servicio',
      showCancelButton: true,
      confirmButtonText: 'Rechazar',
      confirmButtonColor: 'var(--bad-fg)',
      cancelButtonText: 'Cancelar',
    });
    if (!isConfirmed) return;
    try {
      await this.api.patch('/api/reservas-vehiculos', {
        id: r.id,
        estatus: 'rechazada',
        rechazadoPor: this.currentUser?.nombre || 'Admin',
        motivoRechazo: (motivo || '').trim(),
      });
      if (r.usuarioUid) {
        this.noti.enviar({
          titulo: 'Vehiculo rechazado',
          cuerpo: `Tu solicitud de ${this.nombreVehiculo(r.vehiculoId)} fue rechazada.${motivo ? ' Motivo: ' + motivo : ''}`,
          url: '/flotilla',
          uids: [r.usuarioUid],
        });
      }
      await this.cargarReservas();
    } catch (e: any) {
      this.aviso((e && e.message) || 'No se pudo rechazar.');
    }
  }

  async cancelar(r: any) {
    const res = await Swal.fire({
      title: 'Cancelar reserva',
      text: `¿Cancelar la reserva de ${this.nombreVehiculo(r.vehiculoId)}?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Si, cancelar',
      confirmButtonColor: 'var(--bad-fg)',
      cancelButtonText: 'No',
    });
    if (!res.isConfirmed) return;
    try {
      await this.api.del('/api/reservas-vehiculos?id=' + encodeURIComponent(r.id));
      await this.cargarReservas();
    } catch (e: any) {
      this.aviso((e && e.message) || 'No se pudo cancelar.');
    }
  }

  // ── Catalogo de vehiculos (admin) ─────────────────────────────────────────

  async crearVehiculo() {
    if (this.guardandoVehiculo) return;
    const nombre = this.vehNombre.trim();
    if (!nombre) { this.aviso('Escribe el nombre del vehiculo.'); return; }
    this.guardandoVehiculo = true;
    const id = 'veh_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    try {
      await this.api.post('/api/vehiculos', {
        id,
        nombre,
        sucursal: this.vehSucursal.trim(),
        activo: true,
        placa: this.vehPlaca.trim(),
        creadoEn: Date.now(),
      });
      this.vehNombre = ''; this.vehSucursal = ''; this.vehPlaca = '';
      await this.cargarVehiculos();
    } catch (e: any) {
      this.aviso((e && e.message) || 'No se pudo guardar el vehiculo.');
    } finally {
      this.guardandoVehiculo = false;
    }
  }

  async alternarActivo(v: any) {
    try {
      await this.api.patch('/api/vehiculos', { id: v.id, activo: !(v.activo !== false) });
      await this.cargarVehiculos();
    } catch (e: any) {
      this.aviso((e && e.message) || 'No se pudo actualizar.');
    }
  }

  async eliminarVehiculo(v: any) {
    const res = await Swal.fire({
      title: 'Eliminar vehiculo',
      text: `¿Eliminar "${v.nombre}" del catalogo? Sus reservas quedan en el historial.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Si, eliminar',
      confirmButtonColor: 'var(--bad-fg)',
      cancelButtonText: 'No',
    });
    if (!res.isConfirmed) return;
    try {
      await this.api.del('/api/vehiculos?id=' + encodeURIComponent(v.id));
      await this.cargarVehiculos();
    } catch (e: any) {
      this.aviso((e && e.message) || 'No se pudo eliminar.');
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  vehiculoPorId(id: string): any {
    return this.vehiculos().find(v => v.id === id) || null;
  }
  nombreVehiculo(id: string): string {
    const v = this.vehiculoPorId(id);
    return v ? v.nombre : 'Vehiculo';
  }

  private adminUids(): string[] {
    return (this.usuariosSvc.usuarios() || [])
      .filter(u => u.rol === 'admin')
      .map(u => u.uid || u.id)
      .filter(Boolean);
  }

  private limpiarFormReserva() {
    this.formFecha = ''; this.formHoraSalida = ''; this.formHoraRegreso = '';
    this.formDestino = ''; this.formMotivo = '';
  }

  /** Muestra el detalle del conflicto (409) o un error generico. */
  private manejarChoque(e: any, fallback: string) {
    const msg = (e && e.message) || fallback;
    Swal.fire({ icon: 'error', title: 'Horario ocupado', text: msg, confirmButtonColor: 'var(--action)' });
  }

  private aviso(text: string) {
    Swal.fire({ icon: 'info', title: 'Aviso', text, confirmButtonColor: 'var(--action)' });
  }

  // Formato de fecha/hora para la UI.
  fmtRango(r: any): string {
    if (!r || r.desde == null) return '';
    const d = new Date(r.desde), h = new Date(r.hasta);
    const dia = d.toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short' });
    const hs = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    const hh = h.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    return `${dia}, ${hs}–${hh}`;
  }

  estatusClase(estatus: string): string {
    return 'pill pill-' + (estatus || 'pendiente');
  }
}
