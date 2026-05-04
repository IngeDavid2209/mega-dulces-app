import { Component, signal, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Firestore, collection, doc, setDoc, getDoc, deleteDoc, onSnapshot, getDocs } from '@angular/fire/firestore';
import * as localforage from 'localforage';

@Component({
  selector: 'app-checklist',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './checklist.html',
  styleUrls: ['./checklist.css']
})
export class ChecklistComponent implements OnInit, OnDestroy {
  isMenuOpen = false;
  isEditandoTarea = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }
  currentUser: any = null;
  vistaActual = signal<'lista' | 'detalle'>('lista');
  checklistSeleccionado = signal<any>(null);
  terminoBusquedaChecklist = '';
  toastMessage = '';
  notificacionesPendientes = signal<any[]>([]);
  isModalNotificacionOpen = false;
  empleadoParaNotificar = '';
  mensajeNotificacion = '';
  isModalOpen = false;
  formName = '';
  formAssigned: string[] = [];
  formStore = '';
  // 🔥 Variables insertadas 🔥
  formItems: any[] = [{ text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false, permiteGaleria: false, permiteDocumentos: false, tiempoEstimado: 30, date: '', time: '' }]; 
  isModalRutinasOpen = false;
  isEditMode = false;
  formNameRutina = '';
  formAssignedRutina: string[] = [];
  formStoreRutina = '';
  // 🔥 Variables insertadas 🔥
  formRutinas: any[] = [{ text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false, permiteGaleria: false, permiteDocumentos: false, tiempoEstimado: 30, frecuencia: 'Diaria', fechaFin: null, horaLimite: '', diaSemana: 'Lunes', diaMes: 1 }];
  frecuencias = ['Diaria', 'Semanal', 'Catorcenal', 'Mensual', 'Trimestral'];
  diasDelMes = Array.from({ length: 31 }, (_, i) => i + 1);
  isPasswordModalOpen = false;
  passwordInput = '';
  checklistToDelete: any = null;
  checklists = signal<any[]>([]);
  empleados = signal<any[]>([]);
  sucursalesDisponibles = signal<string[]>([]);
  private firestore = inject(Firestore);
  private route = inject(ActivatedRoute);
  private destructoresRadares: (() => void)[] = [];
  private intervalId: any;
  private sucursalesAdministrativas = [
    'OFICINAS CORPORATIVAS', 'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD',
    'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO'
  ];

  esSucursalAdministrativa(sucursal: string): boolean { return this.sucursalesAdministrativas.includes(sucursal); }
  
  get empleadosFiltrados() {
    if (!this.formStore) return this.empleados();
    return this.empleados().filter(emp => {
      if (emp.sucursales && emp.sucursales.includes('General (Acceso Total)')) return true;
      const susSucursales = emp.sucursales || [emp.sucursal || ''];
      return susSucursales.includes(this.formStore);
    });
  }

  get empleadosFiltradosRutina() {
    if (!this.formStoreRutina) return this.empleados();
    return this.empleados().filter(emp => {
      if (emp.sucursales && emp.sucursales.includes('General (Acceso Total)')) return true;
      const susSucursales = emp.sucursales || [emp.sucursal || ''];
      return susSucursales.includes(this.formStoreRutina);
    });
  }

  get checklistsFiltrados() {
    if (!this.terminoBusquedaChecklist.trim()) return this.checklists();
    const termino = this.terminoBusquedaChecklist.toLowerCase();
    return this.checklists().filter(c =>
      c.name?.toLowerCase().includes(termino) ||
      c.assigned?.toLowerCase().includes(termino) ||
      c.store?.toLowerCase().includes(termino)
    );
  }

  mostrarToast(mensaje: string) {
    this.toastMessage = mensaje;
    setTimeout(() => { this.toastMessage = ''; }, 3500);
  }

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) { this.currentUser = JSON.parse(sesion); }
    this.conectarRadarNube();
    this.route.queryParams.subscribe(params => {
      if (params['assign'] && params['modal']) {
        setTimeout(() => {
          if (params['modal'] === 'tarea') {
            this.abrirModal();
            this.formAssigned = [params['assign']];
          } else if (params['modal'] === 'rutina') {
            this.abrirModalRutinas();
            this.formAssignedRutina = [params['assign']];
          }
        }, 500);
      }
    });
    // 🔥 MOTOR DE TIEMPO REAL (1 SEGUNDO) PARA EL CRONÓMETRO 🔥
    this.intervalId = setInterval(() => {
      // Angular detecta el cambio automáticamente por el signal y actualiza la vista
    }, 1000);
  }

  ngOnDestroy() {
    this.destructoresRadares.forEach(apagarRadar => apagarRadar());
    if (this.intervalId) { clearInterval(this.intervalId); }
  }

  // =========================================================
  // 🔥 LÓGICA MÁGICA DEL CRONÓMETRO 🔥
  // =========================================================
  isDespuesExpirado(item: any): boolean {
    if (!item.requiresAntesDespues || !item.photoAntesTimestamp || !item.tiempoEstimado) return false;
    const limite = item.photoAntesTimestamp + (item.tiempoEstimado * 60000);
    return Date.now() > limite;
  }

  getTiempoRestanteTexto(item: any): string {
    if (!item.requiresAntesDespues || !item.photoAntesTimestamp || !item.tiempoEstimado) return '';
    if (item.photoDespues) return 'Completado';
    const limite = item.photoAntesTimestamp + (item.tiempoEstimado * 60000);
    const ahora = Date.now();
    if (ahora > limite) return 'Agotado';
    const faltanMs = limite - ahora;
    const minutos = Math.floor(faltanMs / 60000);
    const segundos = Math.floor((faltanMs % 60000) / 1000);
    return `${minutos}m ${segundos}s`;
  }

  // =========================================================
  conectarRadarNube() {
    const usuariosRef = collection(this.firestore, 'usuarios');
    const radarUsuarios = onSnapshot(usuariosRef, (snapshot) => {
      const todosLosUsuarios: any[] = [];
      snapshot.forEach(docSnap => todosLosUsuarios.push(docSnap.data()));
      const todasLasSucursales = [
        'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
        'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro',
        'OFICINAS CORPORATIVAS', 'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD',
        'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO'
      ];
      if (this.currentUser?.rol === 'admin') {
        this.sucursalesDisponibles.set(todasLasSucursales);
      } else if (this.currentUser?.puedeCrearChecklists) {
        const misSucursales = this.currentUser.sucursales || [this.currentUser.sucursal || ''];
        this.sucursalesDisponibles.set(misSucursales);
      }
      const personalActivo = todosLosUsuarios.filter((u: any) => u.rol === 'trabajador' || u.rol === 'admin');
      if (this.currentUser?.rol === 'admin') {
        this.empleados.set(personalActivo);
      } else if (this.currentUser?.puedeCrearChecklists) {
        const misSucursales = this.currentUser.sucursales || [this.currentUser.sucursal || ''];
        const empleadosFiltrados = personalActivo.filter((t: any) => {
          const susSucursales = t.sucursales || [t.sucursal || ''];
          return susSucursales.some((s: string) => misSucursales.includes(s));
        });
        this.empleados.set(empleadosFiltrados);
      }
    });
    this.destructoresRadares.push(radarUsuarios);

    const moldesRef = collection(this.firestore, 'moldes_checklists');
    const radarMoldes = onSnapshot(moldesRef, (snapshot) => {
      const moldesActivos: any[] = [];
      snapshot.forEach(docSnap => moldesActivos.push(docSnap.data()));
      this.ejecutarRobotRutinas(moldesActivos);
    });
    this.destructoresRadares.push(radarMoldes);

    const checklistsRef = collection(this.firestore, 'checklists');
    const radarChecklists = onSnapshot(checklistsRef, (snapshot) => {
      const todasLasListas: any[] = [];
      const offset = new Date().getTimezoneOffset() * 60000;
      const fechaHoyLocal = new Date(Date.now() - offset).toISOString().split('T')[0];
      snapshot.forEach(docSnap => {
        const c = docSnap.data() as any;
        if (c.eliminado === true) return;
        if (c.enviado === true) return;
        if (c.date === fechaHoyLocal) {
          const tareasMarcadas = c.items.filter((i: any) => i.checked).length;
          c.calcCompletados = tareasMarcadas;
          c.calcProgreso = Math.round((tareasMarcadas / c.items.length) * 100) || 0;
          todasLasListas.push(c);
        }
      });
      const listasSinClones = new Map();
      todasLasListas.forEach(c => {
        const firma = `${c.name}_${c.assigned}_${c.store}_${c.date}`;
        if (!listasSinClones.has(firma)) {
          listasSinClones.set(firma, c);
        } else {
          const existente = listasSinClones.get(firma);
          if (c.calcProgreso > existente.calcProgreso) { listasSinClones.set(firma, c); }
        }
      });
      const listasFinales = Array.from(listasSinClones.values());
      listasFinales.sort((a, b) => b.timestampCreacion - a.timestampCreacion);
      if (this.currentUser?.rol === 'admin') {
        this.checklists.set(listasFinales);
      } else {
        const misListas = listasFinales.filter((c: any) => c.assigned === this.currentUser.nombre);
        this.checklists.set(misListas);
      }
    });
    this.destructoresRadares.push(radarChecklists);

    const notiRef = collection(this.firestore, 'notificaciones');
    const radarNotificaciones = onSnapshot(notiRef, (snapshot) => {
      const misNotis: any[] = [];
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        if (data['empleado'] === this.currentUser?.nombre && data['leido'] === false) {
          misNotis.push({ id: docSnap.id, ...data });
        }
      });
      misNotis.sort((a, b) => a.timestamp - b.timestamp);
      this.notificacionesPendientes.set(misNotis);
    });
    this.destructoresRadares.push(radarNotificaciones);
  }

  abrirModalNotificacion(empleadoNombre: string) {
    this.empleadoParaNotificar = empleadoNombre;
    this.mensajeNotificacion = '';
    this.isModalNotificacionOpen = true;
  }

  cerrarModalNotificacion() {
    this.isModalNotificacionOpen = false;
    this.empleadoParaNotificar = '';
  }

  async enviarNotificacion() {
    if (!this.mensajeNotificacion.trim()) { alert('Por favor escribe un mensaje.'); return; }
    const notiId = 'noti_' + Date.now();
    const payload = {
      empleado: this.empleadoParaNotificar, mensaje: this.mensajeNotificacion,
      de: this.currentUser?.nombre || 'Gerencia', leido: false, timestamp: Date.now()
    };
    try {
      await setDoc(doc(this.firestore, 'notificaciones', notiId), payload);
      this.mostrarToast(` 🔔 ¡Zumbido enviado a ${this.empleadoParaNotificar}!`);
      this.cerrarModalNotificacion();
    } catch (error) { alert('Error al enviar la alerta.'); }
  }

  async marcarNotificacionComoLeida(noti: any) {
    try { await setDoc(doc(this.firestore, 'notificaciones', noti.id), { leido: true }, { merge: true }); }
    catch (error) { console.error("Error cerrando notificación", error); }
  }

  getPrimerasTareas(checklist: any): any[] {
    if (!checklist || !checklist.items) return [];
    return checklist.items.slice(0, 4);
  }

  isTareaVencida(item: any, checklistDate: string): boolean {
    if (!checklistDate) return false;
    let hora = '23'; let minuto = '59';
    if (item.tipo === 'rutina' && item.horaLimite) {
      const partes = item.horaLimite.split(':');
      if (partes.length === 2) { hora = partes[0]; minuto = partes[1]; }
    } else if (item.tipo === 'tarea' && item.time) {
      const partes = item.time.split(':');
      if (partes.length === 2) { hora = partes[0]; minuto = partes[1]; }
    }
    const [year, month, day] = checklistDate.split('-');
    const deadline = new Date(Number(year), Number(month) - 1, Number(day), Number(hora), Number(minuto), 59);
    return new Date() > deadline;
  }

  esDiaCerrado(sucursal: string, fecha: Date = new Date()): boolean {
    const dia = fecha.getDate(); const mes = fecha.getMonth() + 1; const anio = fecha.getFullYear();
    if (sucursal === 'Padre Hidalgo' || sucursal === '8 Esquinas') {
      const viernesSanto = this.calcularViernesSanto(anio);
      if (dia === viernesSanto.getDate() && mes === (viernesSanto.getMonth() + 1)) return true;
      return false;
    } else {
      if ((dia === 25 && mes === 12) || (dia === 1 && mes === 1)) return true;
      return false;
    }
  }

  calcularViernesSanto(anio: number): Date {
    const a = anio % 19; const b = Math.floor(anio / 100); const c = anio % 100;
    const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4); const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mesResurreccion = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const diaResurreccion = ((h + l - 7 * m + 114) % 31) + 1;
    const domingoResurreccion = new Date(anio, mesResurreccion, diaResurreccion);
    const viernesSanto = new Date(domingoResurreccion);
    viernesSanto.setDate(domingoResurreccion.getDate() - 2);
    return viernesSanto;
  }

  calcularFechaFinDefault(frecuencia: string): string | null { return null; }
  alCambiarFrecuencia(rutina: any) { rutina.fechaFin = this.calcularFechaFinDefault(rutina.frecuencia); }

  getTextoPeriodo(rutina: any): string {
    if (rutina.frecuencia === 'Diaria') return 'Activa siempre';
    if (rutina.frecuencia === 'Semanal') return `Todos los ${rutina.diaSemana || 'Lunes'}`;
    if (rutina.frecuencia === 'Catorcenal') return `Cada 2 weeks, los ${rutina.diaSemana || 'Lunes'}`;
    if (rutina.frecuencia === 'Mensual') return `Los días ${rutina.diaMes || 1} del mes`;
    if (rutina.frecuencia === 'Trimestral') return `El día ${rutina.diaMes || 1} cada 3 meses`;
    return '';
  }

  getWeekNumber(d: Date): number {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  obtenerLlavePeriodo(frecuencia: string, fecha: Date): string {
    const y = fecha.getFullYear(); const m = fecha.getMonth() + 1; const d = fecha.getDate();
    if (frecuencia === 'Diaria') return `${y}-${m}-${d}`;
    if (frecuencia === 'Mensual') return `${y}-${m}`;
    if (frecuencia === 'Trimestral') return `${y}-Q${Math.ceil(m / 3)}`;
    const week = this.getWeekNumber(fecha);
    if (frecuencia === 'Semanal') return `${y}-W${week}`;
    if (frecuencia === 'Catorcenal') return `${y}-C${Math.ceil(week / 2)}`;
    return `${y}-${m}-${d}`;
  }

  async ejecutarRobotRutinas(moldes: any[]) {
    const fechaActual = new Date();
    const offset = fechaActual.getTimezoneOffset() * 60000;
    const fechaLocal = new Date(fechaActual.getTime() - offset);
    const fechaString = fechaLocal.toISOString().split('T')[0];
    const diasTexto = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const diaHoyTexto = diasTexto[fechaLocal.getDay()];
    const diaMesActual = fechaLocal.getDate();
    const esDomingo = fechaLocal.getDay() === 0;

    for (const molde of moldes) {
      if (this.esDiaCerrado(molde.store, fechaActual)) { continue; }
      if (esDomingo && this.esSucursalAdministrativa(molde.store) && molde.frecuencia === 'Diaria') { continue; }
      
      if (molde.frecuencia === 'Semanal' || molde.frecuencia === 'Catorcenal') {
        if (molde.diaSemana && molde.diaSemana !== diaHoyTexto) { continue; }
        if (molde.frecuencia === 'Catorcenal' && molde.timestampCreacion) {
          const semanaActual = this.getWeekNumber(fechaLocal);
          const semanaCreacion = this.getWeekNumber(new Date(molde.timestampCreacion));
          if (Math.abs(semanaActual - semanaCreacion) % 2 !== 0) { continue; }
        }
      }
      
      if (molde.frecuencia === 'Mensual' || molde.frecuencia === 'Trimestral') {
        const diaObjetivo = parseInt(molde.diaMes || '1', 10);
        const ultimoDiaDelMesActual = new Date(fechaLocal.getFullYear(), fechaLocal.getMonth() + 1, 0).getDate();
        const diaRealAProcesar = diaObjetivo > ultimoDiaDelMesActual ? ultimoDiaDelMesActual : diaObjetivo;
        if (diaMesActual !== diaRealAProcesar) { continue; }
        if (molde.frecuencia === 'Trimestral' && molde.timestampCreacion) {
          const mesActual = fechaLocal.getMonth();
          const mesCreacion = new Date(molde.timestampCreacion).getMonth();
          if (Math.abs(mesActual - mesCreacion) % 3 !== 0) { continue; }
        }
      }

      const itemsVigentes = molde.items.filter((item: any) => { return !item.fechaFin || fechaString <= item.fechaFin; });
      if (itemsVigentes.length === 0) continue;
      const llavePeriodo = this.obtenerLlavePeriodo(molde.frecuencia, fechaActual);
      const checklistId = `${molde.id}_${llavePeriodo}`;
      const docRef = doc(this.firestore, 'checklists', checklistId);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        const nuevoChecklist = {
          id: checklistId, timestampCreacion: Date.now(), name: `${molde.name} (${molde.frecuencia})`,
          assigned: molde.assigned, store: molde.store, date: fechaString, time: '23:59',
          status: 'pendiente', enviado: false, createdBy: 'Robot de Rutinas', notaEmpleado: '',
          items: itemsVigentes.map((i: any) => ({
            ...i, checked: false, photo: null, photoTime: null, photoAntes: null, photoAntesTime: null, photoAntesTimestamp: null, photos: []
          }))
        };
        await setDoc(docRef, nuevoChecklist);
      }
    }
  }

  async guardarEnLaNube(checklist: any) {
    try { await setDoc(doc(this.firestore, 'checklists', checklist.id.toString()), checklist, { merge: true }); }
    catch (error) { console.error("Error: ", error); }
  }

  eliminarChecklist(checklist: any, event: Event) {
    event.stopPropagation();
    this.checklistToDelete = checklist;
    this.passwordInput = '';
    this.isPasswordModalOpen = true;
  }

  cerrarPasswordModal() { this.isPasswordModalOpen = false; this.checklistToDelete = null; this.passwordInput = ''; }

  async confirmarEliminacion() {
    if (this.passwordInput !== 'Mega2323') { alert(' ❌ Contraseña maestra incorrecta.'); return; }
    const confirmar = confirm(` ⚠️ ¿Borrar "${this.checklistToDelete.name}" y sus duplicados?`);
    if (confirmar) {
      try {
        const targetName = this.checklistToDelete.name.replace(/ \((Diaria|Semanal|Catorcenal|Mensual|Trimestral)\)$/, "");
        const targetAssigned = this.checklistToDelete.assigned;
        const checklistsRef = collection(this.firestore, 'checklists');
        const chkSnap = await getDocs(checklistsRef);
        chkSnap.forEach(async (cDoc) => {
          const cData = cDoc.data();
          if (cData['name'].startsWith(targetName) && cData['assigned'] === targetAssigned) {
            await setDoc(doc(this.firestore, 'checklists', cDoc.id), { eliminado: true }, { merge: true });
          }
        });
        const moldesRef = collection(this.firestore, 'moldes_checklists');
        const moldesSnap = await getDocs(moldesRef);
        moldesSnap.forEach(async (mDoc) => {
          const mData = mDoc.data();
          if (targetName.includes(mData['name']) && mData['assigned'] === targetAssigned) {
            await deleteDoc(doc(this.firestore, 'moldes_checklists', mDoc.id));
          }
        });
        alert(' 🗑️ Checklist eliminado.');
      } catch (error) { alert(' ❌ Error al eliminar.'); }
    }
    this.cerrarPasswordModal();
  }

  async editarBloqueRutinas(checklist: any, event: Event) {
    event.stopPropagation();
    this.isEditMode = true;
    const targetName = checklist.name.replace(/ \((Diaria|Semanal|Catorcenal|Mensual|Trimestral)\)$/, "");
    const targetAssigned = checklist.assigned;
    const moldesRef = collection(this.firestore, 'moldes_checklists');
    const moldesSnap = await getDocs(moldesRef);
    let rutinasEncontradas: any[] = [];
    let sucursalOriginal = '';

    moldesSnap.forEach((mDoc) => {
      const mData = mDoc.data();
      if (mData['name'] === targetName && mData['assigned'] === targetAssigned) {
        sucursalOriginal = mData['store'];
        if (mData['items'] && Array.isArray(mData['items'])) {
          rutinasEncontradas = [...rutinasEncontradas, ...mData['items']];
        }
      }
    });

    if (rutinasEncontradas.length === 0) {
      alert('Esta es una "Tarea Única" o no tiene rutinas registradas en la Bóveda. No se puede editar como Bloque.');
      return;
    }
    this.formNameRutina = targetName;
    this.formAssignedRutina = [targetAssigned];
    this.formStoreRutina = sucursalOriginal;
    this.formRutinas = rutinasEncontradas;
    this.isModalRutinasOpen = true;
  }

  verDetalle(checklist: any) { this.checklistSeleccionado.set(checklist); this.vistaActual.set('detalle'); }
  volverALista() { this.checklistSeleccionado.set(null); this.vistaActual.set('lista'); }
  toggleItem(item: any) { item.checked = !item.checked; this.actualizarEstado(); }

  async onFileSelected(event: any, item: any, tipoFoto: string = 'photo') {
    const file = event.target.files[0];
    if (!file) return;
    const checklistActual = this.checklistSeleccionado();
    if (!checklistActual) return;

    if (!navigator.onLine) {
      console.log('📡 Sin internet detectado. Guardando foto en bóveda local...');
      item[tipoFoto] = 'offline_syncing';
      item.pendienteDeSync = true;
      const ahora = new Date();
      item[tipoFoto + 'Time'] = ahora.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      if (tipoFoto === 'photoAntes') { item.photoAntesTimestamp = Date.now(); }
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64String = reader.result as string;
        const indexItem = checklistActual.items.findIndex((i: any) => i === item);
        const fotoEstancada = {
          idTarea: checklistActual.id,
          indexItem: indexItem,
          tipoFoto: tipoFoto,
          base64: base64String
        };
        const colaActual: any[] = await localforage.getItem('md_fotos_offline') || [];
        colaActual.push(fotoEstancada);
        await localforage.setItem('md_fotos_offline', colaActual);
        this.actualizarEstado(); 
        this.mostrarToast(' 📡 Guardado sin conexión. Se subirá automáticamente.');
      };
      event.target.value = '';
      return;
    }

    const cloudName = 'duherjgyg';
    const uploadPreset = 'fotos_mega';
    item[tipoFoto] = 'subiendo...';
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', uploadPreset);

    try {
      const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, { method: 'POST', body: formData });
      const data = await response.json();
      if (data.secure_url) {
        item[tipoFoto] = data.secure_url;
        item.pendienteDeSync = false; 
        const ahora = new Date();
        item[tipoFoto + 'Time'] = ahora.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
        if (tipoFoto === 'photoAntes') { item.photoAntesTimestamp = Date.now(); }
        this.actualizarEstado();
      } else {
        item[tipoFoto] = null; this.actualizarEstado(); alert(' ❌ Error de Cloudinary.');
      }
    } catch (error) {
      item[tipoFoto] = null; this.actualizarEstado(); alert(' ❌ Error de conexión.');
    } finally {
      event.target.value = '';
    }
  }

  async onMultipleFilesSelected(event: any, item: any) {
    const files: FileList = event.target.files;
    if (!files || files.length === 0) return;
    const checklistActual = this.checklistSeleccionado();
    if (!checklistActual) return;
    if (!item.photos) item.photos = [];
    const cloudName = 'duherjgyg';
    const uploadPreset = 'fotos_mega';
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!navigator.onLine) {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = async () => {
          const base64String = reader.result as string;
          const indexItem = checklistActual.items.findIndex((it: any) => it === item);
          const colaActual: any[] = await localforage.getItem('md_fotos_offline') || [];
          colaActual.push({ idTarea: checklistActual.id, indexItem, tipoFoto: 'photos_multi', base64: base64String });
          await localforage.setItem('md_fotos_offline', colaActual);
        };
        item.photos.push({ url: 'offline_syncing', time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) });
        this.actualizarEstado();
        this.mostrarToast('📡 Foto guardada sin conexión.');
        continue;
      }
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', uploadPreset);
      try {
        const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, { method: 'POST', body: formData });
        const data = await response.json();
        if (data.secure_url) {
          item.photos.push({
            url: data.secure_url,
            time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
          });
          this.actualizarEstado();
        }
      } catch (error) {
        alert('❌ Error al subir una foto.');
      }
    }
    event.target.value = '';
  }

  removeMultiPhoto(item: any, index: number) {
    if (item.photos) {
      item.photos.splice(index, 1);
      this.actualizarEstado();
    }
  }

  removeImage(item: any, tipoFoto: string = 'photo') {
    item[tipoFoto] = null;
    item[tipoFoto + 'Time'] = null;
    if (tipoFoto === 'photoAntes') {
      item.photoAntesTimestamp = null;
    }
    this.actualizarEstado();
  }

  esItemCompleto(item: any): boolean {
    if (!item.checked) return false;
    if (item.requiresAntesDespues) {
      return (item.photoAntes !== null && item.photoAntes !== undefined && item.photoAntes !== 'subiendo...') &&
        (item.photoDespues !== null && item.photoDespues !== undefined && item.photoDespues !== 'subiendo...');
    }
    if (item.requiresPhoto) {
      return (item.photo !== null && item.photo !== undefined && item.photo !== 'subiendo...');
    }
    return true;
  }

  actualizarEstado() {
    const actual = this.checklistSeleccionado(); if (!actual) return;
    const checkboxesMarcados = actual.items.filter((i: any) => i.checked).length;
    actual.calcCompletados = checkboxesMarcados;
    actual.calcProgreso = Math.round((checkboxesMarcados / actual.items.length) * 100) || 0;
    if (checkboxesMarcados === 0) { actual.status = 'pendiente'; }
    else if (checkboxesMarcados === actual.items.length) { actual.status = 'completo'; }
    else { actual.status = 'en-progreso'; }
    this.guardarEnLaNube(actual);
  }

  enviarChecklist() {
    const actual = this.checklistSeleccionado(); if (!actual) return;
    const fotosPendientes = actual.items.some((i: any) => i.photo === 'subiendo...' || i.photoAntes === 'subiendo...' || i.photoDespues === 'subiendo...');
    if (fotosPendientes) { alert(' ⚠️  Espera, una foto se está subiendo.'); return; }
    const tareas100Porciento = actual.items.filter((i: any) => this.esItemCompleto(i)).length;
    if (tareas100Porciento < actual.items.length) {
      const confirmar = confirm(' ⚠️  Faltan FOTOS obligatorias.\n¿Enviar así?');
      if (!confirmar) return;
    }
    actual.enviado = true;
    const ahora = new Date();
    actual.horaEnvio = ahora.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    this.guardarEnLaNube(actual);
    this.mostrarToast(' ✅   ¡ Checklist enviado correctamente!');
    this.volverALista();
  }

  toggleEmpleado(nombre: string) {
    const index = this.formAssigned.indexOf(nombre);
    if (index > -1) { this.formAssigned.splice(index, 1); } else { this.formAssigned.push(nombre); }
  }

  abrirModal() {
    this.isEditandoTarea = false; 
    this.formName = ''; this.formAssigned = [];
    this.formStore = this.sucursalesDisponibles().length > 0 ? this.sucursalesDisponibles()[0] : '';
    this.formItems = [{ text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false, permiteGaleria: false, permiteDocumentos: false, tiempoEstimado: 30, date: '', time: '' }];
    this.isModalOpen = true;
  }

  cerrarModal() { this.isModalOpen = false; }
  
  // 🔥 Variables insertadas 🔥
agregarItem() { 
    this.formItems.push({ text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false, permiteGaleria: false, permiteDocumentos: false, tiempoEstimado: 30, date: '', time: '' }); 
  }  eliminarItem(index: number) { this.formItems.splice(index, 1); }
  
  trackByIndex(index: number, obj: any): any { return index; }

  abrirEditarChecklistActual() {
    const actual = this.checklistSeleccionado();
    if (!actual) return;
    this.isEditandoTarea = true;
    this.formName = actual.name;
    this.formAssigned = [actual.assigned];
    this.formStore = actual.store;
    this.formItems = JSON.parse(JSON.stringify(actual.items));
    this.isModalOpen = true;
  }

guardarChecklistUnico() {
    if (!this.formName || this.formAssigned.length === 0) { alert('Faltan datos.'); return; }
    
    const tareasValidas = this.formItems.filter(item => item.text.trim() !== '').map((item, i) => ({
      id: Date.now() + i, 
      text: item.text, 
      requiresPhoto: item.requiresPhoto, 
      requiresAntesDespues: item.requiresAntesDespues, 
      requiresVariasFotos: item.requiresVariasFotos || false,
      permiteGaleria: item.permiteGaleria || false,
      permiteDocumentos: item.permiteDocumentos || false,
      tiempoEstimado: item.requiresAntesDespues ? (item.tiempoEstimado || 30) : null,
      date: item.date, 
      time: item.time, 
      checked: false,
      photo: null, photoTime: null, photoAntes: null, photoAntesTime: null, photoAntesTimestamp: null, photoDespues: null, photoDespuesTime: null, tipo: 'tarea'
    }));

    if (tareasValidas.length === 0) { alert('Agrega tareas.'); return; }

    this.formAssigned.forEach((empleadoNombre, index) => {
      const uniqueId = Date.now() + index; 
      const offset = new Date().getTimezoneOffset() * 60000;
      const hoy = new Date(Date.now() - offset).toISOString().split('T')[0];
      
      const checklistTareas = {
        id: uniqueId, 
        timestampCreacion: Date.now(), 
        name: this.formName, 
        assigned: empleadoNombre,
        store: this.formStore, 
        date: tareasValidas[0].date || hoy, 
        time: tareasValidas[0].time || '23:59',
        status: 'pendiente', 
        enviado: false, 
        createdBy: this.currentUser?.nombre || 'Desconocido', 
        notaEmpleado: '',
        items: JSON.parse(JSON.stringify(tareasValidas))
      };

      this.guardarEnLaNube(checklistTareas);

      // 🔥 LÓGICA DE WHATSAPP SEMIAUTOMÁTICO 🔥
      const datosEmpleado = this.empleados().find(e => e.nombre === empleadoNombre);
      if (datosEmpleado && datosEmpleado.telefono) {
        const telefono = datosEmpleado.telefono;
        const urlBase = 'https://api.whatsapp.com/send?phone=' + telefono + '&text=';
        
        // Armamos el cuerpo del mensaje (Limpiamos emojis para evitar errores de URL)
        let mensaje = `*Mega Dulces Task* 🍭\n\n`;
        mensaje += `¡Hola *${this.limpiarEmojis(empleadoNombre)}*!\n`;
        mensaje += `Se te ha asignado un nuevo checklist: *${this.limpiarEmojis(this.formName)}*\n\n`;
        mensaje += `📅 Fecha: ${checklistTareas.date}\n`;
        mensaje += `⏰ Hora Límite: ${this.formatearHora(checklistTareas.time)}\n\n`;
        mensaje += `Favor de ingresar a la plataforma para completar tus evidencias.`;

        // Abrimos WhatsApp en una pestaña nueva
        window.open(urlBase + encodeURIComponent(mensaje), '_blank');
      }
    });

    this.mostrarToast(' ✅ ¡Tareas creadas y avisos de WhatsApp generados!');
    this.cerrarModal();
  }

async guardarCambiosChecklist() {
    if (!this.formName || this.formAssigned.length === 0) { alert('Faltan datos.'); return; }
    const actual = this.checklistSeleccionado();
    if (!actual) return;
    const tareasValidas = this.formItems.filter(item => item.text.trim() !== '').map((item, i) => {
      const itemOriginal = actual.items.find((orig: any) => orig.text === item.text);
      if (itemOriginal) {
        return { 
          ...itemOriginal, 
          requiresPhoto: item.requiresPhoto, 
          requiresAntesDespues: item.requiresAntesDespues,
          requiresVariasFotos: item.requiresVariasFotos || false,
          // 🔥 AQUÍ SE EMPACAN LOS PERMISOS 🔥
          permiteGaleria: item.permiteGaleria || false,
          permiteDocumentos: item.permiteDocumentos || false,
          tiempoEstimado: item.tiempoEstimado 
        };
      }
      return {
        id: Date.now() + i, text: item.text, requiresPhoto: item.requiresPhoto, 
        requiresVariasFotos: (item as any).requiresVariasFotos || false,
        // 🔥 AQUÍ SE EMPACAN LOS PERMISOS 🔥
        permiteGaleria: (item as any).permiteGaleria || false,
        permiteDocumentos: (item as any).permiteDocumentos || false,
        tiempoEstimado: item.requiresAntesDespues ? (item.tiempoEstimado || 30) : null,
        date: actual.date, time: actual.time || '23:59', checked: false,
        photo: null, photoTime: null, photoAntes: null, photoAntesTime: null, photoAntesTimestamp: null, photoDespues: null, photoDespuesTime: null, tipo: 'tarea'
      };
    });
    if (tareasValidas.length === 0) { alert('Agrega tareas.'); return; }
    try {
      await setDoc(doc(this.firestore, 'checklists', actual.id.toString()), {
        name: this.formName,
        assigned: this.formAssigned[0], 
        store: this.formStore,
        items: tareasValidas
      }, { merge: true });
      this.mostrarToast(' ✏️ ¡Tarea actualizada con éxito!');
      actual.name = this.formName;
      actual.assigned = this.formAssigned[0];
      actual.store = this.formStore;
      actual.items = tareasValidas;
      this.cerrarModal();
    } catch (error) {
      console.error(error);
      alert('Error al actualizar la tarea.');
    }
  }

  toggleEmpleadoRutina(nombre: string) {
    const index = this.formAssignedRutina.indexOf(nombre);
    if (index > -1) { this.formAssignedRutina.splice(index, 1); } else { this.formAssignedRutina.push(nombre); }
  }

abrirModalRutinas() {
    this.isEditMode = false;
    this.formNameRutina = ''; this.formAssignedRutina = [];
    this.formStoreRutina = this.sucursalesDisponibles().length > 0 ? this.sucursalesDisponibles()[0] : '';
    this.formRutinas = [{ text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false, permiteGaleria: false, permiteDocumentos: false, tiempoEstimado: 30, frecuencia: 'Diaria', fechaFin: null, horaLimite: '', diaSemana: 'Lunes', diaMes: 1 }];
    this.isModalRutinasOpen = true;
  }

  cerrarModalRutinas() { this.isModalRutinasOpen = false; }
  
  // 🔥 Variables insertadas 🔥
agregarRutina() { 
    this.formRutinas.push({ text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false, permiteGaleria: false, permiteDocumentos: false, tiempoEstimado: 30, frecuencia: 'Diaria', fechaFin: null, horaLimite: '', diaSemana: 'Lunes', diaMes: 1 }); 
  }  
  eliminarRutina(index: number) { this.formRutinas.splice(index, 1); }

async guardarBloqueRutinas() {
    if (!this.formNameRutina || this.formAssignedRutina.length === 0) { alert('Faltan datos.'); return; }
    const rutinasValidas = this.formRutinas.filter(rutina => rutina.text.trim() !== '').map((rutina, i) => ({
      id: Date.now() + 1000 + i, text: rutina.text, requiresPhoto: rutina.requiresPhoto, requiresAntesDespues: rutina.requiresAntesDespues || false,
      requiresVariasFotos: rutina.requiresVariasFotos || false,
      // 🔥 AQUÍ SE EMPACAN LOS PERMISOS 🔥
      permiteGaleria: rutina.permiteGaleria || false,
      permiteDocumentos: rutina.permiteDocumentos || false,
      tiempoEstimado: rutina.requiresAntesDespues ? (rutina.tiempoEstimado || 30) : null,
      checked: false, photo: null, photoTime: null, photoAntes: null, photoAntesTime: null, photoAntesTimestamp: null, photoDespues: null, photoDespuesTime: null,
      tipo: 'rutina', frecuencia: rutina.frecuencia, fechaFin: rutina.fechaFin, horaLimite: rutina.horaLimite, diaSemana: rutina.diaSemana || 'Lunes', diaMes: rutina.diaMes || 1
    }));
    if (rutinasValidas.length === 0) { alert('Agrega rutinas.'); return; }
    if (this.isEditMode) {
      const moldesRef = collection(this.firestore, 'moldes_checklists');
      const moldesSnap = await getDocs(moldesRef);
      moldesSnap.forEach(async (mDoc) => {
        const mData = mDoc.data();
        if (mData['name'] === this.formNameRutina && mData['assigned'] === this.formAssignedRutina[0]) {
          await deleteDoc(doc(this.firestore, 'moldes_checklists', mDoc.id));
        }
      });
    }
    this.formAssignedRutina.forEach((empleadoNombre) => {
      const rutinasPorFrecuencia: { [key: string]: any[] } = {};
      rutinasValidas.forEach(r => {
        const llaveGrupo = r.frecuencia === 'Diaria' ? 'Diaria' : (r.frecuencia === 'Semanal' || r.frecuencia === 'Catorcenal') ? `${r.frecuencia}_${r.diaSemana}` : `${r.frecuencia}_${r.diaMes}`;
        if (!rutinasPorFrecuencia[llaveGrupo]) rutinasPorFrecuencia[llaveGrupo] = [];
        rutinasPorFrecuencia[llaveGrupo].push(r);
      });
      Object.keys(rutinasPorFrecuencia).forEach((llaveGrupo) => {
        const partesGrupo = llaveGrupo.split('_');
        const frecuenciaReal = partesGrupo[0];
        let diaSemanaReal = null; let diaMesReal = null;
        if (frecuenciaReal === 'Semanal' || frecuenciaReal === 'Catorcenal') { diaSemanaReal = partesGrupo.length > 1 ? partesGrupo[1] : 'Lunes'; }
        else if (frecuenciaReal === 'Mensual' || frecuenciaReal === 'Trimestral') { diaMesReal = partesGrupo.length > 1 ? parseInt(partesGrupo[1], 10) : 1; }
        const nombreMoldeLimpio = this.formNameRutina.replace(/\s+/g, '_').toLowerCase();
        const empleadoLimpio = empleadoNombre.replace(/\s+/g, '_').toLowerCase();
        const moldeId = `molde_${nombreMoldeLimpio}_${empleadoLimpio}_${llaveGrupo}`;
        const nuevoMolde = {
          id: moldeId, name: this.formNameRutina, assigned: empleadoNombre, store: this.formStoreRutina,
          frecuencia: frecuenciaReal, diaSemana: diaSemanaReal, diaMes: diaMesReal, timestampCreacion: Date.now(),
          createdBy: this.currentUser?.nombre || 'Desconocido', items: JSON.parse(JSON.stringify(rutinasPorFrecuencia[llaveGrupo]))
        };
        setDoc(doc(this.firestore, 'moldes_checklists', moldeId), nuevoMolde);
      });
    });
    this.mostrarToast(this.isEditMode ? ' 🔄  ¡Bloque actualizado con éxito!' : ' 🔄  ¡Bloque guardado en la Bóveda!');
    this.cerrarModalRutinas();
  }

  formatearHora(hora24: string): string {
    if (!hora24) return ''; const partes = hora24.split(':'); if (partes.length !== 2) return hora24;
    let horas = parseInt(partes[0], 10); const ampm = horas >= 12 ? 'PM' : 'AM';
    horas = horas % 12; horas = horas ? horas : 12;
    const horasStr = horas < 10 ? '0' + horas : horas.toString();
    return `${horasStr}:${partes[1]} ${ampm}`;
  }

  // 🔥 ASPIRADORA DE EMOJIS PARA EL PDF 🔥
  limpiarEmojis(texto: string): string {
    if (!texto) return '';
    // Esta expresión regular (Regex) detecta cualquier emoji o símbolo raro y lo elimina,
    // dejando intactas las letras, números y acentos.
    return texto.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '').trim();
  }

  esImagen(url: string): boolean {
    if (!url) return false;
    const urlLower = url.toLowerCase();
    // Si la URL dice que es un archivo 'raw' o termina en extensión de documento, NO es imagen.
    if (urlLower.includes('/raw/upload/') || urlLower.match(/\.(pdf|xls|xlsx|doc|docx|csv|txt|zip|rar)$/)) {
      return false;
    }
    return true;
  }
}