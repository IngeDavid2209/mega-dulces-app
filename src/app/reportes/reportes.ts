import { Component, signal, OnInit, OnDestroy, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Firestore, collection, getDocs, getDoc, doc, deleteDoc, setDoc, query, where } from '@angular/fire/firestore';
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
      const checklistsRef = collection(this.firestore, 'checklists');
      const q = query(
        checklistsRef,
        where('date', '>=', this.fechaInicio),
        where('date', '<=', this.fechaFin)
      );
      const snapshot = await getDocs(q);

      const listasSinClones = new Map();

      snapshot.forEach(docSnap => {
        const c = docSnap.data() as any;
        if (c.eliminado === true) return;

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
        for (const checklist of this.resultados()) {
          const docId = checklist.id.toString();
          await deleteDoc(doc(this.firestore, 'checklists', docId));
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
      const { default: autoTable } = await import('jspdf-autotable');
      const doc = new jsPDF('p', 'mm', 'a4');
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      const getBase64Image = (url: string): Promise<string | null> => {
        return new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = 'Anonymous';
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 600;
            const scaleSize = MAX_WIDTH / img.width;
            canvas.width = MAX_WIDTH;
            canvas.height = img.height * scaleSize;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.7));
          };
          img.onerror = () => resolve(null);
          img.src = url;
        });
      };

      const calculateFit = (imgW: number, imgH: number, maxW: number, maxH: number) => {
        const imgRatio = imgW / imgH;
        const maxRatio = maxW / maxH;
        let finalW, finalH;
        if (imgRatio > maxRatio) {
          finalW = maxW;
          finalH = finalW / imgRatio;
        } else {
          finalH = maxH;
          finalW = finalH * imgRatio;
        }
        return { finalW, finalH };
      };

      // PORTADA
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageWidth, 28, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.setTextColor(255, 255, 255);
      doc.text('MEGA DULCES', 14, 15);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(200, 200, 200);
      doc.text('REPORTE DE AUDITORÍA VISUAL', 14, 22);

      const totalProgresos = this.resultados().reduce((sum, r) => sum + this.getProgreso(r), 0);
      const promedio = this.resultados().length > 0 ? Math.round(totalProgresos / this.resultados().length) : 0;

      autoTable(doc, {
        startY: 35,
        head: [['Resumen Ejecutivo', '']],
        body: [
          ['Período analizado', `${this.fechaInicio} al ${this.fechaFin}`],
          ['Filtro de empleado', this.empleadoSeleccionado || 'Todos los colaboradores'],
          // 🆕 Mostrar filtro de sucursal en la portada
          ['Filtro de sucursal', this.sucursalSeleccionada || 'Todas las sucursales'],
          ['Total de registros', `${this.resultados().length} checklists validados`],
          ['Cumplimiento general', `${promedio}% de efectividad`]
        ],
        theme: 'grid',
        headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 14, cellPadding: 8 },
        bodyStyles: { textColor: [51, 65, 85], fontSize: 12, cellPadding: 8 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 80 } }
      });

      // RECORRIDO DE CHECKLISTS
      for (let i = 0; i < this.resultados().length; i++) {
        const checklist = this.resultados()[i];

        doc.addPage();
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, pageWidth, 25, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text(`AUDITORIA: ${cleanText(checklist.name).toUpperCase()}`, 14, 16);

        doc.setTextColor(15, 23, 42);
        doc.setFontSize(14);
        doc.text('DATOS DE LA EVALUACIÓN', 14, 40);

        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.5);
        doc.line(14, 44, pageWidth - 14, 44);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text('Responsable:', 14, 55);
        doc.setFont('helvetica', 'normal');
        doc.text(cleanText(checklist.assigned) || 'No asignado', 50, 55);

        doc.setFont('helvetica', 'bold');
        doc.text('Sucursal/Zona:', 14, 65);
        doc.setFont('helvetica', 'normal');
        doc.text(checklist.store || 'General', 50, 65);

        doc.setFont('helvetica', 'bold');
        doc.text('Fecha:', 14, 75);
        doc.setFont('helvetica', 'normal');
        doc.text(checklist.date || '--', 50, 75);

        const progreso = this.getProgreso(checklist);
        doc.setFont('helvetica', 'bold');
        doc.text('Avance Global:', 14, 85);
        doc.setTextColor(progreso === 100 ? 16 : 29, progreso === 100 ? 185 : 78, progreso === 100 ? 129 : 216);
        doc.text(`${progreso}% COMPLETADO`, 50, 85);

        if (checklist.notaEmpleado) {
          doc.setTextColor(217, 119, 6);
          doc.text('COMENTARIOS DEL COLABORADOR:', 14, 105);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(51, 65, 85);
          const notes = doc.splitTextToSize(checklist.notaEmpleado, pageWidth - 28);
          doc.text(notes, 14, 113);
        }

        if (checklist.items && checklist.items.length > 0) {
          for (let j = 0; j < checklist.items.length; j++) {
            const item = checklist.items[j];

            doc.addPage();

            doc.setFillColor(241, 245, 249);
            doc.rect(0, 0, pageWidth, 20, 'F');
            doc.setTextColor(100, 116, 139);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.text(`${checklist.name.toUpperCase()}  |  TAREA ${j + 1} DE ${checklist.items.length}`, 14, 13);

            doc.setTextColor(15, 23, 42);
            doc.setFontSize(14);
            const checkIcon = item.checked ? '[ ✓ ] ' : '[ X ] ';
            const taskText = doc.splitTextToSize(checkIcon + item.text, pageWidth - 28);
            doc.text(taskText, 14, 35);

            let currentY = 35 + (taskText.length * 7) + 5;

            doc.setFontSize(10);
            if (!item.checked) {
              doc.setTextColor(220, 38, 38);
              doc.text('TAREA NO COMPLETADA', 14, currentY);
              currentY += 12;
            } else if (item.requiresPhoto && !item.photo && !item.requiresAntesDespues) {
              doc.setTextColor(220, 38, 38);
              doc.text('TAREA COMPLETADA SIN EVIDENCIA FOTOGRÁFICA', 14, currentY);
              currentY += 12;
            } else if (item.requiresAntesDespues && (!item.photoAntes || !item.photoDespues)) {
              doc.setTextColor(220, 38, 38);
              doc.text('FALTAN EVIDENCIAS DE ANTES Y/O DESPUES', 14, currentY);
              currentY += 12;
            }

            const availableHeight = pageHeight - currentY - 20;

            if (item.requiresAntesDespues) {
              const photoWidth = (pageWidth - 42) / 2;
              const maxPhotoHeight = availableHeight - 15;

              let imgAntes = item.photoAntes ? await getBase64Image(item.photoAntes) : null;
              let imgDespues = item.photoDespues ? await getBase64Image(item.photoDespues) : null;

              doc.setTextColor(15, 23, 42);
              doc.setFont('helvetica', 'bold');
              doc.text(`EVIDENCIA: ANTES ${item.photoAntesTime ? '(' + item.photoAntesTime + ')' : ''}`, 14, currentY + 5);
              if (imgAntes) {
                const imgProps = doc.getImageProperties(imgAntes);
                const { finalW, finalH } = calculateFit(imgProps.width, imgProps.height, photoWidth, maxPhotoHeight);
                const x = 14 + (photoWidth - finalW) / 2;
                doc.addImage(imgAntes, 'JPEG', x, currentY + 10, finalW, finalH);
              } else {
                doc.setTextColor(220, 38, 38);
                doc.setFont('helvetica', 'normal');
                doc.text('Sin imagen de "Antes"', 14, currentY + 15);
              }

              doc.setTextColor(16, 185, 129);
              doc.setFont('helvetica', 'bold');
              doc.text(`EVIDENCIA: DESPUÉS ${item.photoDespuesTime ? '(' + item.photoDespuesTime + ')' : ''}`, 14 + photoWidth + 14, currentY + 5);
              if (imgDespues) {
                const imgProps = doc.getImageProperties(imgDespues);
                const { finalW, finalH } = calculateFit(imgProps.width, imgProps.height, photoWidth, maxPhotoHeight);
                const x = 14 + photoWidth + 14 + (photoWidth - finalW) / 2;
                doc.addImage(imgDespues, 'JPEG', x, currentY + 10, finalW, finalH);
              } else {
                doc.setTextColor(220, 38, 38);
                doc.setFont('helvetica', 'normal');
                doc.text('Sin imagen de "Después"', 14 + photoWidth + 14, currentY + 15);
              }

            } else if (item.requiresPhoto || item.photo) {
              const photoWidth = pageWidth - 28;
              const maxPhotoHeight = availableHeight - 15;

              let img = item.photo ? await getBase64Image(item.photo) : null;
              if (img) {
                doc.setTextColor(15, 23, 42);
                doc.setFont('helvetica', 'bold');
                doc.text(`EVIDENCIA FOTOGRÁFICA ${item.photoTime ? '(' + item.photoTime + ')' : ''}`, 14, currentY + 5);

                const imgProps = doc.getImageProperties(img);
                const { finalW, finalH } = calculateFit(imgProps.width, imgProps.height, photoWidth, maxPhotoHeight);
                const x = 14 + (photoWidth - finalW) / 2;
                doc.addImage(img, 'JPEG', x, currentY + 10, finalW, finalH);
              }
            }
          }
        }
      }

      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(`Mega Dulces App - Página ${i} de ${pageCount}`, pageWidth / 2, pageHeight - 8, { align: 'center' });
      }

      // 🆕 Incluir sucursal en el nombre del archivo si está filtrado
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