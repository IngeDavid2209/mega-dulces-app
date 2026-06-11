import { Component, signal, OnInit, OnDestroy, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Firestore, collection, getDocs, getDoc, doc, deleteDoc, setDoc, query, where } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { ChecklistsApi } from '../api/checklists.api';
import { UsuariosApi } from '../api/usuarios.api';
import { sucursalesPermitidas } from '../shared/permisos.util';
import { nivelDeCargo } from '../shared/nivel-jerarquico.util';
import { esItemHecho } from '../shared/item-completado.util';

// jsPDF, jspdf-autotable, exceljs y html2canvas se cargan SOLO cuando el usuario
// pide Exportar (PDF/Excel) o Reporte visual. Antes se importaban al inicio y
// pesaban ~1.5 MB en el bundle, ralentizando el arranque en móvil aunque casi
// nadie use estas funciones a diario.
import Swal from 'sweetalert2';

import { SidebarComponent } from '../shared/sidebar/sidebar';

@Component({
  selector: 'app-reportes',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
  templateUrl: './reportes.html',
  styleUrls: ['./reportes.css']
})
export class ReportesComponent implements OnInit, OnDestroy {
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

  currentUser: any = null;
  fechaInicio = '';
  fechaFin = '';

  // ----- Filtro por EMPLEADO -----
  empleadoSeleccionado = '';
  textoBusquedaEmpleado = '';
  mostrarDropdownEmpleados = false;

  // ----- 🆕 Filtro por SUCURSAL -----
  sucursalSeleccionada = '';
  textoBusquedaSucursal = '';
  mostrarDropdownSucursales = false;

  sucursalesDisponibles: string[] = [
    'ADMINISTRADORES DEL SISTEMA', 'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
    'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro', 'OFICINAS CORPORATIVAS',
    'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD', 'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO'
  ];

  empleados = signal<any[]>([]);
  resultados = signal<any[]>([]);
  buscando = signal(false);
  busquedaRealizada = signal(false);
  generandoReporte = signal(false);

  vistaActual = signal<'lista' | 'detalle'>('lista');
  checklistSeleccionado = signal<any>(null);

  isPasswordModalOpen = false;
  passwordInput = '';

  private firestore = inject(Firestore);
  private checklistsApi = inject(ChecklistsApi);
  private usuariosApi = inject(UsuariosApi);
  private route = inject(ActivatedRoute);
  private busquedaSub: any = null;

  @HostListener('document:click', ['$event'])
  onClickOutside(event: Event) {
    const target = event.target as HTMLElement;

    // Cerrar dropdown de EMPLEADOS al hacer click afuera
    if (!target.closest('.autocomplete-empleados')) {
      this.mostrarDropdownEmpleados = false;
      if (this.empleadoSeleccionado !== this.textoBusquedaEmpleado) {
        this.textoBusquedaEmpleado = this.empleadoSeleccionado || 'Todos los empleados';
      }
    }

    // 🆕 Cerrar dropdown de SUCURSALES al hacer click afuera
    if (!target.closest('.autocomplete-sucursales')) {
      this.mostrarDropdownSucursales = false;
      if (this.sucursalSeleccionada !== this.textoBusquedaSucursal) {
        this.textoBusquedaSucursal = this.sucursalSeleccionada || 'Todas las sucursales';
      }
    }
  }

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) { this.currentUser = JSON.parse(sesion); }

    const hoy = new Date();
    const offset = hoy.getTimezoneOffset() * 60000;
    const hoyLocal = new Date(hoy.getTime() - offset);

    this.fechaFin = hoyLocal.toISOString().split('T')[0];
    const primeroDeMes = new Date(hoyLocal.getFullYear(), hoyLocal.getMonth(), 1);
    this.fechaInicio = primeroDeMes.toISOString().split('T')[0];

    this.textoBusquedaEmpleado = 'Todos los empleados';
    this.textoBusquedaSucursal = 'Todas las sucursales';

    this.cargarEmpleados().then(() => {
      this.route.queryParams.subscribe(params => {
        if (params['empleado']) {
          this.empleadoSeleccionado = params['empleado'];
          this.textoBusquedaEmpleado = this.empleadoSeleccionado;
          this.buscarReportes();
        }
        // 🆕 También aceptamos queryParam de sucursal por si lo necesitas a futuro
        if (params['sucursal']) {
          this.sucursalSeleccionada = params['sucursal'];
          this.textoBusquedaSucursal = this.sucursalSeleccionada;
          this.buscarReportes();
        }
      });
    });
  }

  ngOnDestroy() { if (this.busquedaSub) { this.busquedaSub(); } }

  /** trackBy para el listado de resultados: usa el id Firestore del checklist. */
  trackByChecklist(_: number, c: any): any { return c?.id || c?.idDoc || _; }

  /** Cache nombre normalizado → nivel, evita .find() en cada llamada. */
  private _nivelPorNombre = new Map<string, 'mando' | 'operativo'>();
  private _empleadosVersion = -1;
  private actualizarMapaNivelSiCambio() {
    const empleados = this.empleados();
    if (empleados.length === this._empleadosVersion) return;
    this._empleadosVersion = empleados.length;
    const mapa = new Map<string, 'mando' | 'operativo'>();
    for (const e of empleados) {
      if (!e?.nombre) continue;
      mapa.set((e.nombre || '').trim().toLowerCase(), nivelDeCargo(e.cargo));
    }
    this._nivelPorNombre = mapa;
  }

  /**
   * Devuelve el nivel jerárquico del empleado al que está asignado un checklist.
   * Usa cache Map para evitar `.find()` en cada llamada.
   */
  nivelDelAssigned(assigned: string | undefined | null): 'mando' | 'operativo' {
    if (!assigned) return 'operativo';
    this.actualizarMapaNivelSiCambio();
    return this._nivelPorNombre.get(assigned.trim().toLowerCase()) || 'operativo';
  }

  /**
   * Cache de los 3 derivados, recalculado solo si cambia el length de resultados
   * o la versión de empleados (para mapeo de cargo). Evita filtrar la lista
   * entera 3 veces por cada change detection.
   */
  private _cacheResultadosHuella = '';
  private _cacheResultadosMandos: any[] = [];
  private _cacheResultadosOperativos: any[] = [];
  private _cacheResultadosOrdenados: any[] = [];
  private actualizarCacheResultadosSiCambio() {
    const lista = this.resultados();
    const huella = `${lista.length}-${this._empleadosVersion}`;
    if (huella === this._cacheResultadosHuella) return;
    this._cacheResultadosHuella = huella;
    const mandos: any[] = [];
    const operativos: any[] = [];
    for (const c of lista) {
      if (this.nivelDelAssigned(c.assigned) === 'mando') mandos.push(c);
      else operativos.push(c);
    }
    this._cacheResultadosMandos = mandos;
    this._cacheResultadosOperativos = operativos;
    this._cacheResultadosOrdenados = [...mandos, ...operativos];
  }
  get resultadosMandos() {
    this.actualizarCacheResultadosSiCambio();
    return this._cacheResultadosMandos;
  }
  get resultadosOperativos() {
    this.actualizarCacheResultadosSiCambio();
    return this._cacheResultadosOperativos;
  }
  get resultadosOrdenadosPorNivel() {
    this.actualizarCacheResultadosSiCambio();
    return this._cacheResultadosOrdenados;
  }

  async cargarEmpleados() {
    if (environment.useBackend) {
      try {
        const res = await firstValueFrom(this.usuariosApi.list({ rol: 'trabajador' }));
        this.empleados.set(res.usuarios as any[]);
      } catch (e) {
        console.error('[reportes/empleados backend]', e);
      }
      return;
    }
    const usuariosRef = collection(this.firestore, 'usuarios');
    const snapshot = await getDocs(usuariosRef);
    const lista: any[] = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data['rol'] === 'trabajador') lista.push(data);
    });
    this.empleados.set(lista);
  }

  // ============================================================================
  //  EMPLEADOS — getters y handlers
  // ============================================================================
  get empleadosFiltrados() {
    if (this.textoBusquedaEmpleado === 'Todos los empleados' || this.textoBusquedaEmpleado.trim() === '') {
      return this.empleados();
    }
    const termino = this.textoBusquedaEmpleado.toLowerCase();
    return this.empleados().filter(emp => emp.nombre.toLowerCase().includes(termino));
  }

  seleccionarEmpleado(nombreEmpleado: string) {
    if (nombreEmpleado === '') {
      this.empleadoSeleccionado = '';
      this.textoBusquedaEmpleado = 'Todos los empleados';
    } else {
      this.empleadoSeleccionado = nombreEmpleado;
      this.textoBusquedaEmpleado = nombreEmpleado;
    }
    this.mostrarDropdownEmpleados = false;
  }

  onInputBusqueda() {
    this.mostrarDropdownEmpleados = true;
    if (this.textoBusquedaEmpleado.trim() === '') {
      this.empleadoSeleccionado = '';
    }
  }

  onFocusBusqueda() {
    this.mostrarDropdownEmpleados = true;
    this.textoBusquedaEmpleado = '';
  }

  // ============================================================================
  //  🆕 SUCURSALES — getters y handlers (mismo patrón que empleados)
  // ============================================================================
  get sucursalesFiltradas(): string[] {
    if (this.textoBusquedaSucursal === 'Todas las sucursales' || this.textoBusquedaSucursal.trim() === '') {
      return this.sucursalesDisponibles;
    }
    const termino = this.textoBusquedaSucursal.toLowerCase();
    return this.sucursalesDisponibles.filter(s => s.toLowerCase().includes(termino));
  }

  seleccionarSucursal(nombreSucursal: string) {
    if (nombreSucursal === '') {
      this.sucursalSeleccionada = '';
      this.textoBusquedaSucursal = 'Todas las sucursales';
    } else {
      this.sucursalSeleccionada = nombreSucursal;
      this.textoBusquedaSucursal = nombreSucursal;
    }
    this.mostrarDropdownSucursales = false;
  }

  onInputBusquedaSucursal() {
    this.mostrarDropdownSucursales = true;
    if (this.textoBusquedaSucursal.trim() === '') {
      this.sucursalSeleccionada = '';
    }
  }

  onFocusBusquedaSucursal() {
    this.mostrarDropdownSucursales = true;
    this.textoBusquedaSucursal = '';
  }

  // ============================================================================

  async buscarReportes() {
    this.buscando.set(true);
    this.busquedaRealizada.set(true);
    // Cierra cualquier suscripción previa (si quedó alguna).
    if (this.busquedaSub) { this.busquedaSub(); this.busquedaSub = null; }

    // 🔥 Si soy admin limitado, calculamos las sucursales que SÍ puedo ver
    const sucursalesPermitidasUsuario = sucursalesPermitidas(this.currentUser);

    // 💸 OPTIMIZACIÓN: usamos getDocs (one-shot) con where() de fecha en lugar de
    // onSnapshot sobre toda la colección. Antes traíamos TODOS los checklists y
    // filtrábamos en cliente; ahora Firestore solo nos manda los del rango pedido.
    // Auditoría es búsqueda histórica, no necesita realtime.
    try {
      // Trae el rango ya con visibilidad aplicada por el backend (modo backend)
      // o por Firestore + filtro local en cliente (modo legacy).
      let crudos: any[] = [];
      if (environment.useBackend) {
        const res = await firstValueFrom(this.checklistsApi.list({
          fechaDesde: this.fechaInicio, fechaHasta: this.fechaFin,
          archivado: false, eliminado: false, limit: 5000,
        }));
        crudos = res.checklists as any[];
      } else {
        const checklistsRef = collection(this.firestore, 'checklists');
        const q = query(
          checklistsRef,
          where('date', '>=', this.fechaInicio),
          where('date', '<=', this.fechaFin)
        );
        const snapshot = await getDocs(q);
        crudos = snapshot.docs.map(d => d.data() as any);
      }

      const listasSinClones = new Map();

      crudos.forEach((c: any) => {
        if (c.eliminado === true || c.archivado === true) return;

        // 🔥 Admin limitado: descarta cualquier checklist que NO sea de sus sucursales
        if (sucursalesPermitidasUsuario !== null && !sucursalesPermitidasUsuario.includes(c.store)) return;

        // Filtro por empleado
        if (this.empleadoSeleccionado && c.assigned !== this.empleadoSeleccionado) return;

        // 🆕 Filtro por sucursal
        if (this.sucursalSeleccionada && c.store !== this.sucursalSeleccionada) return;

        const marcados = c.items ? c.items.filter((i: any) => i.checked).length : 0;
        c.calcProgreso = c.items && c.items.length > 0 ? Math.round((marcados / c.items.length) * 100) : 0;
        c.calcCompletados = marcados;

        const firma = `${c.name}_${c.assigned}_${c.store}_${c.date}`;
        if (!listasSinClones.has(firma)) {
          listasSinClones.set(firma, c);
        } else {
          const existente = listasSinClones.get(firma) as any;
          if (existente && c.calcProgreso > existente.calcProgreso) {
            listasSinClones.set(firma, c);
          }
        }
      });

      const filtrados = Array.from(listasSinClones.values());
      filtrados.sort((a, b) => b.timestampCreacion - a.timestampCreacion);

      this.resultados.set(filtrados);
    } catch (error) {
      console.error("Error buscando el historial:", error);
      Swal.fire({ icon: 'error', title: 'Error de Red', text: 'Hubo un error de conexión al buscar el historial.', confirmButtonColor: '#0F172A' });
    } finally {
      this.buscando.set(false);
    }
  }

  verDetalle(checklist: any) { this.checklistSeleccionado.set(checklist); this.vistaActual.set('detalle'); }
  volverALista() { this.checklistSeleccionado.set(null); this.vistaActual.set('lista'); }

  /**
   * Borra el checklist abierto en la vista detalle Y corta la fuente que lo
   * regenera (molde V1 + asignación V2). Si no, al día siguiente el robot
   * generaba uno nuevo y reaparecía. Solo admin.
   *
   * Pasos:
   *   1. Soft-delete del checklist y de cualquier duplicado con mismo
   *      nombre+assigned (limpia día actual y días anteriores zombies).
   *   2. Borra los moldes V1 (`moldes_checklists`) con ese nombre+assigned.
   *   3. Si es V2 (tiene `_asignacionId`), desactiva la asignación. Si la
   *      asignación es por personas con varios, solo saca a este empleado;
   *      si queda con 0 o es por rol, marca `activa: false`.
   */
  async borrarChecklistActual() {
    if (this.currentUser?.rol !== 'admin') {
      Swal.fire({ icon: 'error', title: 'Sin permiso', text: 'Solo un administrador puede borrar checklists.', confirmButtonColor: '#0F172A' });
      return;
    }
    const c = this.checklistSeleccionado();
    if (!c) return;
    const r = await Swal.fire({
      title: '¿Borrar este checklist definitivamente?',
      html: `<div style="text-align:left;font-size:13px;line-height:1.5">
               <strong>${c.name}</strong><br>
               Empleado: ${c.assigned || '(sin asignar)'}<br>
               Sucursal: ${c.store || '(sin sucursal)'}<br>
               Fecha: ${c.date}
             </div>
             <p style="margin-top:12px;color:#475569;font-size:12px">
               Borrará este registro Y evitará que se vuelva a generar en próximos días
               (desactiva la asignación / molde de la rutina si aplica).
             </p>`,
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Sí, borrar', cancelButtonText: 'Cancelar',
      confirmButtonColor: '#DC2626'
    });
    if (!r.isConfirmed) return;

    try {
      // En modo backend, un solo endpoint hace la cascada completa (soft-delete
      // de hermanos por firma name+assigned+store+fecha, borra molde V1 y
      // desactiva asignacion V2 si corresponde).
      if (environment.useBackend) {
        const res = await firstValueFrom(this.checklistsApi.softDelete(c.id, true));
        this.volverALista();
        if (this.busquedaRealizada()) this.buscarReportes();
        Swal.fire({
          icon: 'success', title: 'Borrado definitivo',
          html: `Checklists afectados: <strong>${res.checklistsAfectados}</strong>.<br>` +
                `Molde V1 y asignacion V2 manejados por el backend.`,
          confirmButtonColor: '#0F172A'
        });
        return;
      }

      const targetName = (c.name || '').replace(/ \((Diaria|Semanal|Catorcenal|Mensual|Trimestral)\)$/, '').trim();
      const targetAssigned = c.assigned;
      const meta = { eliminado: true, eliminadoPor: this.currentUser?.nombre || 'admin', eliminadoEn: Date.now() };

      // 1) Soft-delete del checklist actual y duplicados con mismo nombre+assigned.
      const chkRef = collection(this.firestore, 'checklists');
      const chkSnap = await getDocs(chkRef);
      let softDeleted = 0;
      for (const cDoc of chkSnap.docs) {
        const cData = cDoc.data() as any;
        if ((cData.name || '').startsWith(targetName) && cData.assigned === targetAssigned) {
          await setDoc(doc(this.firestore, 'checklists', cDoc.id), meta, { merge: true });
          softDeleted++;
        }
      }

      // 2) Borrado físico del molde V1.
      const moldesRef = collection(this.firestore, 'moldes_checklists');
      const moldesSnap = await getDocs(moldesRef);
      let moldesBorrados = 0;
      for (const mDoc of moldesSnap.docs) {
        const mData = mDoc.data() as any;
        if (targetName.includes(mData.name) && mData.assigned === targetAssigned) {
          await deleteDoc(doc(this.firestore, 'moldes_checklists', mDoc.id));
          moldesBorrados++;
        }
      }

      // 3) Desactivar asignación V2 (si aplica).
      let asignacionTocada = false;
      if (c._v2 && c._asignacionId) {
        const asigRef = doc(this.firestore, 'asignaciones_rutinas', c._asignacionId);
        const asigSnap = await getDoc(asigRef);
        if (asigSnap.exists()) {
          const a = asigSnap.data() as any;
          if (a.modoAsignacion === 'porPersonas' && Array.isArray(a.empleadosNombres)) {
            const sinEste = a.empleadosNombres.filter((n: string) => n !== targetAssigned);
            if (sinEste.length > 0) {
              await setDoc(asigRef, { empleadosNombres: sinEste }, { merge: true });
            } else {
              await setDoc(asigRef, { activa: false, empleadosNombres: [] }, { merge: true });
            }
          } else {
            await setDoc(asigRef, { activa: false }, { merge: true });
          }
          asignacionTocada = true;
        }
      }

      this.volverALista();
      if (this.busquedaRealizada()) this.buscarReportes();
      Swal.fire({
        icon: 'success', title: 'Borrado definitivo',
        html: `Soft-delete: <strong>${softDeleted}</strong> doc(s).<br>
               Moldes V1 borrados: <strong>${moldesBorrados}</strong>.<br>
               Asignación V2: <strong>${asignacionTocada ? 'desactivada' : 'no aplica'}</strong>.`,
        confirmButtonColor: '#0F172A'
      });
    } catch (e) {
      console.error('[borrarChecklistActual]', e);
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo borrar el checklist.', confirmButtonColor: '#0F172A' });
    }
  }

  abrirModalEliminarTodo() {
    if (this.resultados().length === 0) {
      Swal.fire({ icon: 'info', title: 'Nada que borrar', text: 'No hay registros en pantalla.', confirmButtonColor: '#0F172A' });
      return;
    }
    this.passwordInput = ''; this.isPasswordModalOpen = true;
  }

  cerrarPasswordModal() { this.isPasswordModalOpen = false; this.passwordInput = ''; }

  async confirmarEliminacionTodo() {
    // 🔒 Antes se validaba una contraseña maestra hardcodeada ('Mega2323') visible
    // en el bundle. Ahora se exige rol de administrador. (La protección real vive
    // en las Firestore Security Rules — Fase 2.)
    if (this.currentUser?.rol !== 'admin') {
      Swal.fire({ icon: 'error', title: 'Sin permiso', text: 'Solo un administrador puede borrar el historial.', confirmButtonColor: '#0F172A' });
      return;
    }

    this.cerrarPasswordModal();

    const result = await Swal.fire({
      title: '⚠️ PELIGRO EXTREMO',
      text: `¿Borrar permanentemente los ${this.resultados().length} registros filtrados en pantalla?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#EF4444',
      cancelButtonColor: '#0F172A',
      confirmButtonText: 'Sí, borrar todo',
      cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
      this.buscando.set(true);
      try {
        if (environment.useBackend) {
          for (const checklist of this.resultados()) {
            await firstValueFrom(this.checklistsApi.hardDelete(checklist.id));
          }
        } else {
          for (const checklist of this.resultados()) {
            const docId = checklist.id.toString();
            await deleteDoc(doc(this.firestore, 'checklists', docId));
          }
        }
        Swal.fire({ icon: 'success', title: 'Limpieza Total', text: 'Historial eliminado con éxito.', confirmButtonColor: '#0F172A' });
      } catch (error) {
        Swal.fire({ icon: 'error', title: 'Fallo al borrar', text: 'Ocurrió un error en la base de datos.', confirmButtonColor: '#0F172A' });
      } finally {
        this.buscando.set(false);
      }
    }
  }

  /**
   * Estado visual real del checklist según progreso + envío + tiempo.
   * Antes confiábamos en `checklist.status === 'completo'` que se ponía al
   * enviar — esto producía el bug: badge COMPLETO con barra 0%. Ahora:
   *   completo    -> 100% de items con evidencia
   *   parcial     -> se envió pero <100% (lo que antes parecía "completo bug")
   *   en-progreso -> no enviado, algún avance
   *   vencido     -> no enviado y la fecha ya pasó
   *   pendiente   -> no enviado, sin avance, fecha aún vigente
   */
  getDisplayStatus(checklist: any): 'completo' | 'parcial' | 'en-progreso' | 'vencido' | 'pendiente' {
    const progreso = this.getProgreso(checklist);
    const enviado = checklist.enviado === true || (checklist.status || '').toLowerCase() === 'completo';
    if (progreso >= 100) return 'completo';
    if (enviado) return 'parcial';
    const hoy = new Date();
    const offset = hoy.getTimezoneOffset() * 60000;
    const hoyStr = new Date(hoy.getTime() - offset).toISOString().split('T')[0];
    if (checklist.date && checklist.date < hoyStr) return 'vencido';
    if (progreso > 0) return 'en-progreso';
    return 'pendiente';
  }

  /** Etiqueta humana del estado, para badges y reportes. */
  getDisplayStatusLabel(checklist: any): string {
    switch (this.getDisplayStatus(checklist)) {
      case 'completo':    return 'Completo';
      case 'parcial':     return 'Parcial';
      case 'en-progreso': return 'En progreso';
      case 'vencido':     return 'Vencido';
      default:            return 'Pendiente';
    }
  }

  /**
   * ¿Item considerado como hecho? Usa el criterio unificado:
   * evidencia real (foto / antes+después / varias fotos / palomeo) O
   * justificación a nivel del checklist (nota del colaborador o entrega
   * con retraso justificado).
   */
  esItemCompleto(it: any, checklist?: any): boolean {
    return esItemHecho(it, checklist);
  }

  /** ¿La tarea está vencida? Compara la hora límite del item (o `time` legacy)
   *  contra ahora, tomando como referencia la fecha del checklist. */
  isTareaVencida(item: any, checklistDate: string | undefined | null): boolean {
    if (!checklistDate) return false;
    const horaUsar = item?.horaLimite || item?.time;
    let hora = 23, minuto = 59;
    if (horaUsar && typeof horaUsar === 'string' && horaUsar.includes(':')) {
      const partes = horaUsar.split(':');
      hora = Number(partes[0]) || 0;
      minuto = Number(partes[1]) || 0;
    }
    const [y, m, d] = checklistDate.split('-').map(Number);
    if (!y || !m || !d) return false;
    const deadline = new Date(y, m - 1, d, hora, minuto, 59);
    return new Date() > deadline;
  }

  /** Convierte "14:30" en "02:30 PM". Si el formato es inválido lo regresa tal cual. */
  formatearHora(hora: string | undefined | null): string {
    if (!hora || typeof hora !== 'string' || !hora.includes(':')) return hora || '';
    const partes = hora.split(':');
    let h = parseInt(partes[0], 10);
    if (isNaN(h)) return hora;
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h.toString().padStart(2, '0')}:${partes[1]} ${ampm}`;
  }

  getProgreso(checklist: any): number {
    if (!checklist.items || checklist.items.length === 0) return 0;
    const marcados = checklist.items.filter((i: any) => esItemHecho(i, checklist)).length;
    return Math.round((marcados / checklist.items.length) * 100);
  }

  getCompletados(checklist: any): number {
    if (!checklist.items) return 0;
    return checklist.items.filter((i: any) => esItemHecho(i, checklist)).length;
  }

  // KPIs para el panel de Auditoría Operativa
  getKpiTotal(): number {
    return this.resultados().length;
  }

  getKpiCompletos(): number {
    return this.resultados().filter(r => this.getDisplayStatus(r) === 'completo').length;
  }

  /** Enviados pero <100% — antes contaban como "completos" en este KPI. */
  getKpiParciales(): number {
    return this.resultados().filter(r => this.getDisplayStatus(r) === 'parcial').length;
  }

  getKpiEnProgreso(): number {
    return this.resultados().filter(r => this.getDisplayStatus(r) === 'en-progreso').length;
  }

  getKpiPendientes(): number {
    return this.resultados().filter(r => {
      const s = this.getDisplayStatus(r);
      return s === 'pendiente' || s === 'vencido';
    }).length;
  }

  getKpiProgresoPromedio(): number {
    const lista = this.resultados();
    if (lista.length === 0) return 0;
    const suma = lista.reduce((acc, r) => acc + this.getProgreso(r), 0);
    return Math.round(suma / lista.length);
  }

  tieneFotos(checklist: any): boolean {
    if (!checklist.items) return false;
    return checklist.items.some((item: any) =>
      (item.photo && item.photo.includes('http')) ||
      (item.photoAntes && item.photoAntes.includes('http')) ||
      (item.photoDespues && item.photoDespues.includes('http'))
    );
  }

  async descargarExcel() {
    if (this.resultados().length === 0) {
      Swal.fire({ icon: 'info', title: 'Sin Datos', text: 'No hay datos para exportar.', confirmButtonColor: '#0F172A' });
      return;
    }

    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Reporte Auditoría');

    worksheet.columns = [
      { header: 'Nombre Operación', key: 'name', width: 40 },
      { header: 'Sucursal', key: 'store', width: 20 },
      { header: 'Trabajador Asignado', key: 'assigned', width: 35 },
      { header: 'Fecha Cierre', key: 'date', width: 15 },
      { header: 'Estatus', key: 'status', width: 15 },
      { header: 'Tareas Comp.', key: 'tareas', width: 15 },
      { header: 'Progreso', key: 'progreso', width: 15 },
      { header: 'Comentarios del Empleado', key: 'notas', width: 60 }
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 25;

    this.resultados().forEach(c => {
      worksheet.addRow({
        name: c.name, store: c.store, assigned: c.assigned, date: c.date,
        status: this.getDisplayStatus(c).toUpperCase(),
        tareas: `${this.getCompletados(c)} de ${c.items?.length || 0}`,
        progreso: `${this.getProgreso(c)}%`,
        notas: c.notaEmpleado || 'Sin comentarios'
      });
    });

    worksheet.eachRow((row, rowNumber) => {
      row.eachCell((cell, colNumber) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFCBD5E1' } }, left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } }, right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };
        if (rowNumber > 1) {
          if (colNumber >= 4 && colNumber <= 7) { cell.alignment = { vertical: 'middle', horizontal: 'center' }; }
          else { cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true }; }
        }
      });
    });

    try {
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // 🆕 Incluir sucursal en el nombre del archivo si está filtrado
      const sufijoSucursal = this.sucursalSeleccionada ? `_${this.sucursalSeleccionada.replace(/\s+/g, '_')}` : '';
      a.download = `Reporte_MegaDulces${sufijoSucursal}_${this.fechaInicio}_al_${this.fechaFin}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); window.URL.revokeObjectURL(url);
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Error de Exportación', text: 'Hubo un error al generar el archivo Excel.', confirmButtonColor: '#0F172A' });
    }
  }

  async descargarReportePDF() {
    if (this.resultados().length === 0) {
      Swal.fire({ icon: 'info', title: 'Sin Datos', text: 'No hay datos para generar el PDF.', confirmButtonColor: '#0F172A' });
      return;
    }

    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    const doc = new jsPDF({ orientation: 'landscape', format: 'a4' });

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, doc.internal.pageSize.getWidth(), 25, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(255, 255, 255);
    doc.text('MEGA DULCES', 14, 16);

    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(200, 200, 200);
    doc.text('Panel Enterprise • Reporte de Auditoría Operativa', 75, 16);

    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(30, 41, 59);
    doc.text('Detalles de la Consulta', 14, 36);

    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100, 116, 139);
    doc.text(`Periodo analizado: ${this.fechaInicio} al ${this.fechaFin}`, 14, 42);
    doc.text(`Filtro de usuario: ${this.empleadoSeleccionado || 'Todos los colaboradores'}`, 14, 47);
    // 🆕 Mostrar filtro de sucursal en el PDF
    doc.text(`Filtro de sucursal: ${this.sucursalSeleccionada || 'Todas las sucursales'}`, 14, 52);
    doc.text(`Fecha de emisión: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, 14, 57);
    doc.text(`Total de registros: ${this.resultados().length}`, 14, 62);

    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.5); doc.line(14, 67, doc.internal.pageSize.getWidth() - 14, 67);

    const bodyData = this.resultados().map(c => {
      const tareasCumplidas = c.items ? c.items.filter((i: any) => i.checked) : [];
      let detalle = '';

      if (tareasCumplidas.length === 0) { detalle = 'Sin tareas completadas.'; }
      else {
        detalle = tareasCumplidas.map((t: any) => {
          let texto = `• ${t.text}`;
          if (t.requiresPhoto && (!t.photo || t.photo === '')) { texto += ' (Falta Evidencia)'; }
          if (t.requiresAntesDespues && (!t.photoAntes || !t.photoDespues)) { texto += ' (Falta Evid. Antes/Después)'; }
          return texto;
        }).join('\n');
      }

      if (c.notaEmpleado) {
        detalle += `\n\nNOTA DEL COLABORADOR:\n${c.notaEmpleado}`;
      }

      const marcados = c.items ? c.items.filter((i: any) => i.checked).length : 0;
      const total = c.items ? c.items.length : 0;
      const progreso = total > 0 ? Math.round((marcados / total) * 100) : 0;

      return [
        c.date || '-', (c.name || '-').toUpperCase(), c.store || '-', c.assigned || '-',
        `${progreso}%`, this.getDisplayStatus(c).toUpperCase(), detalle
      ];
    });

    autoTable(doc, {
      startY: 73,
      head: [['Fecha', 'Operación', 'Sucursal', 'Responsable', 'Avance', 'Estado', 'Resumen de Tareas y Notas']],
      body: bodyData, theme: 'plain',
      headStyles: { fillColor: [248, 250, 252], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 9, cellPadding: 5, lineColor: [226, 232, 240], lineWidth: { bottom: 1 } },
      bodyStyles: { textColor: [51, 65, 85], fontSize: 8, cellPadding: 4, lineColor: [226, 232, 240], lineWidth: { bottom: 0.5 } },
      alternateRowStyles: { fillColor: [255, 255, 255] },
      columnStyles: {
        0: { cellWidth: 22 }, 1: { cellWidth: 40, fontStyle: 'bold', textColor: [15, 23, 42] }, 2: { cellWidth: 25 }, 3: { cellWidth: 35 }, 4: { cellWidth: 18, halign: 'center', fontStyle: 'bold' }, 5: { cellWidth: 25 }, 6: { cellWidth: 100 }
      },
      didParseCell: function (data) {
        if (data.section === 'body' && data.column.index === 5) {
          const estado = data.cell.raw as string;
          if (estado.includes('COMPLETO')) { data.cell.styles.textColor = [21, 128, 61]; data.cell.styles.fontStyle = 'bold'; }
          else if (estado.includes('PROGRESO')) { data.cell.styles.textColor = [29, 78, 216]; }
          else if (estado.includes('VENCIDO')) { data.cell.styles.textColor = [220, 38, 38]; data.cell.styles.fontStyle = 'bold'; }
        }
      }
    });

    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(148, 163, 184);
      doc.text(`Mega Dulces App - Documento Confidencial | Página ${i} de ${pageCount}`, doc.internal.pageSize.getWidth() / 2, doc.internal.pageSize.getHeight() - 10, { align: 'center' });
    }
    // 🆕 Incluir sucursal en el nombre del archivo si está filtrado
    const sufijoSucursal = this.sucursalSeleccionada ? `_${this.sucursalSeleccionada.replace(/\s+/g, '_')}` : '';
    doc.save(`Reporte_MegaDulces${sufijoSucursal}_${this.fechaInicio}_al_${this.fechaFin}.pdf`);
  }

  // =======================================================================
  //  🔥  GENERACIÓN DE PDF VISUAL (1 TAREA POR HOJA)
  // =======================================================================
  async descargarPDFVisual() {

    const cleanText = (str: string): string => {
      if (!str) return '';
      return str
        .replace(/[^\x00-\x7F]/g, (char) => {
          const map: Record<string, string> = {
            'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u',
            'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U',
            'ñ': 'ñ', 'Ñ': 'Ñ', 'ü': 'u', 'Ü': 'U',
            '📌': '', '⚠️': '', '📸': '', '🕒': '', '📝': '',
            '➔': '->'
          };
          return map[char] || '';
        });
    };
    if (this.resultados().length === 0) {
      Swal.fire({ icon: 'info', title: 'Sin Datos', text: 'No hay datos para generar el reporte visual.', confirmButtonColor: '#0F172A' });
      return;
    }

    if (this.resultados().length > 30) {
      const result = await Swal.fire({
        title: 'Reporte Pesado',
        text: 'Estás generando un reporte visual muy grande. Esto descargará muchas fotos y tomará algo de tiempo. ¿Deseas continuar?',
        icon: 'warning',
        showCancelButton: true, confirmButtonColor: '#0F172A', cancelButtonColor: '#64748B', confirmButtonText: 'Sí, generar PDF', cancelButtonText: 'Cancelar'
      });
      if (!result.isConfirmed) return;
    }

    this.generandoReporte.set(true);

    try {
      const { default: jsPDF } = await import('jspdf');
      await import('jspdf-autotable');
      const doc = new jsPDF('p', 'mm', 'a4');
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const M = 18;

      // Paleta corporativa Mega Dulces — Burdeos + rosáceo premium
      const C = {
        navy:  [131, 24, 67]  as [number, number, number],  // #831843 burdeos principal
        accent:[190, 24, 93]  as [number, number, number],  // #BE185D rosa antiguo
        ink:   [76, 5, 43]    as [number, number, number],  // burdeos muy oscuro
        gray:  [136, 86, 110] as [number, number, number],  // rosa-gris
        soft:  [180, 144, 162] as [number, number, number], // rosa-gris claro
        line:  [243, 218, 228] as [number, number, number], // rosa muy claro
        bg:    [253, 242, 248] as [number, number, number], // crema rosada
        gold:  [217, 119, 6]  as [number, number, number],  // dorado para acentos
        ok:    [16, 185, 129] as [number, number, number],
        warn:  [245, 158, 11] as [number, number, number],
        bad:   [239, 68, 68]  as [number, number, number]
      };

      const getBase64Image = (url: string): Promise<string | null> => {
        return new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = 'Anonymous';
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 800;
            const scaleSize = MAX_WIDTH / img.width;
            canvas.width = MAX_WIDTH;
            canvas.height = img.height * scaleSize;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.75));
          };
          img.onerror = () => resolve(null);
          img.src = url;
        });
      };

      const fitImage = (props: { width: number; height: number }, maxW: number, maxH: number) => {
        const r = props.width / props.height;
        if (r > maxW / maxH) return { w: maxW, h: maxW / r };
        return { w: maxH * r, h: maxH };
      };

      const resultados = this.resultados();
      const totalProgresos = resultados.reduce((sum, r) => sum + this.getProgreso(r), 0);
      const promedio = resultados.length > 0 ? Math.round(totalProgresos / resultados.length) : 0;
      const totalConFotos = resultados.reduce((sum, r) =>
        sum + (r.items || []).reduce((s: number, i: any) =>
          s + (i.photo ? 1 : 0) + (i.photoAntes ? 1 : 0) + (i.photoDespues ? 1 : 0) +
              (Array.isArray(i.photos) ? i.photos.length : 0), 0), 0);

      // Buscar primera foto para usarla en portada
      let fotoPortada: string | null = null;
      for (const r of resultados) {
        for (const it of (r.items || [])) {
          const candidatos = [it.photo, it.photoAntes, it.photoDespues].filter(Boolean);
          if (Array.isArray(it.photos)) for (const p of it.photos) candidatos.push(p?.url || p);
          for (const url of candidatos) {
            if (url && url !== 'subiendo...') {
              fotoPortada = await getBase64Image(url);
              if (fotoPortada) break;
            }
          }
          if (fotoPortada) break;
        }
        if (fotoPortada) break;
      }

      // =====================================================================
      // PÁGINA 1 — PORTADA EDITORIAL
      // Foto grande arriba (60%) + bloque blanco abajo con título magazine.
      // =====================================================================
      const fotoH = pageH * 0.60;
      if (fotoPortada) {
        try {
          doc.addImage(fotoPortada, 'JPEG', 0, 0, pageW, fotoH);
          doc.setFillColor(15, 23, 42);
          doc.setGState(new (doc as any).GState({ opacity: 0.10 }));
          doc.rect(0, 0, pageW, fotoH, 'F');
          doc.setGState(new (doc as any).GState({ opacity: 1 }));
        } catch { /* fallback navy abajo */ }
      } else {
        doc.setFillColor(...C.navy);
        doc.rect(0, 0, pageW, fotoH, 'F');
      }

      // Bloque crema rosado inferior
      doc.setFillColor(...C.bg);
      doc.rect(0, fotoH, pageW, pageH - fotoH, 'F');

      // Ornamento dorado: línea + punto + línea
      const ornY = fotoH + 14;
      doc.setDrawColor(...C.gold); doc.setLineWidth(0.4);
      doc.line(M, ornY, M + 20, ornY);
      doc.setFillColor(...C.gold);
      doc.circle(M + 24, ornY, 0.8, 'F');
      doc.line(M + 28, ornY, M + 48, ornY);

      // Kicker (rosa antiguo, bold)
      const titY = fotoH + 26;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...C.accent);
      doc.text('MEGA DULCES DE LOS ALTOS', M, titY, { charSpace: 1.4 });

      // Título a dos líneas: AUDITORIA (burdeos bold) / VISUAL (rosa antiguo light)
      doc.setTextColor(...C.navy);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(42);
      doc.text('AUDITORIA', M, titY + 18, { charSpace: 0.5 });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(42); doc.setTextColor(...C.accent);
      doc.text('VISUAL', M, titY + 35, { charSpace: 0.5 });
      // Subrayado dorado decorativo doble
      doc.setDrawColor(...C.gold); doc.setLineWidth(1.2);
      doc.line(M, titY + 40, M + 36, titY + 40);
      doc.setLineWidth(0.4);
      doc.line(M, titY + 42, M + 18, titY + 42);

      // Pie
      const periodo = `${this.fechaInicio} al ${this.fechaFin}`;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.gray);
      doc.text(periodo.toUpperCase() + '  //  PREPARADO POR ' +
               (this.currentUser?.nombre || 'Administracion').toUpperCase(),
               M, titY + 54, { charSpace: 1 });

      // Watermark "MD" en esquina inferior derecha
      doc.setFont('helvetica', 'bold'); doc.setFontSize(48); doc.setTextColor(...C.line);
      doc.text('MD', pageW - M - 16, pageH - M, { align: 'right' });

      // =====================================================================
      // PÁGINA 2 — DESCRIPCIÓN (kicker + título + párrafo + KPIs)
      // =====================================================================
      doc.addPage();

      // Ornamento dorado lateral
      doc.setDrawColor(...C.gold); doc.setLineWidth(0.4);
      doc.line(M, 36, M + 14, 36);
      doc.setFillColor(...C.gold);
      doc.circle(M + 18, 36, 0.8, 'F');

      // Kicker
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...C.accent);
      doc.text('SECCIÓN 01', M, 44, { charSpace: 1.5 });

      // Título grande
      doc.setFont('helvetica', 'bold'); doc.setFontSize(34); doc.setTextColor(...C.navy);
      doc.text('Descripción', M, 64);
      doc.setDrawColor(...C.gold); doc.setLineWidth(1);
      doc.line(M, 68, M + 30, 68);

      // Párrafo descriptivo con drop cap
      const empleadoFiltro = this.empleadoSeleccionado || 'todos los colaboradores';
      const sucFiltro = this.sucursalSeleccionada || 'todas las sucursales';
      const desc = `Reporte de auditoría visual para el periodo del ${this.fechaInicio} al ${this.fechaFin}. Se analizaron ${resultados.length} checklists de ${sucFiltro} asignados a ${empleadoFiltro}, con un cumplimiento general del ${promedio}% y ${totalConFotos} evidencias fotográficas documentadas.`;

      // Drop cap: primera letra en burdeos grande
      const primeraLetra = desc.charAt(0);
      const restoTexto = desc.slice(1);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(46); doc.setTextColor(...C.navy);
      doc.text(primeraLetra, M, 92);

      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...C.ink);
      const dropCapWidth = 12;
      const dropCapLines = 3;
      const restoLineasCortas = doc.splitTextToSize(restoTexto, pageW - M * 2 - dropCapWidth - 2);
      const primerasLineas = restoLineasCortas.slice(0, dropCapLines);
      doc.text(primerasLineas, M + dropCapWidth + 2, 78, { lineHeightFactor: 1.45 });
      let yPar = 78 + primerasLineas.length * 5;
      if (restoLineasCortas.length > dropCapLines) {
        const textoResto = restoLineasCortas.slice(dropCapLines).join(' ');
        const restoFull = doc.splitTextToSize(textoResto, pageW - M * 2);
        doc.text(restoFull, M, yPar, { lineHeightFactor: 1.45 });
        yPar += restoFull.length * 5;
      }

      let yKpi = yPar + 14;
      doc.setDrawColor(...C.line); doc.setLineWidth(0.2);
      doc.line(M, yKpi, pageW - M, yKpi);
      yKpi += 12;

      const kpiW = (pageW - M * 2 - 12) / 2;
      const kpiH = 32;
      const kpis = [
        { num: `${promedio}%`,         label: 'Cumplimiento general', kicker: '01',
          color: promedio >= 80 ? C.ok : (promedio >= 50 ? C.warn : C.bad) },
        { num: resultados.length.toString(), label: 'Checklists analizados', kicker: '02', color: C.navy },
        { num: totalConFotos.toString(),     label: 'Evidencias fotograficas', kicker: '03', color: C.navy },
        { num: this.fechaInicio + '/' + this.fechaFin, label: 'Periodo analizado', kicker: '04', color: C.navy, smallNum: true }
      ];
      for (let i = 0; i < kpis.length; i++) {
        const k = kpis[i];
        const x = M + (i % 2) * (kpiW + 12);
        const y = yKpi + Math.floor(i / 2) * (kpiH + 6);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.soft);
        doc.text(k.kicker, x, y + 4, { charSpace: 1 });
        doc.setTextColor(...k.color);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(k.smallNum ? 14 : 32);
        doc.text(k.num, x, y + (k.smallNum ? 16 : 18));
        doc.setDrawColor(...C.line); doc.setLineWidth(0.2);
        doc.line(x, y + 22, x + kpiW, y + 22);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...C.gray);
        doc.text(k.label, x, y + 28);
      }

      // =====================================================================
      // POR CADA CHECKLIST — portadilla editorial + páginas de items
      // =====================================================================
      let secNum = 2;
      for (let idx = 0; idx < resultados.length; idx++) {
        const checklist = resultados[idx];
        const progreso = this.getProgreso(checklist);
        const items = checklist.items || [];

        // ----- PORTADILLA DEL CHECKLIST -----
        doc.addPage();
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...C.gray);
        doc.text(`SECCIÓN ${String(secNum).padStart(2, '0')}  //  CHECKLIST ${idx + 1} DE ${resultados.length}`, M, 40, { charSpace: 1.5 });
        secNum++;

        // Nombre del checklist (título grande). Si excede 2 líneas, trunca con "..."
        doc.setFont('helvetica', 'bold'); doc.setFontSize(28); doc.setTextColor(...C.navy);
        let nameLines = doc.splitTextToSize(cleanText(checklist.name), pageW - M * 2 - 50);
        if (nameLines.length > 2) {
          const dos = nameLines.slice(0, 2);
          dos[1] = dos[1].replace(/\s+\S*$/, '') + '...';
          nameLines = dos;
        }
        doc.text(nameLines, M, 56);
        doc.setDrawColor(...C.gold); doc.setLineWidth(1);
        const subY = 58 + nameLines.length * 11;
        doc.line(M, subY, M + 30, subY);

        // Porcentaje pull-quote a la derecha — su Y se ajusta según las líneas del título
        const pctY = nameLines.length === 1 ? 70 : 82;
        const pctColor = progreso === 100 ? C.ok : (progreso >= 50 ? C.warn : C.bad);
        doc.setTextColor(...pctColor); doc.setFont('helvetica', 'bold'); doc.setFontSize(48);
        doc.text(`${progreso}%`, pageW - M, pctY, { align: 'right' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.gray);
        doc.text('AVANCE GLOBAL', pageW - M, pctY + 6, { align: 'right', charSpace: 1.2 });

        // Datos en formato editorial (clave: valor, una por línea)
        let yDatos = 58 + nameLines.length * 11 + 18;
        const datos = [
          { k: 'Responsable',  v: cleanText(checklist.assigned) || 'No asignado' },
          { k: 'Sucursal',     v: checklist.store || 'General' },
          { k: 'Fecha',        v: checklist.date || '—' },
          { k: 'Estado',       v: this.getDisplayStatusLabel(checklist) }
        ];
        for (const d of datos) {
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.gray);
          doc.text(d.k.toUpperCase(), M, yDatos, { charSpace: 1.2 });
          doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...C.ink);
          // Split en multilínea por si el valor es largo (responsable con apellido largo o sucursal compleja)
          const valorLines = doc.splitTextToSize(d.v, pageW - M * 2);
          doc.text(valorLines, M, yDatos + 7);
          const extraH = (valorLines.length - 1) * 5;
          doc.setDrawColor(...C.line); doc.setLineWidth(0.2);
          doc.line(M, yDatos + 10 + extraH, pageW - M, yDatos + 10 + extraH);
          yDatos += 16 + extraH;
        }

        // Comentario del colaborador (si existe) — bloque ámbar
        if (checklist.notaEmpleado) {
          yDatos += 4;
          const notas = doc.splitTextToSize(cleanText(checklist.notaEmpleado), pageW - M * 2 - 6);
          const h = notas.length * 5 + 14;
          doc.setFillColor(255, 251, 235);
          doc.setDrawColor(245, 158, 11); doc.setLineWidth(0.3);
          doc.roundedRect(M, yDatos, pageW - M * 2, h, 1, 1, 'FD');
          doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(180, 83, 9);
          doc.text('COMENTARIO DEL COLABORADOR', M + 3, yDatos + 5, { charSpace: 1.2 });
          doc.setFont('helvetica', 'italic'); doc.setFontSize(10); doc.setTextColor(146, 64, 14);
          doc.text(notas, M + 3, yDatos + 10);
          yDatos += h + 4;
        }

        // ----- ITEMS CON FOTO (estilo editorial limpio) -----
        for (let j = 0; j < items.length; j++) {
          const item = items[j];
          const tieneFoto = item.photo || item.photoAntes || item.photoDespues ||
                            (Array.isArray(item.photos) && item.photos.length > 0);

          // Para items con foto: nueva página
          // Para items sin foto: agrupamos varios en una sola página
          if (tieneFoto) {
            doc.addPage();
            // Kicker (con nombre truncado si es muy largo para que "TAREA X / Y" siempre se vea)
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.gray);
            const nombreCorto = cleanText(checklist.name).toUpperCase();
            const nombreTrunc = nombreCorto.length > 48 ? nombreCorto.slice(0, 45) + '...' : nombreCorto;
            doc.text(`${nombreTrunc}  ·  TAREA ${j + 1} / ${items.length}`,
                     M, 22, { charSpace: 1.2 });
            // Línea fina
            doc.setDrawColor(...C.line); doc.line(M, 26, pageW - M, 26);

            // Texto de la tarea (título)
            doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...C.navy);
            const txt = doc.splitTextToSize(cleanText(item.text || '(sin descripción)'), pageW - M * 2 - 40);
            doc.text(txt, M, 38);

            // Badge de estado a la derecha
            const hechoBadge = item.checked || (item.photo && item.photo !== 'subiendo...') ||
                              (item.photoAntes && item.photoDespues);
            const bColor = hechoBadge ? C.ok : C.bad;
            doc.setFillColor(...bColor);
            const bTxt = hechoBadge ? 'HECHO' : 'FALTA EVIDENCIA';
            const bw = doc.getStringUnitWidth(bTxt) * 7 / doc.internal.scaleFactor + 6;
            doc.roundedRect(pageW - M - bw, 32, bw, 8, 1.5, 1.5, 'F');
            doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(255, 255, 255);
            doc.text(bTxt, pageW - M - bw / 2, 37.5, { align: 'center' });

            let yFoto = 38 + txt.length * 7 + 8;

            // Renderizado de fotos
            if (item.requiresAntesDespues) {
              // ANTES y DESPUÉS lado a lado
              const halfW = (pageW - M * 2 - 8) / 2;
              const maxH = pageH - yFoto - 25;

              const imgA = item.photoAntes ? await getBase64Image(item.photoAntes) : null;
              const imgD = item.photoDespues ? await getBase64Image(item.photoDespues) : null;

              // ANTES
              doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...C.gray);
              doc.text(`ANTES${item.photoAntesTime ? '  ·  ' + item.photoAntesTime : ''}`,
                       M, yFoto, { charSpace: 1.2 });
              if (imgA) {
                const p = doc.getImageProperties(imgA);
                const fit = fitImage(p, halfW, maxH);
                doc.setDrawColor(...C.line); doc.setLineWidth(0.3);
                doc.rect(M, yFoto + 3, fit.w, fit.h);
                doc.addImage(imgA, 'JPEG', M, yFoto + 3, fit.w, fit.h);
              } else {
                doc.setFillColor(...C.bg);
                doc.rect(M, yFoto + 3, halfW, maxH * 0.6, 'F');
                doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...C.soft);
                doc.text('Sin imagen de antes', M + halfW / 2, yFoto + 3 + maxH * 0.3, { align: 'center' });
              }

              // DESPUÉS
              const xD = M + halfW + 8;
              doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...C.gray);
              doc.text(`DESPUÉS${item.photoDespuesTime ? '  ·  ' + item.photoDespuesTime : ''}`,
                       xD, yFoto, { charSpace: 1.2 });
              if (imgD) {
                const p = doc.getImageProperties(imgD);
                const fit = fitImage(p, halfW, maxH);
                doc.setDrawColor(...C.line); doc.setLineWidth(0.3);
                doc.rect(xD, yFoto + 3, fit.w, fit.h);
                doc.addImage(imgD, 'JPEG', xD, yFoto + 3, fit.w, fit.h);
              } else {
                doc.setFillColor(...C.bg);
                doc.rect(xD, yFoto + 3, halfW, maxH * 0.6, 'F');
                doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...C.soft);
                doc.text('Sin imagen de después', xD + halfW / 2, yFoto + 3 + maxH * 0.3, { align: 'center' });
              }
            } else if (Array.isArray(item.photos) && item.photos.length > 0) {
              // Galería de varias fotos en grid 2 columnas
              doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...C.gray);
              doc.text(`${item.photos.length} FOTOGRAFIAS`, M, yFoto, { charSpace: 1.2 });
              const halfW = (pageW - M * 2 - 6) / 2;
              const maxH = (pageH - yFoto - 25) / Math.ceil(item.photos.length / 2);
              let fx = M; let fy = yFoto + 3;
              for (let k = 0; k < item.photos.length; k++) {
                const url = (item.photos[k] && item.photos[k].url) ? item.photos[k].url : item.photos[k];
                const data = await getBase64Image(url);
                if (data) {
                  doc.setDrawColor(...C.line); doc.setLineWidth(0.3);
                  doc.rect(fx, fy, halfW, maxH - 4);
                  try {
                    const p = doc.getImageProperties(data);
                    const fit = fitImage(p, halfW, maxH - 4);
                    doc.addImage(data, 'JPEG', fx, fy, fit.w, fit.h);
                  } catch { /* ignora */ }
                }
                if (k % 2 === 0) { fx = M + halfW + 6; }
                else { fx = M; fy += maxH; }
              }
            } else if (item.photo) {
              // Foto única grande
              doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...C.gray);
              doc.text(`EVIDENCIA FOTOGRAFICA${item.photoTime ? '  ·  ' + item.photoTime : ''}`,
                       M, yFoto, { charSpace: 1.2 });
              const img = await getBase64Image(item.photo);
              if (img) {
                const p = doc.getImageProperties(img);
                const fit = fitImage(p, pageW - M * 2, pageH - yFoto - 25);
                const xC = M + ((pageW - M * 2) - fit.w) / 2;
                doc.setDrawColor(...C.line); doc.setLineWidth(0.3);
                doc.rect(xC, yFoto + 3, fit.w, fit.h);
                doc.addImage(img, 'JPEG', xC, yFoto + 3, fit.w, fit.h);
              }
            }
          }
        }

        // ----- LISTA DE ITEMS SIN FOTO (todos juntos al final) -----
        const sinFoto = items.filter((it: any) =>
          !it.photo && !it.photoAntes && !it.photoDespues &&
          !(Array.isArray(it.photos) && it.photos.length > 0));
        if (sinFoto.length > 0) {
          // Helper de truncado para los kickers de esta sección
          const nombreUpper = cleanText(checklist.name).toUpperCase();
          const kickerNombre = nombreUpper.length > 52 ? nombreUpper.slice(0, 49) + '...' : nombreUpper;

          doc.addPage();
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.gray);
          doc.text(`${kickerNombre}  ·  TAREAS SIN FOTO`,
                   M, 22, { charSpace: 1.2 });
          doc.setDrawColor(...C.line); doc.line(M, 26, pageW - M, 26);

          doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(...C.navy);
          doc.text('Tareas sin evidencia', M, 42);
          doc.setDrawColor(...C.navy); doc.setLineWidth(0.5);
          doc.line(M, 46, M + 22, 46);

          let yS = 58;
          for (let k = 0; k < sinFoto.length; k++) {
            const it = sinFoto[k];
            if (yS > pageH - 20) {
              doc.addPage();
              doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.gray);
              doc.text(`${kickerNombre}  ·  TAREAS SIN FOTO`,
                       M, 22, { charSpace: 1.2 });
              doc.setDrawColor(...C.line); doc.line(M, 26, pageW - M, 26);
              yS = 38;
            }
            const c = it.checked ? C.ok : C.soft;
            doc.setFillColor(...c); doc.circle(M + 2, yS + 3, 1.5, 'F');
            doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(...C.ink);
            const tx = doc.splitTextToSize(cleanText(it.text || '(sin descripción)'), pageW - M * 2 - 35);
            doc.text(tx, M + 8, yS + 4);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...c);
            doc.text(it.checked ? 'HECHO' : 'PENDIENTE', pageW - M, yS + 4, { align: 'right' });
            yS += Math.max(8, tx.length * 5 + 3);
            doc.setDrawColor(...C.line); doc.setLineWidth(0.1);
            doc.line(M + 8, yS, pageW - M, yS);
            yS += 3;
          }
        }
      }

      // FOOTER consistente
      const totalPag = doc.getNumberOfPages();
      for (let i = 2; i <= totalPag; i++) {
        doc.setPage(i);
        doc.setDrawColor(...C.line); doc.setLineWidth(0.2);
        doc.line(M, pageH - 12, pageW - M, pageH - 12);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.soft);
        doc.text(`MEGA DULCES  ·  Auditoría Visual  ·  ${this.fechaInicio} al ${this.fechaFin}`, M, pageH - 7);
        doc.text(`${i} / ${totalPag}`, pageW - M, pageH - 7, { align: 'right' });
      }

      const sufijoSucursal = this.sucursalSeleccionada ? `_${this.sucursalSeleccionada.replace(/\s+/g, '_')}` : '';
      doc.save(`Auditoria_Visual${sufijoSucursal}_${this.fechaInicio}_al_${this.fechaFin}.pdf`);
    } catch (error) {
      console.error(error);
      Swal.fire({ icon: 'error', title: 'Error de Procesamiento', text: 'Ocurrió un error al generar el PDF.', confirmButtonColor: '#0F172A' });
    } finally {
      this.generandoReporte.set(false);
    }
  }
}