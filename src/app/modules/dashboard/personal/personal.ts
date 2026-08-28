import { Component, signal, OnInit, OnDestroy, inject, effect } from '@angular/core';
import { UsuariosService } from '../../../shared/usuarios.service';
import { ApiService } from '../../../shared/api.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { Firestore, doc, setDoc, deleteDoc } from '@angular/fire/firestore';
import {
  getAuth,
  verifyBeforeUpdateEmail,
  EmailAuthProvider,
  reauthenticateWithCredential
} from '@angular/fire/auth';

// ExcelJS pesa ~700 KB. Se carga dinámicamente cuando el admin pulsa "Exportar".
import Swal from 'sweetalert2';
import { esAdmin, esAdminGlobal, esAdminLimitado, normalizarNombre, mismoEmpleadoNombre, sucursalesPermitidas } from '../../../shared/permisos.util';
import { nivelDeUsuario, NivelJerarquico } from '../../../shared/nivel-jerarquico.util';
import { puestosPorUnidad, puestoPorId, nombrePuesto } from '../../../shared/organigrama.catalogo';
import { resolverPuesto, usuariosSinPuesto, usuariosConPuestoPorAlias } from '../../../shared/puesto.util';
import { manualDePuesto, tareasAutomaticasDePuesto } from '../../../shared/tareas-manual.catalogo';
// 🔥 Para crear usuarios sin desloguear al admin (segunda app Firebase temporal)
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth as getAuthSecondary, createUserWithEmailAndPassword as createUserSecondary, signOut as signOutSecondary } from 'firebase/auth';
import { firebaseConfig } from '../../../app.config';



import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { ImportarNominaComponent, CambioPuesto } from './importar-nomina';

@Component({
  selector: 'app-personal',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent, ImportarNominaComponent],
  templateUrl: './personal.html',
  styleUrls: ['./personal.css']
})
export class PersonalComponent implements OnInit, OnDestroy {
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }
  currentUser: any = null;
  usuarios = signal<any[]>([]);
  usuarioEnEdicion: any = null;
  terminoBusqueda = '';

  // 🏷️ Tabs por nivel jerárquico. 'todos' es default para no romper a nadie.
  vistaNivel: 'todos' | 'mando' | 'operativo' = 'todos';
  cambiarVistaNivel(v: 'todos' | 'mando' | 'operativo') { this.vistaNivel = v; }
  isModalOpen = false;
  mostrarPassword = false;
  formPuedeAdministrarAreas = false;
  formNombre = ''; formUsuario = ''; formCorreo = ''; formTelefono = ''; formPassword = '';
  /** Contraseña que ya tenía el usuario (para mostrarla y para no borrarla al guardar). */
  passwordActual = '';
  /** Mostrar en claro la contraseña que ya tenía (soporte). */
  verPasswordActual = false;
  formRol = 'trabajador'; formCargo = 'Trabajador General';
  /**
   * 🎯 Puesto del organigrama 2026. Es lo que decide qué tareas de manual
   * recibe la persona, así que es el campo que de verdad importa capturar.
   * `formCargo` se conserva y se mantiene sincronizado con el nombre del
   * puesto, porque media app (buscador, reportes, Excel, nivel jerárquico)
   * sigue leyendo `cargo`.
   */
  formPuestoId = '';
  formPuedeCrearChecklists = false;
  formPuedeCrearRutinas = false;
  formPuedeCrearTareasUnicas = false;
  formPuedeVerCheckstore = false;
  formPuedeVerEstadisticas = false;
  formPuedeVerHistorial = false;
  formPuedeAdministrarPersonal = false;
  formPuedeVerCalendario = false; // 🔥 NUEVO: PERMISO DE CALENDARIO 🔥
  formSucursales: string[] = [];
  formAreas: string[] = [];
  // 🎓 Grupo TEC: marca al usuario como miembro del apartado aislado del TEC.
  formGrupoTec = false;
  // 🏷️ "Activación de promociones": son DOS permisos independientes, no uno.
  // La sección es una sola pero atiende dos oficios: el que negocia y captura el
  // formato MKTN001, y el de la sucursal que solo sube la evidencia de que la
  // promoción sí se ejecutó ahí. El de formato alcanza todo; el de expediente
  // no modifica nada ni quita lo ya subido, y solo llega a SUS sucursales.
  formPromocionesFormato = false;
  formPromocionesExpediente = false;
  /** Privilegio del apartado "Pagos de servicios" (grupoPagos). */
  formGrupoPagos = false;
  /** Privilegio del apartado "Tickets" / vale de servicio operativo (grupoTickets). */
  formGrupoTickets = false;
  // 🟢 "Venta de Promos": son TRES permisos independientes, no uno. La sección es
  // una sola pero atiende tres oficios distintos, y casi nadie hace los tres:
  // la cajera solo reporta, el vendedor solo da de alta, el monitor solo mira.
  /** La cajera: da la luz verde cuando se cierra la venta. */
  formVentaPromosCaja = false;
  /** El vendedor: crea las promos (nombre, costo, descripción, foto). */
  formVentaPromosVendedor = false;
  /** El monitor: ve el tablero y recibe el aviso por WhatsApp. */
  formVentaPromosMonitor = false;
  // 🔥 NUEVO: Alcance del admin (global = todas las sucursales, sucursales = solo las asignadas)
  formAlcance: 'global' | 'sucursales' = 'global';

  // 🔥 LISTA INTELIGENTE DE SUCURSALES 🔥
  get sucursalesDisponibles() {
    const todas = [
      'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
      'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro',
      'OFICINAS CORPORATIVAS', 'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD', 'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO', 'CEDIS'
    ];

    const yo = this.liveUser;
    if (!yo) return [];

    // Si soy Admin Global, puedo ver y asignar CUALQUIER sucursal/oficina
    if (esAdminGlobal(yo) || yo.sucursales?.includes('General (Acceso Total)')) {
      return todas;
    }

    // Admin limitado o Jefe/Encargado: SOLO ve y asigna las que yo mismo tengo
    return todas.filter(suc => yo.sucursales?.includes(suc));
  }

  // 🔥 LISTA INTELIGENTE DE ÁREAS 🔥
  get areasDisponibles() {
    const todas = [
      'Cajas', 'Pasillos', 'Precios', 'Caducidades', 'Bodega', 'Mostrador', 'Limpieza General'
    ];

    const yo = this.liveUser;
    if (!yo) return [];

    if (esAdminGlobal(yo) || yo.areas?.includes('Todas las áreas') || yo.areas?.includes('Todas')) {
      return todas;
    }

    // Admin limitado o jefe: solo puedo asignar a mis empleados a las áreas que yo controlo
    return todas.filter(area => yo.areas?.includes(area));
  }

  private firestore = inject(Firestore);
  private router = inject(Router);
  private usuariosSvc = inject(UsuariosService);
  private api = inject(ApiService); // FERROCARRIL: dual-write a Postgres
  private destructoresRadares: (() => void)[] = [];

  // Effect: replica la lista del UsuariosService compartido en el signal local
  // de este componente. Antes este componente abria su propio onSnapshot sobre
  // `usuarios`, ahora consume el listener unico.
  private _usuariosEffect = effect(() => {
    const raw = this.usuariosSvc.usuarios();
    if (!raw) return;
    const usuariosNube = raw.map((u: any) => ({ ...u, idFirestore: u.id || u.uid }));
    const huellaActual = this.huellaUsuarios(this.usuarios());
    const huellaNube = this.huellaUsuarios(usuariosNube);
    if (huellaActual !== huellaNube) this.usuarios.set(usuariosNube);
  });

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) { this.currentUser = JSON.parse(sesion); }
    this.usuariosSvc.iniciar();
    this.conectarConLaNube();
  }

  ngOnDestroy() {
    this.destructoresRadares.forEach(apagarRadar => apagarRadar());
    this.usuariosSvc.detener();
  }

  // =========================================================
  // 🔥 LÓGICA DEL MONITOR EN VIVO (HEARTBEAT) 🔥
  // =========================================================
  isOnline(timestamp: number | undefined): boolean {
    if (!timestamp) return false;
    const cincoMinutos = 5 * 60 * 1000;
    return (Date.now() - timestamp) < cincoMinutos;
  }

  getLastSeenText(timestamp: number | undefined): string {
    if (!timestamp) return 'Nunca ha entrado';

    const diffMs = Date.now() - timestamp;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHoras = Math.floor(diffMins / 60);
    const diffDias = Math.floor(diffHoras / 24);

    if (diffMins < 1) return 'Hace unos segundos';
    if (diffMins < 60) return `Hace ${diffMins} min`;
    if (diffHoras < 24) return `Hace ${diffHoras} ${diffHoras === 1 ? 'hora' : 'hrs'}`;
    return `Hace ${diffDias} ${diffDias === 1 ? 'día' : 'días'}`;
  }

  /** Estado de conexión para el color del indicador de la tarjeta:
   *   'warn' = nunca ha entrado (ámbar), 'ok' = entró hace poco (verde,
   *   dentro de 3 días), 'idle' = hace mucho (gris). */
  estadoConexion(timestamp: number | undefined): 'ok' | 'idle' | 'warn' {
    if (!timestamp) return 'warn';
    const tresDias = 3 * 24 * 60 * 60 * 1000;
    return (Date.now() - timestamp) < tresDias ? 'ok' : 'idle';
  }
  // =========================================================

  conectarConLaNube() {
    // La lista de usuarios viene de UsuariosService (listener compartido).
    // El _usuariosEffect arriba ya replica los datos en this.usuarios con
    // deduplicacion por huella. Aqui no abrimos onSnapshot duplicado.
  }

  /** Huella ligera para detectar cambios sin serializar todo el array. */
  private huellaUsuarios(arr: any[]): string {
    if (!arr || arr.length === 0) return '0';
    let maxTs = 0;
    for (const u of arr) {
      const t = Math.max(u?.ultimoLatido || 0, u?.ultimaEdicion || 0);
      if (t > maxTs) maxTs = t;
    }
    return `${arr.length}-${maxTs}`;
  }

  // 1. NUEVO: OBTENER LOS DATOS MÁS FRESCOS DEL USUARIO EN VIVO
  // Cacheado: el template lo llama 6+ veces por render. Antes hacía .find()
  // en cientos de usuarios cada vez. Ahora solo recalcula si cambia la
  // versión de `usuarios()` o el `currentUser?.usuario`.
  private _cacheLiveUserVersion = -1;
  private _cacheLiveUserKey = '';
  private _cacheLiveUser: any = null;
  get liveUser() {
    if (!this.currentUser) return null;
    const v = this.usuarios().length;
    const k = this.currentUser.usuario || '';
    if (v === this._cacheLiveUserVersion && k === this._cacheLiveUserKey) {
      return this._cacheLiveUser;
    }
    this._cacheLiveUserVersion = v;
    this._cacheLiveUserKey = k;
    const usuarioFresco = this.usuarios().find(u => u.usuario === this.currentUser.usuario);
    this._cacheLiveUser = usuarioFresco || this.currentUser;
    return this._cacheLiveUser;
  }

  // 2. getAdmins: el admin global ve a TODOS los admins.
  //    Un admin limitado ve:
  //      - A si mismo (siempre, para poder editar su propio perfil).
  //      - A los admins globales (porque cubren todas las sucursales, incluida la suya).
  //      - A otros admins limitados con AL MENOS una sucursal en comun.
  //    La seguridad de no poder EDITAR a otros admins ya esta en abrirEditarUsuario(),
  //    asi que cambiar visibilidad aqui no rompe el anti-escalada.
  getAdmins() {
    const yo = this.liveUser;
    const termino = this.terminoBusqueda.toLowerCase();
    const matchTexto = (u: any) =>
      u.nombre.toLowerCase().includes(termino) ||
      (u.cargo && u.cargo.toLowerCase().includes(termino));

    const admins = this.usuarios().filter(u => u.rol === 'admin' && matchTexto(u));

    // Admin global: ve todos
    if (esAdminGlobal(yo)) return admins;

    // No-admin: no ve administradores (mismo comportamiento que antes para trabajadores/jefes)
    if (!esAdmin(yo)) return [];

    // Admin limitado: solo veo otros admins con AL MENOS UNA sucursal literalmente
    // coincidente con las mias. No incluyo a admins globales ni a "General (Acceso Total)"
    // porque la idea es ver solo a pares de mi misma zona, no a "todos los que pueden todo".
    // Excepcion: si yo mismo tengo "General (Acceso Total)" entonces si veo a todos.
    const misSucursales: string[] = yo?.sucursales || [];
    const misSucNorm = new Set(misSucursales.map(s => normalizarNombre(s)));
    const generalNorm = normalizarNombre('General (Acceso Total)');
    const yoSoyGeneral = misSucNorm.has(generalNorm);

    if (yoSoyGeneral) return admins; // si mi acceso es a todas las sucursales, veo a todos

    return admins.filter(a => {
      if (a.usuario === yo?.usuario) return true;           // yo mismo siempre
      const susSucursales: string[] = a.sucursales || [];
      return susSucursales.some(s => misSucNorm.has(normalizarNombre(s)));
    });
  }

  /**
   * Lista base de trabajadores (permisos del admin + búsqueda), SIN filtro de
   * tab. Cacheada por huella para que getTrabajadores y getTrabajadoresIgnorandoTab
   * no dupliquen el trabajo, y para que tampoco se rehaga en cada change
   * detection si nada cambió.
   */
  private _cacheBaseHuella = '';
  private _cacheBaseTrabajadores: any[] = [];
  private getBaseTrabajadores(): any[] {
    const huella = `${this.usuarios().length}-${this.terminoBusqueda}-${this.currentUser?.usuario || ''}`;
    if (huella === this._cacheBaseHuella) return this._cacheBaseTrabajadores;
    this._cacheBaseHuella = huella;

    const yo = this.liveUser;
    let lista = this.usuarios().filter(u => u.rol === 'trabajador');

    // FILTRO ESTRICTO EN VIVO PARA ADMINS LIMITADOS Y JEFES / ENCARGADOS
    if (!esAdminGlobal(yo)) {
      const misSucursales = yo?.sucursales || [];
      const misAreas = yo?.areas || [];
      // Si no le asignaste ninguna zona ni área, por seguridad NO VE A NADIE
      if (misSucursales.length === 0 && misAreas.length === 0) {
        this._cacheBaseTrabajadores = [];
        return [];
      }
      // Normalizamos para tolerar diferencias de tildes/mayusculas/espacios
      // entre el nombre de sucursal en el perfil del admin y en el del trabajador.
      // Ej: 'Yurecuaro' vs 'Yurécuaro', 'Padre Hidalgo' vs 'padre hidalgo '.
      const misSucNorm = new Set(misSucursales.map((s: string) => normalizarNombre(s)));
      const misAreaNorm = new Set(misAreas.map((a: string) => normalizarNombre(a)));
      const yoSoyGlobalSucursal = misSucNorm.has(normalizarNombre('General (Acceso Total)'));
      const yoSoyGlobalArea = misAreaNorm.has(normalizarNombre('Todas las áreas')) || misAreaNorm.has(normalizarNombre('Todas'));

      lista = lista.filter(emp => {
        const empSucursales = emp.sucursales || [emp.sucursal || ''];
        const empAreas = emp.areas || [];
        const coincideSucursal = yoSoyGlobalSucursal
          || empSucursales.some((s: string) => misSucNorm.has(normalizarNombre(s)));
        // Filtro de área: solo se aplica cuando AMBOS lados declaran áreas.
        const exigeArea = misAreas.length > 0 && empAreas.length > 0;
        const coincideArea = !exigeArea || yoSoyGlobalArea
          || empAreas.some((a: string) => misAreaNorm.has(normalizarNombre(a)));
        return coincideSucursal && coincideArea;
      });
    }

    // Buscador de texto
    const t = this.terminoBusqueda.toLowerCase().trim();
    if (t) {
      lista = lista.filter(u =>
        u.nombre.toLowerCase().includes(t) ||
        (u.cargo && u.cargo.toLowerCase().includes(t)) ||
        (u.sucursales && u.sucursales.join(' ').toLowerCase().includes(t)) ||
        (u.areas && u.areas.join(' ').toLowerCase().includes(t))
      );
    }
    this._cacheBaseTrabajadores = lista;

    // Diagnostico: si soy admin limitado, tengo sucursales asignadas y aun asi
    // termine con 0 trabajadores, dejamos rastro en consola para depurar nombres.
    if (lista.length === 0 && !esAdminGlobal(yo) && (yo?.sucursales?.length || yo?.areas?.length)) {
      const trabajadoresTotales = this.usuarios().filter(u => u.rol === 'trabajador').length;
      console.warn('[personal] No se encontraron trabajadores en tus sucursales. ' +
        `Total trabajadores en sistema: ${trabajadoresTotales}. ` +
        `Tus sucursales: ${JSON.stringify(yo?.sucursales)}. ` +
        'Verifica que los nombres de sucursales coincidan entre los perfiles (revisa tildes y mayusculas).');
    }

    return lista;
  }

  // getTrabajadores: admins globales ven todos. Admins limitados y jefes
  // solo ven trabajadores de sus sucursales/áreas + filtro de tab activo.
  getTrabajadores() {
    const base = this.getBaseTrabajadores();
    if (this.vistaNivel === 'todos') return base;
    return base.filter(u => nivelDeUsuario(u) === this.vistaNivel);
  }

  /** Alias usado por los contadores de tabs (sin filtro de tab). */
  private getTrabajadoresIgnorandoTab(): any[] {
    return this.getBaseTrabajadores();
  }
  contadorTrabajadoresTodos(): number {
    return this.getTrabajadoresIgnorandoTab().length;
  }
  contadorTrabajadoresNivel(nivel: NivelJerarquico): number {
    return this.getTrabajadoresIgnorandoTab().filter(u => nivelDeUsuario(u) === nivel).length;
  }

  /**
   * Sub-agrupa por sucursal y, dentro de cada sucursal, separa mandos y
   * operativos en dos sub-bloques. Cacheado por huella (length base + tab):
   * el template lo invoca como `*ngFor="let grupo of getTrabajadoresAgrupados()"`
   * y eso lo evalúa en cada change detection. Antes hacía 1 forEach + Array.from
   * + 3 ordenamientos en cada CD, ahora solo si los datos cambian.
   */
  private _cacheAgrupadosHuella = '';
  private _cacheAgrupados: any[] = [];
  getTrabajadoresAgrupados() {
    const trabajadores = this.getTrabajadores();
    const huella = `${trabajadores.length}-${this.vistaNivel}-${this._cacheBaseHuella}`;
    if (huella === this._cacheAgrupadosHuella) return this._cacheAgrupados;
    this._cacheAgrupadosHuella = huella;

    const gruposMap = new Map<string, any[]>();
    trabajadores.forEach(user => {
      const nombreGrupo = user.sucursales?.length > 0 ? user.sucursales.join(' y ') : 'Sin Sucursal';
      if (!gruposMap.has(nombreGrupo)) gruposMap.set(nombreGrupo, []);
      gruposMap.get(nombreGrupo)!.push(user);
    });

    const orden = (a: any, b: any) =>
      (a.cargo || '').localeCompare(b.cargo || '') ||
      (a.nombre || '').localeCompare(b.nombre || '');
    this._cacheAgrupados = Array.from(gruposMap.keys()).map(key => {
      const todos = gruposMap.get(key)!;
      const mandos = todos.filter(u => nivelDeUsuario(u) === 'mando');
      const operativos = todos.filter(u => nivelDeUsuario(u) === 'operativo');
      // Mandos primero (ordenados por cargo y nombre), luego operativos.
      const usuarios = [...mandos.sort(orden), ...operativos.sort(orden)];
      return { nombre: key, usuarios, mandos, operativos };
    });
    return this._cacheAgrupados;
  }

  /** Helper para el template — saber si una tarjeta es de mando, para el badge. */
  esMando(user: any): boolean { return nivelDeUsuario(user) === 'mando'; }

  /** trackBy para los *ngFor largos — usa idFirestore/usuario/nombre. Evita
   *  destruir y recrear todo el DOM cuando solo cambia un campo de un item. */
  trackByUser(_: number, u: any): any { return u?.idFirestore || u?.usuario || u?.nombre || _; }
  trackByGrupo(_: number, g: any): any { return g?.nombre || _; }

  verHistorial(nombreEmpleado: string) {
    this.router.navigate(['/reportes'], { queryParams: { empleado: nombreEmpleado } });
  }

  abrirModal() {
    if (this.currentUser?.rol !== 'admin' && !this.currentUser?.puedeAdministrarPersonal) return;
    this.usuarioEnEdicion = null;
    this.limpiarForm();
    this.isModalOpen = true;
  }

  limpiarForm() {
    this.formNombre = ''; this.formUsuario = ''; this.formCorreo = ''; this.formPassword = '';
    this.passwordActual = ''; this.verPasswordActual = false;
    this.formRol = 'trabajador'; this.formCargo = 'Trabajador General';
    this.formPuestoId = '';
    this.formPuedeCrearChecklists = false;
    this.formPuedeCrearRutinas = false;
    this.formPuedeCrearTareasUnicas = false;
    this.formPuedeVerCheckstore = false;
    this.formPuedeVerEstadisticas = false;
    this.formPuedeVerHistorial = false;
    this.formPuedeAdministrarPersonal = false;
    this.formPuedeVerCalendario = false; // 🔥 SE LIMPIA
    this.formSucursales = [];
    this.formAreas = [];
    this.formPuedeAdministrarAreas = false;
    this.formAlcance = 'global'; // 🔥 Por defecto los admins nuevos son globales
    this.formGrupoTec = false;
    this.formPromocionesFormato = false;
    this.formPromocionesExpediente = false;
  }

  editarUsuario(user: any) {
  if (this.currentUser?.rol !== 'admin' && !this.currentUser?.puedeAdministrarPersonal) return;

  // 🔒 SEGURIDAD: un admin limitado NO puede editar a otros admins (ni globales ni limitados),
  // salvo a sí mismo. Solo el admin global edita admins.
  const yo = this.liveUser;
  const esOtroAdmin = user.rol === 'admin' && user.usuario !== yo?.usuario;
  if (esAdminLimitado(yo) && esOtroAdmin) {
    Swal.fire({
      icon: 'warning',
      title: 'Acción restringida',
      text: 'Tu alcance está limitado a sucursales: no puedes editar a otros administradores.',
      confirmButtonColor: '#0F172A'
    });
    return;
  }

  this.usuarioEnEdicion = user;

  this.formNombre    = user.nombre;
  this.formUsuario   = user.usuario;
  this.formCorreo    = user.correo   || '';
  // El campo de contraseña arranca VACIO al editar, y vacío significa "no la
  // cambies".
  //
  // Antes se precargaba con la contraseña actual, y ahí estaba el problema: el
  // input tiene maxlength=6 y casi todas las contraseñas son de 6 caracteres, o
  // sea que el campo llegaba lleno hasta el tope. Al hacer clic y teclear, el
  // navegador no dejaba escribir NADA; el campo seguía mostrando los mismos
  // puntitos, el valor no cambiaba y el guardado concluía que no se quería tocar
  // la contraseña. Resultado: decía "guardado" y la persona seguía entrando con
  // la de antes, sin un solo error a la vista.
  //
  // La contraseña actual se sigue pudiendo consultar en la ficha (`user.password`)
  // para soporte; simplemente ya no se mete en el campo de captura.
  this.formPassword  = '';
  this.passwordActual = user.password || '';
  this.formTelefono  = user.telefono || ''; // 🔥 FIX: cargaba vacío antes
  this.formRol       = user.rol;
  this.formCargo     = user.cargo    || 'Trabajador General';
  // 🎯 Puesto: si nunca se capturó, se precarga el que se deduce del cargo
  // viejo para que el admin solo tenga que confirmarlo, no adivinarlo.
  this.formPuestoId  = resolverPuesto(user).puestoId || '';
  this.formSucursales = user.sucursales ? [...user.sucursales] : [];
  this.formAreas      = user.areas      ? [...user.areas]      : [];
  this.formAlcance    = user.alcance === 'sucursales' ? 'sucursales' : 'global';

  this.formPuedeAdministrarAreas    = !!user.puedeAdministrarAreas;
  this.formPuedeCrearChecklists     = !!user.puedeCrearChecklists;
  this.formPuedeCrearRutinas        = !!user.puedeCrearRutinas;
  this.formPuedeCrearTareasUnicas   = !!user.puedeCrearTareasUnicas;
  this.formPuedeVerCheckstore       = !!user.puedeVerCheckstore;
  this.formPuedeVerEstadisticas     = !!user.puedeVerEstadisticas;
  this.formPuedeVerHistorial        = !!user.puedeVerHistorial;
  this.formPuedeAdministrarPersonal = !!user.puedeAdministrarPersonal;
  this.formPuedeVerCalendario       = !!user.puedeVerCalendario;
  this.formGrupoTec                 = !!user.grupoTec;
  // Las cuentas de antes del cambio traen solo `grupoPromociones`, que daba
  // todo: se muestran con los dos oficios prendidos, que es lo que hoy pueden.
  this.formPromocionesFormato       = !!(user.promocionesFormato    ?? user.grupoPromociones);
  this.formPromocionesExpediente    = !!(user.promocionesExpediente ?? user.grupoPromociones);
  this.formGrupoPagos               = !!user.grupoPagos;
  this.formGrupoTickets             = !!user.grupoTickets;
  this.formVentaPromosCaja          = !!user.ventaPromosCaja;
  this.formVentaPromosVendedor      = !!user.ventaPromosVendedor;
  this.formVentaPromosMonitor       = !!user.ventaPromosMonitor;

  this.isModalOpen = true;
}

  /**
   * ¿Puedo cambiar el alcance/sucursales del usuario que estoy editando?
   * Reglas:
   *  - El admin global siempre puede.
   *  - Un admin limitado NUNCA puede cambiar su propio alcance (anti-escalada).
   *  - Un admin limitado tampoco puede cambiar alcance de otros admins.
   *  - Por defecto los trabajadores los puede editar cualquier admin.
   */
  puedeEditarAlcanceActual(): boolean {
    const yo = this.liveUser;
    if (esAdminGlobal(yo)) return true;
    if (this.formRol !== 'admin') return true; // editando un trabajador
    return false; // admin limitado editando admin: no
  }

  cerrarModal() { this.isModalOpen = false; this.usuarioEnEdicion = null; this.formTelefono = ''; }

  // ===================== ESPACIO TEC: gestión de miembros =====================
  /** Panel desplegable de miembros del Espacio TEC. */
  mostrarPanelTec = false;
  togglePanelTec() { this.mostrarPanelTec = !this.mostrarPanelTec; }

  /** Menú "Más acciones" (agrupa los botones secundarios de la barra superior). */
  accionesMenuAbierto = false;
  toggleAccionesMenu() { this.accionesMenuAbierto = !this.accionesMenuAbierto; }
  cerrarAccionesMenu() { this.accionesMenuAbierto = false; }

  /** Usuarios con el privilegio `grupoTec` activo (los que ven el apartado). */
  get miembrosTec(): any[] {
    return this.usuarios()
      .filter(u => u?.grupoTec === true)
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
  }

  /** Quita el acceso al Espacio TEC (grupoTec: false) sin abrir el modal completo. */
  async quitarAccesoTec(user: any) {
    if (this.currentUser?.rol !== 'admin' && !this.currentUser?.puedeAdministrarPersonal) return;
    const r = await Swal.fire({
      title: 'Quitar acceso al Espacio TEC',
      html: `¿Quitarle el acceso a <strong>${user?.nombre || user?.usuario || 'este usuario'}</strong>? Dejará de ver el apartado. Conserva su acceso normal.`,
      icon: 'warning', showCancelButton: true, confirmButtonText: 'Sí, quitar', cancelButtonText: 'Cancelar', confirmButtonColor: '#DC2626'
    });
    if (!r.isConfirmed) return;
    const docId = user?.idFirestore || user?.uid || user?.id || user?.usuario;
    if (!docId) { Swal.fire({ icon: 'error', title: 'No se pudo identificar al usuario', confirmButtonColor: '#0F172A' }); return; }
    try {
      await setDoc(doc(this.firestore, 'usuarios', docId), { grupoTec: false }, { merge: true });
      await this.api.patch('/api/usuarios', { id: docId, grupoTec: false }).catch(e => console.error('[personal] sync PG', e));
      this.usuariosSvc.refrescar();
      Swal.fire({ icon: 'success', title: 'Acceso quitado', timer: 1400, showConfirmButton: false });
    } catch (e) {
      console.error('[personal] quitarAccesoTec', e);
      Swal.fire({ icon: 'error', title: 'No se pudo quitar el acceso', confirmButtonColor: '#0F172A' });
    }
  }

  toggleSucursal(sucursal: string) {
    const index = this.formSucursales.indexOf(sucursal);
    if (index > -1) this.formSucursales.splice(index, 1);
    else this.formSucursales.push(sucursal);
  }

  toggleArea(area: string) {
    const index = this.formAreas.indexOf(area);
    if (index > -1) this.formAreas.splice(index, 1);
    else this.formAreas.push(area);
  }


  async guardarUsuario() {
    if (this.currentUser?.rol !== 'admin' && !this.currentUser?.puedeAdministrarPersonal) return;

    // La contraseña solo es obligatoria al CREAR. Al editar, el campo vacío
    // significa "déjale la que ya tiene".
    if (!this.formNombre || !this.formUsuario || (!this.usuarioEnEdicion && !this.formPassword)) {
      Swal.fire({ icon: 'warning', title: 'Datos Incompletos', text: 'Por favor completa el Nombre, Usuario y Contraseña.', confirmButtonColor: '#0F172A' });
      return;
    }
    if (!this.usuarioEnEdicion && !this.formCorreo) {
      Swal.fire({ icon: 'warning', title: 'Falta el Correo', text: 'Para crear un usuario nuevo el Correo Electrónico es obligatorio.', confirmButtonColor: '#0F172A' });
      return;
    }

    // 🔒 Anti-escalada: admin limitado editándose a sí mismo no puede subirse a global
    const yo = this.liveUser;
    const esYoMismo = this.usuarioEnEdicion?.usuario === yo?.usuario;
    let alcanceFinal: 'global' | 'sucursales' = this.formAlcance;
    if (this.formRol === 'admin' && esAdminLimitado(yo) && esYoMismo && alcanceFinal === 'global') {
      Swal.fire({
        icon: 'error',
        title: 'Acción restringida',
        text: 'No puedes cambiar tu propio alcance de "Por sucursales" a "Global". Pídelo al administrador principal.',
        confirmButtonColor: '#0F172A'
      });
      return;
    }

    // Si el rol es trabajador, el alcance se ignora (siempre 'global' implícito en BD)
    if (this.formRol !== 'admin') alcanceFinal = 'global';

    // Para admin: definir sucursales y áreas según alcance
    const esAdminGlobalNuevo = this.formRol === 'admin' && alcanceFinal === 'global';
    const esAdminLimitadoNuevo = this.formRol === 'admin' && alcanceFinal === 'sucursales';

    // Validación: admin limitado debe tener al menos UNA sucursal
    if (esAdminLimitadoNuevo && this.formSucursales.length === 0) {
      Swal.fire({
        icon: 'warning',
        title: 'Asigna al menos una sucursal',
        text: 'Un administrador con alcance limitado necesita tener al menos una sucursal asignada.',
        confirmButtonColor: '#0F172A'
      });
      return;
    }

    const sucursalesFinal = esAdminGlobalNuevo
      ? ['General (Acceso Total)']
      : this.formSucursales;

    const areasFinal = esAdminGlobalNuevo
      ? ['Todas las áreas']
      : this.formAreas;

    const payload = {
      // ⚠️ Por decisión del cliente, guardamos también la contraseña como "espejo"
      // visible para el admin global desde el panel de Usuarios. La autenticación
      // real sigue siendo Firebase Auth (hasheada). Riesgo asumido: si la base se
      // filtra, las contraseñas quedan expuestas. Mitigado por Firestore Rules.
      // Si el campo se dejó vacío (editar sin cambiar la contraseña), se conserva
      // la que ya tenía: si no, el espejo se borraría y el admin perdería la
      // referencia de soporte sin haber pedido nada.
      nombre: this.formNombre, usuario: this.formUsuario, correo: this.formCorreo,
      password: String(this.formPassword || '').trim() ? this.formPassword : this.passwordActual,
      rol: this.formRol, cargo: this.formCargo, telefono: this.formTelefono,
      puestoId: this.formPuestoId || null,
      alcance: alcanceFinal,
      puedeCrearChecklists: this.formRol === 'admin' ? true : this.formPuedeCrearChecklists,
      puedeCrearRutinas: this.formRol === 'admin' ? true : this.formPuedeCrearRutinas,
      puedeCrearTareasUnicas: this.formRol === 'admin' ? true : this.formPuedeCrearTareasUnicas,
      puedeVerCheckstore: this.formRol === 'admin' ? true : this.formPuedeVerCheckstore,
      puedeVerEstadisticas: this.formRol === 'admin' ? true : this.formPuedeVerEstadisticas,
      puedeVerHistorial: this.formRol === 'admin' ? true : this.formPuedeVerHistorial,
      puedeAdministrarPersonal: this.formRol === 'admin' ? true : this.formPuedeAdministrarPersonal,
      puedeVerCalendario: this.formRol === 'admin' ? true : this.formPuedeVerCalendario,
      sucursales: sucursalesFinal,
      areas: areasFinal,
      puedeAdministrarAreas: this.formRol === 'admin' ? true : this.formPuedeAdministrarAreas,
      // 🎓 Acceso al Espacio TEC (privilegio que SUMA el apartado en el menú).
      // El usuario conserva su acceso normal; sigue apareciendo en el directorio
      // y en las asignaciones. Solo ve "Espacio TEC" si esto está en true.
      grupoTec: this.formGrupoTec === true,
      // 🏷️ "Activación de promociones": dos permisos separados, y NINGUNO se le
      // regala al admin por ser admin. El servidor los vuelve a revisar contra
      // la base en cada escritura (api/_promo-acceso.js), así que esconder un
      // switch aquí no es el candado: es solo la parte visible.
      promocionesFormato: this.formPromocionesFormato === true,
      promocionesExpediente: this.formPromocionesExpediente === true,
      // La bandera vieja se sigue escribiendo como la SUMA de las dos: es la que
      // miran las sesiones que todavía no se han vuelto a firmar. Se puede
      // quitar cuando ya nadie traiga sesión de antes del cambio.
      grupoPromociones: this.formPromocionesFormato === true || this.formPromocionesExpediente === true,
      // 🧾 Acceso a "Pagos de servicios". A diferencia de los de arriba, el rol
      // admin entra aunque no tenga la bandera: es un módulo con avisos
      // automáticos por WhatsApp y el administrador debe poder apagarlos.
      grupoPagos: this.formGrupoPagos === true,
      // 🎫 Acceso a "Tickets" (vale de servicio operativo). Igual que Pagos: el
      // rol admin entra aunque no tenga la bandera.
      grupoTickets: this.formGrupoTickets === true,
      // 🟢 "Venta de Promos": tres permisos separados, y NINGUNO se le regala al
      // admin por ser admin. Es lo pedido: la sección aparece solo en las
      // cuentas a las que se le prenda aquí a mano. El servidor los vuelve a
      // revisar contra la base en cada escritura (api/promos-venta.js).
      ventaPromosCaja: this.formVentaPromosCaja === true,
      ventaPromosVendedor: this.formVentaPromosVendedor === true,
      ventaPromosMonitor: this.formVentaPromosMonitor === true,
    };

    // Se avisa al final si la copia de respaldo no se pudo hacer. El guardado sí
    // quedó (Postgres), pero conviene decirlo en vez de fingir que todo salió.
    let respaldoFallo = false;

    try {
      if (this.usuarioEnEdicion) {
        const docId = this.usuarioEnEdicion.idFirestore || this.usuarioEnEdicion.uid || this.usuarioEnEdicion.usuario;
        const auth = getAuth();
        const userAuth = auth.currentUser;
        const esElMismoUsuario = this.usuarioEnEdicion.usuario === this.currentUser.usuario;
        const correoDistinto = this.formCorreo !== this.usuarioEnEdicion.correo;
        // Se cambia la contraseña SOLO si se escribió algo en el campo (que al
        // editar arranca vacío). Antes esto se decidía comparando el campo con la
        // contraseña guardada, y como el campo venía precargado y topado por
        // maxlength, no se podía escribir encima: la comparación daba "iguales" y
        // el cambio se saltaba en silencio.
        // Basta con que se haya escrito algo. NO se compara contra la contraseña
        // guardada en la ficha a propósito: ese "espejo" y la contraseña real de
        // Firebase pueden estar desincronizados (de hecho lo estaban), así que
        // volver a escribir la misma tiene que servir para forzar el cambio.
        const passwordDistinta = String(this.formPassword || '').trim().length > 0;

        // -------------------------------------------------------
        // 🔥 FIX 1: CAMBIO DE CORREO (solo si es el mismo usuario)
        // -------------------------------------------------------
        if (esElMismoUsuario && correoDistinto && userAuth) {
          // Pedimos su contraseña ACTUAL para reautenticar antes de cambiar correo
          const { value: passActual } = await Swal.fire({
            title: 'Confirma tu Identidad',
            text: 'Para cambiar tu correo, ingresa tu contraseña actual:',
            input: 'password',
            inputPlaceholder: '••••••••',
            icon: 'info',
            showCancelButton: true,
            confirmButtonColor: '#0F172A',
            confirmButtonText: 'Confirmar'
          });
          if (!passActual) return;

          try {
            // Reautenticamos con la contraseña actual
            const credential = EmailAuthProvider.credential(userAuth.email!, passActual);
            await reauthenticateWithCredential(userAuth, credential);

            // verifyBeforeUpdateEmail manda un correo de verificación al NUEVO correo
            // El cambio se aplica cuando el usuario haga clic en ese correo
            await verifyBeforeUpdateEmail(userAuth, this.formCorreo);

            Swal.fire({
              icon: 'info',
              title: 'Verifica tu nuevo correo',
              text: `Se envió un correo de verificación a "${this.formCorreo}". El cambio se aplicará cuando hagas clic en el enlace. Por ahora se guarda el correo nuevo en tu perfil.`,
              confirmButtonColor: '#0F172A'
            });
          } catch (error: any) {
            if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
              Swal.fire({ icon: 'error', title: 'Contraseña Incorrecta', text: 'La contraseña que ingresaste no es correcta.', confirmButtonColor: '#0F172A' });
              return;
            }
            throw error;
          }
        } else if (!esElMismoUsuario && correoDistinto) {
          Swal.fire({
            icon: 'error',
            title: 'Acción Restringida',
            text: 'No puedes cambiarle el correo de acceso a otro trabajador. Si perdió su correo, elimina su cuenta y créale una nueva.',
            confirmButtonColor: '#0F172A'
          });
          return;
        }

        // -------------------------------------------------------
        // CAMBIO DE CONTRASEÑA
        //
        // Antes esto solo servía cuando el admin se editaba a SÍ MISMO, porque
        // updatePassword del SDK del navegador no puede cambiarle la contraseña
        // a otra persona. Con cualquier otro usuario el bloque se saltaba sin
        // avisar: se guardaba el campo "password" de la ficha (que es nada más
        // un espejo para que el admin la vea) y el trabajador seguía entrando
        // con la de antes. De ahí el "cambio la contraseña y no funciona".
        //
        // Ahora lo hace el servidor con el SDK de administrador, que sí puede
        // cambiar la de cualquiera, y si algo falla lo dice en lugar de callarse.
        // -------------------------------------------------------
        if (passwordDistinta) {
          if (String(this.formPassword || '').length < 6) {
            Swal.fire({
              icon: 'error',
              title: 'Contraseña muy corta',
              text: 'Debe tener al menos 6 caracteres.',
              confirmButtonColor: '#0F172A'
            });
            return;
          }
          // El id de acceso es el uid; docId puede venir del nombre de usuario.
          const idAcceso = this.usuarioEnEdicion.uid || this.usuarioEnEdicion.id || docId;
          try {
            await this.api.post('/api/cambiar-password', { id: idAcceso, password: this.formPassword });
          } catch (error: any) {
            Swal.fire({
              icon: 'error',
              title: 'No se pudo cambiar la contraseña',
              text: error?.message || 'Inténtalo de nuevo. No se guardaron los cambios.',
              confirmButtonColor: '#0F172A'
            });
            return;
          }
          if (esElMismoUsuario) {
            await Swal.fire({
              icon: 'info',
              title: 'Cambiaste tu propia contraseña',
              text: 'Con la siguiente vez que entres, usa la nueva.',
              confirmButtonColor: '#0F172A'
            });
          }
        }

        // Postgres es el bueno: va PRIMERO y si falla se detiene el guardado.
        // Antes iba al final y con un .catch que se comía el error, así que un
        // fallo del respaldo abortaba todo y un fallo del guardado real pasaba
        // desapercibido. Estaba exactamente al revés.
        await this.api.patch('/api/usuarios', { id: docId, ...payload });

        // Firestore quedó como respaldo de la migración. Si sus reglas dicen no
        // (o la sesión de Firebase se venció), NO debe tumbar el guardado: se
        // anota y se sigue. De aquí salía el "Missing or insufficient
        // permissions" que dejaba los permisos sin guardar en ningún lado.
        if (!await this.copiarRespaldoFirestore(docId, payload, this.usuarioEnEdicion?.usuario)) {
          respaldoFallo = true;
        }

      } else {
        // 🔥 FIX CRÍTICO: createUserWithEmailAndPassword desloguea al admin actual
        // (cambia auth.currentUser al nuevo usuario). Eso rompe los listeners,
        // hace que el Swal de "Guardado" no salga y la UI se queda colgada.
        // Solución: crear una segunda app Firebase TEMPORAL solo para esta acción,
        // así NO tocamos la sesión del admin principal.
        const tempAppName = 'AdminCreateUser_' + Date.now();
        const tempApp = initializeApp(firebaseConfig, tempAppName);
        try {
          const tempAuth = getAuthSecondary(tempApp);
          const creds = await createUserSecondary(tempAuth, this.formCorreo, this.formPassword);
          // Igual que al editar: primero el guardado de verdad (Postgres), y el
          // respaldo en Firestore como algo que puede fallar sin tumbar nada.
          await this.api.post('/api/usuarios', { id: creds.user.uid, ...payload, uid: creds.user.uid });
          if (!await this.copiarRespaldoFirestore(creds.user.uid, { ...payload, uid: creds.user.uid })) {
            respaldoFallo = true;
          }
          // Cerramos sesión y limpiamos la app temporal — el admin sigue logueado normal.
          await signOutSecondary(tempAuth);
        } finally {
          await deleteApp(tempApp);
        }
      }

      this.cerrarModal();
      this.usuariosSvc.refrescar(); // refresca la lista compartida (ya no es en vivo)
      Swal.fire(respaldoFallo
        ? {
          icon: 'success', title: '¡Guardado!', confirmButtonColor: '#0F172A',
          text: 'El usuario se guardó y los permisos ya aplican. La copia de respaldo no se pudo hacer, pero eso no afecta la operación.'
        }
        : {
          icon: 'success', title: '¡Guardado!',
          text: 'El usuario se ha guardado correctamente.', confirmButtonColor: '#0F172A'
        });

    }
    catch (error: any) {
      Swal.fire({ icon: 'error', title: 'Error', text: error.message || 'Error desconocido', confirmButtonColor: '#0F172A' });
    }
  }

  /**
   * Copia el usuario al respaldo de Firestore. Devuelve false si no se pudo.
   *
   * Firestore es lo que quedó de antes de la migración: el login y el perfil ya
   * salen de Postgres. Sus reglas preguntan si eres admin leyendo tu documento EN
   * FIRESTORE, así que cualquier desajuste ahí (o una sesión de Firebase vencida)
   * contesta "Missing or insufficient permissions". Eso no tiene por qué impedir
   * guardar un permiso, así que aquí se anota y se sigue.
   */
  private async copiarRespaldoFirestore(docId: string, payload: any, usuarioAnterior?: string): Promise<boolean> {
    try {
      await setDoc(doc(this.firestore, 'usuarios', docId), payload, { merge: true });
      await this.guardarIndiceLogin(payload.usuario, payload.correo, docId, usuarioAnterior);
      return true;
    } catch (e) {
      console.warn('[personal] no se pudo copiar al respaldo de Firestore', e);
      return false;
    }
  }

  /**
   * Mantiene el índice público mínimo `indice_login/{usuario}` → { correo, uid }.
   * Es lo único legible sin autenticación: permite que el login resuelva el correo
   * a partir del usuario SIN exponer la colección `usuarios` completa.
   */
  private async guardarIndiceLogin(usuario: string, correo: string, uid: string, usuarioAnterior?: string) {
    if (!usuario || !correo) return;
    const key = usuario.trim().toLowerCase();
    await setDoc(doc(this.firestore, 'indice_login', key), { correo, uid });
    // Si cambió el nombre de usuario, borramos la entrada vieja del índice.
    if (usuarioAnterior && usuarioAnterior.trim().toLowerCase() !== key) {
      try { await deleteDoc(doc(this.firestore, 'indice_login', usuarioAnterior.trim().toLowerCase())); } catch {}
    }
  }

  /**
   * Genera el índice de login para TODOS los usuarios existentes.
   * El admin lo ejecuta UNA vez (mientras las reglas aún permiten leer usuarios)
   * antes de activar las reglas estrictas. Después, cada guardado lo mantiene solo.
   */
  async sincronizarIndiceLogin() {
    if (this.currentUser?.rol !== 'admin') {
      Swal.fire({ icon: 'error', title: 'Solo administradores', text: 'No tienes permiso para esta acción.', confirmButtonColor: '#0F172A' });
      return;
    }
    const confirma = await Swal.fire({
      title: 'Sincronizar índice de login',
      text: 'Generará el índice usuario→correo para que todos puedan iniciar sesión con las nuevas reglas de seguridad. Ejecútalo una vez.',
      icon: 'question', showCancelButton: true,
      confirmButtonText: 'Sincronizar', cancelButtonText: 'Cancelar', confirmButtonColor: '#0F172A'
    });
    if (!confirma.isConfirmed) return;

    let ok = 0, sin = 0;
    for (const u of this.usuarios()) {
      const usuario = (u.usuario || '').trim();
      const correo = (u.correo || '').trim();
      const uid = u.uid || u.idFirestore || '';
      if (!usuario || !correo) { sin++; continue; }
      try {
        await setDoc(doc(this.firestore, 'indice_login', usuario.toLowerCase()), { correo, uid });
        ok++;
      } catch { sin++; }
    }
    Swal.fire({
      icon: 'success', title: 'Índice sincronizado',
      html: `Listos: <strong>${ok}</strong><br>Omitidos (sin usuario/correo): <strong>${sin}</strong>`,
      confirmButtonColor: '#0F172A'
    });
  }

  // ==========================================================================
  //  🎯 PUESTOS DEL ORGANIGRAMA 2026
  // ==========================================================================

  // ── 📋 Importación de puestos desde la nómina (un solo uso) ──────────────

  /** ¿Está abierta la vista previa del cruce con la nómina? */
  mostrarImportarNomina = false;

  abrirImportarNomina() { this.mostrarImportarNomina = true; }

  /**
   * Escribe los puestos que la vista previa dejó aprobados.
   *
   * Va uno por uno con el mismo dual-write que usa el resto de esta pantalla
   * (Firestore de respaldo + Postgres, que es de donde lee la app). No se hace
   * en paralelo a propósito: son ~180 escrituras y lanzarlas todas de golpe
   * contra el serverless termina en peticiones abortadas y un resultado a
   * medias que nadie sabría cómo reparar.
   */
  async aplicarCambiosNomina(cambios: CambioPuesto[]) {
    this.mostrarImportarNomina = false;
    if (!cambios.length) return;

    Swal.fire({
      title: 'Guardando puestos…',
      html: `0 de ${cambios.length}`,
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });

    let ok = 0;
    const fallidos: string[] = [];
    for (const c of cambios) {
      const docId = c.usuario.idFirestore || c.usuario.uid || c.usuario.id;
      if (!docId) { fallidos.push(c.usuario.nombre || '(sin id)'); continue; }

      // `cargo` se mantiene sincronizado con el nombre del puesto porque media
      // app lo sigue leyendo (buscador, reportes, Excel, nivel jerárquico).
      const campos: any = { puestoId: c.puestoId, cargo: c.cargo };
      if (c.sucursal) campos.sucursales = [c.sucursal];

      try {
        await this.api.patch('/api/usuarios', { id: docId, ...campos });
        // El respaldo de Firestore es best-effort: si falla, el dato bueno ya
        // quedó en Postgres, que es de donde la app lee.
        await setDoc(doc(this.firestore, 'usuarios', docId), campos, { merge: true })
          .catch(e => console.error('[nomina] respaldo Firestore', c.usuario.nombre, e));
        ok++;
      } catch (e) {
        console.error('[nomina] no se pudo guardar', c.usuario.nombre, e);
        fallidos.push(c.usuario.nombre || docId);
      }
      Swal.update({ html: `${ok + fallidos.length} de ${cambios.length}` });
    }

    this.usuariosSvc.refrescar();

    Swal.fire({
      icon: fallidos.length ? 'warning' : 'success',
      title: fallidos.length ? 'Guardado con pendientes' : 'Puestos asignados',
      html: `Se guardaron <strong>${ok}</strong> de <strong>${cambios.length}</strong>.` +
            (fallidos.length
              ? `<br><br>No se pudieron guardar ${fallidos.length}:<br>` +
                `<small style="color:#94a3b8">${fallidos.slice(0, 12).join(', ')}` +
                `${fallidos.length > 12 ? '…' : ''}</small>` +
                `<br><br>Vuelve a correr la importación: los que ya quedaron no se repiten.`
              : `<br><br>Revisa <em>Cobertura de puestos</em> para ver qué falta.`),
      confirmButtonColor: '#0F172A',
    });
  }

  /** Los puestos agrupados por unidad, para pintar el selector con optgroups. */
  gruposPuestos = puestosPorUnidad();

  /**
   * Al elegir un puesto, `cargo` se sincroniza con su nombre oficial.
   *
   * Es a propósito: `cargo` es el campo que llevan años leyendo el buscador, los
   * reportes, el Excel y el cálculo de nivel jerárquico. Si el puesto y el cargo
   * se separaran, la ficha diría una cosa y los reportes otra.
   */
  alCambiarPuesto() {
    const p = puestoPorId(this.formPuestoId);
    if (p) this.formCargo = p.nombre;
  }

  /** El manual ligado al puesto que está seleccionado en el formulario. */
  manualDelPuestoForm() {
    return manualDePuesto(this.formPuestoId);
  }

  /** Cuántas tareas automáticas recibirá quien tenga el puesto seleccionado. */
  tareasDelPuestoForm(): number {
    return tareasAutomaticasDePuesto(this.formPuestoId).length;
  }

  /** Nombre del puesto de un usuario de la lista, resuelto (explícito o por alias). */
  puestoDe(u: any): string {
    const r = resolverPuesto(u);
    return r.puesto ? r.puesto.nombre : '';
  }

  /** ¿El puesto de esta persona se está deduciendo del cargo viejo? */
  puestoEsPorAlias(u: any): boolean {
    return resolverPuesto(u).origen === 'alias';
  }

  /**
   * Reporte de cobertura de puestos.
   *
   * Es el tablero que hay que dejar en cero después del cambio: mientras alguien
   * aparezca "sin puesto", esa persona NO está recibiendo las tareas de su
   * manual, y el silencio es el peor síntoma posible. Se resuelve abriendo su
   * ficha y eligiendo su puesto.
   */
  async revisarCoberturaPuestos() {
    const lista = this.usuarios().filter(u => u.activo !== false);
    const sinPuesto = usuariosSinPuesto(lista);
    const porAlias = usuariosConPuestoPorAlias(lista);
    const conManual = lista.filter(u => {
      const id = resolverPuesto(u).puestoId;
      return id && tareasAutomaticasDePuesto(id).length > 0;
    });

    const filas = (arr: any[], extra?: (u: any) => string) => arr.length === 0
      ? '<tr><td colspan="3" style="padding:8px;color:#94a3b8">Ninguno 🎉</td></tr>'
      : arr.map(u => `<tr>
          <td style="padding:4px 8px;text-align:left">${u.nombre || '(sin nombre)'}</td>
          <td style="padding:4px 8px;color:#94a3b8;text-align:left">${u.cargo || '—'}</td>
          <td style="padding:4px 8px;text-align:left">${extra ? extra(u) : ''}</td>
        </tr>`).join('');

    Swal.fire({
      title: 'Cobertura de puestos',
      width: 780,
      html: `
        <div style="text-align:left;font-size:13px">
          <p style="margin:0 0 14px">
            <b>${conManual.length}</b> de <b>${lista.length}</b> personas activas están recibiendo
            tareas de su Manual Corporativo.
          </p>

          <h4 style="margin:14px 0 6px;color:#B91C1C">Sin puesto (${sinPuesto.length}) — no reciben nada</h4>
          <p style="margin:0 0 6px;color:#64748b">Abre su ficha y elige su puesto del organigrama.</p>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <tr style="color:#64748b"><th style="text-align:left;padding:4px 8px">Nombre</th><th style="text-align:left;padding:4px 8px">Cargo capturado</th><th></th></tr>
            ${filas(sinPuesto)}
          </table>

          <h4 style="margin:18px 0 6px;color:#B45309">Puesto deducido del cargo viejo (${porAlias.length})</h4>
          <p style="margin:0 0 6px;color:#64748b">Funcionan, pero conviene confirmarlos con el selector: si alguien reescribe el cargo, dejan de resolver.</p>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <tr style="color:#64748b"><th style="text-align:left;padding:4px 8px">Nombre</th><th style="text-align:left;padding:4px 8px">Cargo capturado</th><th style="text-align:left;padding:4px 8px">Se lee como</th></tr>
            ${filas(porAlias.map(x => x.usuario), u => nombrePuesto(resolverPuesto(u).puestoId))}
          </table>
        </div>`,
      confirmButtonColor: '#0F172A',
      confirmButtonText: 'Cerrar',
    });
  }

  /**
   * Migración de cargos de Prevención: renombra "Auxiliar Prevención" →
   * "Auxiliar de Prevención" y "Coordinador Prevención" → "Coordinador de Prevención"
   * en los perfiles que aún tengan el valor antiguo. Para correr una sola vez.
   */
  async migrarCargosPrevencion() {
    if (this.currentUser?.rol !== 'admin') {
      Swal.fire({ icon: 'error', title: 'Solo administradores', text: 'No tienes permiso para esta acción.', confirmButtonColor: '#0F172A' });
      return;
    }
    const mapa: Record<string, string> = {
      'Auxiliar Prevención': 'Auxiliar de Prevención',
      'Coordinador Prevención': 'Coordinador de Prevención'
    };
    const pendientes = this.usuarios().filter(u => mapa[u.cargo]);
    if (pendientes.length === 0) {
      Swal.fire({ icon: 'success', title: 'Nada que migrar', text: 'Todos los cargos de Prevención ya están actualizados.', confirmButtonColor: '#0F172A' });
      return;
    }
    const listaHtml = pendientes.map(u =>
      `<tr><td style="padding:4px 8px;text-align:left">${u.nombre}</td><td style="padding:4px 8px;color:#94a3b8">${u.cargo}</td><td style="padding:4px 8px;color:#10B981">→ ${mapa[u.cargo]}</td></tr>`
    ).join('');
    const confirma = await Swal.fire({
      title: `Migrar ${pendientes.length} cargo(s)`,
      html: `<table style="margin:0 auto;font-size:13px">${listaHtml}</table>`,
      icon: 'question', showCancelButton: true,
      confirmButtonText: 'Migrar', cancelButtonText: 'Cancelar', confirmButtonColor: '#0F172A',
      width: 600
    });
    if (!confirma.isConfirmed) return;

    let ok = 0, fail = 0;
    for (const u of pendientes) {
      const docId = u.uid || u.idFirestore;
      if (!docId) { fail++; continue; }
      try {
        await setDoc(doc(this.firestore, 'usuarios', docId), { cargo: mapa[u.cargo] }, { merge: true });
        await this.api.patch('/api/usuarios', { id: docId, cargo: mapa[u.cargo] }).catch(e => console.error('[personal] sync PG cargo', e));
        ok++;
      } catch { fail++; }
    }
    Swal.fire({
      icon: 'success', title: 'Migración completada',
      html: `Actualizados: <strong>${ok}</strong>${fail > 0 ? `<br>Errores: <strong style="color:#EF4444">${fail}</strong>` : ''}`,
      confirmButtonColor: '#0F172A'
    });
  }

  /**
   * 🔍 Verifica coherencia entre los nombres de los usuarios y los nombres
   * que aparecen en el campo `assigned` de los checklists activos.
   *
   * Si el `nombre` del perfil no coincide con el `assigned` de las tareas,
   * el trabajador no ve sus tareas (porque el filtro compara por nombre).
   * Aquí mostramos los desajustes para que el admin pueda corregir.
   */
  async verificarCoherenciaNombres() {
    if (this.currentUser?.rol !== 'admin' && !this.currentUser?.puedeAdministrarPersonal) {
      Swal.fire({ icon: 'error', title: 'Sin permiso', confirmButtonColor: '#0F172A' });
      return;
    }
    Swal.fire({ title: 'Verificando…', allowOutsideClick: false, didOpen: () => Swal.showLoading(null) });

    try {
      // Últimos 7 días, no eliminados, no enviados (lo realmente "vivo")
      const offset = new Date().getTimezoneOffset() * 60000;
      const hace7 = new Date(Date.now() - offset);
      hace7.setDate(hace7.getDate() - 7);
      const desdeISO = hace7.toISOString().split('T')[0];
      // FERROCARRIL Etapa 3: checklists desde Postgres
      const resp = await this.api.get('/api/checklists?desde=' + encodeURIComponent(desdeISO));
      const filas: any[] = resp?.checklists || [];

      // Sucursales del admin actual (si es limitado/global)
      const permitidasUser = sucursalesPermitidas(this.currentUser);

      // Indexar usuarios por nombre normalizado (solo trabajadores y supervisores)
      const usuariosVisibles = this.usuarios().filter(u => u.rol === 'trabajador' && (
        permitidasUser === null ||
        (u.sucursales || []).some((s: string) => permitidasUser.includes(s))
      ));
      const nombresPerfil = new Map<string, any>(); // nombreNorm → user
      for (const u of usuariosVisibles) {
        nombresPerfil.set(normalizarNombre(u.nombre), u);
      }

      // Recolectar assigned únicos de los checklists relevantes
      const tareasPorAssigned = new Map<string, { sucursales: Set<string>, total: number }>();
      filas.forEach((c: any) => {
        if (c.eliminado === true || c.enviado === true || c.archivado === true) return;
        if (permitidasUser !== null && !permitidasUser.includes(c.store)) return;
        const a = (c.assigned || '').trim();
        if (!a) return;
        const entrada = tareasPorAssigned.get(a) || { sucursales: new Set<string>(), total: 0 };
        entrada.sucursales.add(c.store);
        entrada.total++;
        tareasPorAssigned.set(a, entrada);
      });

      // Detectar mismatches: assigned que no coincide con ningún nombre del perfil
      const huerfanos: { assigned: string, sucursales: string[], total: number }[] = [];
      for (const [assigned, info] of tareasPorAssigned.entries()) {
        if (!nombresPerfil.has(normalizarNombre(assigned))) {
          huerfanos.push({ assigned, sucursales: Array.from(info.sucursales), total: info.total });
        }
      }
      huerfanos.sort((a, b) => b.total - a.total);

      // Detectar usuarios sin tareas (su nombre no aparece en ningún assigned)
      const sinTareas: any[] = [];
      for (const u of usuariosVisibles) {
        const norm = normalizarNombre(u.nombre);
        const tieneAlguna = Array.from(tareasPorAssigned.keys())
          .some(a => normalizarNombre(a) === norm);
        if (!tieneAlguna) sinTareas.push(u);
      }

      Swal.close();

      if (huerfanos.length === 0 && sinTareas.length === 0) {
        Swal.fire({
          icon: 'success', title: '✅ Todo coherente',
          text: `Los nombres de ${usuariosVisibles.length} trabajadores coinciden con sus tareas.`,
          confirmButtonColor: '#0F172A'
        });
        return;
      }

      // Armar HTML con la tabla de problemas
      const escHtml = (s: any) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      let html = '<div style="text-align:left; font-size: 13px; max-height: 400px; overflow-y: auto;">';

      if (huerfanos.length > 0) {
        html += `<h4 style="color:#B91C1C; margin: 8px 0;">⚠️ ${huerfanos.length} nombre(s) en tareas SIN perfil que coincida:</h4>`;
        html += '<table style="width:100%; border-collapse:collapse;">';
        html += '<tr style="background:#FEE2E2;"><th style="padding:6px; border:1px solid #FCA5A5;">Assigned</th><th style="padding:6px; border:1px solid #FCA5A5;">Tareas</th><th style="padding:6px; border:1px solid #FCA5A5;">Sucursal</th></tr>';
        for (const h of huerfanos) {
          html += `<tr><td style="padding:6px; border:1px solid #FCA5A5;"><strong>${escHtml(h.assigned)}</strong></td>`;
          html += `<td style="padding:6px; border:1px solid #FCA5A5; text-align:center;">${h.total}</td>`;
          html += `<td style="padding:6px; border:1px solid #FCA5A5;">${escHtml(h.sucursales.join(', '))}</td></tr>`;
        }
        html += '</table>';
      }

      if (sinTareas.length > 0) {
        html += `<h4 style="color:#92400E; margin: 12px 0 8px;">⏸ ${sinTareas.length} usuario(s) SIN tareas asignadas:</h4>`;
        html += '<ul style="margin: 0; padding-left: 20px;">';
        for (const u of sinTareas) {
          html += `<li><strong>${escHtml(u.nombre)}</strong> <small style="color:#64748B;">(${escHtml(u.usuario || '')})</small></li>`;
        }
        html += '</ul>';
      }

      html += '<p style="margin-top: 12px; padding: 8px; background:#F0F9FF; border-left:3px solid #0EA5E9; font-size:12px;">';
      html += '💡 <strong>Cómo arreglar:</strong> edita cada usuario en este panel y pon su <em>nombre</em> exactamente igual al <em>assigned</em> de sus tareas. O al revés: vuelve a generar las tareas con el nombre correcto.';
      html += '</p></div>';

      Swal.fire({
        icon: huerfanos.length > 0 ? 'warning' : 'info',
        title: 'Coherencia nombres ↔ tareas',
        html,
        width: 720,
        confirmButtonColor: '#0F172A'
      });
    } catch (e: any) {
      Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'No se pudo verificar.', confirmButtonColor: '#0F172A' });
    }
  }

  /**
   * 🔄 Auto-corrige los nombres de perfil para que coincidan con el `assigned`
   * de las tareas (que ya están guardadas). Solo aplica casos SEGUROS:
   * cuando el nombre actual del perfil es prefijo exacto del `assigned` de
   * alguna tarea Y hay solo UN perfil candidato (sin ambigüedad).
   *
   * Ejemplos resueltos automáticamente:
   *   "Carolina Guzman"       →  "Carolina Guzman Ruiz"      (faltaba apellido)
   *   "Anna Paola Frausto"    →  "Anna Paola Frausto Nava"
   *   "Maria Isabel Vera"     →  "Maria Isabel Vera Ribera"
   *
   * Los typos (ej. "Benda" → "Brenda") NO se tocan: quedan para revisión manual.
   */
  async autoCorregirCoherenciaNombres() {
    if (this.currentUser?.rol !== 'admin' && !this.currentUser?.puedeAdministrarPersonal) {
      Swal.fire({ icon: 'error', title: 'Sin permiso', confirmButtonColor: '#0F172A' });
      return;
    }
    Swal.fire({ title: 'Analizando…', allowOutsideClick: false, didOpen: () => Swal.showLoading(null) });

    try {
      const offset = new Date().getTimezoneOffset() * 60000;
      const hace7 = new Date(Date.now() - offset);
      hace7.setDate(hace7.getDate() - 7);
      const desdeISO = hace7.toISOString().split('T')[0];
      // FERROCARRIL Etapa 3: checklists desde Postgres
      const resp = await this.api.get('/api/checklists?desde=' + encodeURIComponent(desdeISO));
      const filas: any[] = resp?.checklists || [];

      const permitidasUser = sucursalesPermitidas(this.currentUser);
      const usuariosVisibles = this.usuarios().filter(u => u.rol === 'trabajador' && (
        permitidasUser === null ||
        (u.sucursales || []).some((s: string) => permitidasUser.includes(s))
      ));

      // Mapa: nombreNormalizado → perfil (para verificar si ya existe)
      const perfilesPorNombreNorm = new Map<string, any>();
      for (const u of usuariosVisibles) {
        perfilesPorNombreNorm.set(normalizarNombre(u.nombre), u);
      }

      // Recolectar assigned únicos de checklists activos
      const assignedsHuerfanos = new Set<string>();
      filas.forEach((c: any) => {
        if (c.eliminado === true || c.enviado === true || c.archivado === true) return;
        if (permitidasUser !== null && !permitidasUser.includes(c.store)) return;
        const a = (c.assigned || '').trim();
        if (!a) return;
        if (!perfilesPorNombreNorm.has(normalizarNombre(a))) {
          assignedsHuerfanos.add(a);
        }
      });

      // Buscar matches únicos por PREFIJO
      const sugerencias: { perfil: any, nombreActual: string, nombreNuevo: string }[] = [];
      const ambiguos: string[] = [];
      const sinMatch: string[] = [];

      for (const assigned of assignedsHuerfanos) {
        const assignedNorm = normalizarNombre(assigned);
        const candidatos = usuariosVisibles.filter(u => {
          const n = normalizarNombre(u.nombre);
          if (n.length < 6) return false; // muy corto = riesgo de falsos positivos
          return assignedNorm.startsWith(n + ' '); // el nombre actual es prefijo del completo
        });

        if (candidatos.length === 1) {
          // Verificar que el perfil candidato no esté ya "tomado" por otra sugerencia
          const yaSugerido = sugerencias.some(s => s.perfil.idFirestore === candidatos[0].idFirestore);
          if (!yaSugerido) {
            sugerencias.push({
              perfil: candidatos[0],
              nombreActual: candidatos[0].nombre,
              nombreNuevo: assigned
            });
          } else {
            ambiguos.push(assigned);
          }
        } else if (candidatos.length > 1) {
          ambiguos.push(assigned);
        } else {
          sinMatch.push(assigned);
        }
      }

      Swal.close();

      if (sugerencias.length === 0) {
        Swal.fire({
          icon: 'info', title: 'Sin matches automáticos',
          html: `No se encontraron prefijos exactos.<br>` +
                `<strong>${sinMatch.length}</strong> nombre(s) sin coincidencia, ` +
                `<strong>${ambiguos.length}</strong> ambiguo(s). Revisa manualmente con 🔍 Verificar nombres.`,
          confirmButtonColor: '#0F172A'
        });
        return;
      }

      const escHtml = (s: any) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      let html = '<div style="text-align:left; font-size: 13px; max-height: 380px; overflow-y: auto;">';
      html += `<p>Se actualizarán <strong>${sugerencias.length}</strong> perfiles para que sus nombres coincidan con sus tareas:</p>`;
      html += '<table style="width:100%; border-collapse:collapse;">';
      html += '<tr style="background:#F0FDF4;"><th style="padding:6px; border:1px solid #86EFAC;">Antes</th><th style="padding:6px; border:1px solid #86EFAC;">Después</th></tr>';
      for (const s of sugerencias) {
        html += `<tr><td style="padding:6px; border:1px solid #86EFAC;">${escHtml(s.nombreActual)}</td>`;
        html += `<td style="padding:6px; border:1px solid #86EFAC;"><strong>${escHtml(s.nombreNuevo)}</strong></td></tr>`;
      }
      html += '</table>';
      if (sinMatch.length > 0 || ambiguos.length > 0) {
        html += `<p style="margin-top:10px; font-size:12px; color:#92400E;">⚠ Quedarán <strong>${sinMatch.length + ambiguos.length}</strong> casos para revisión manual (typos, ambiguos, sin perfil).</p>`;
      }
      html += '</div>';

      const ok = await Swal.fire({
        icon: 'question', title: '¿Aplicar correcciones?', html,
        width: 720, showCancelButton: true,
        confirmButtonText: `✅ Aplicar ${sugerencias.length} correcciones`,
        cancelButtonText: 'Cancelar', confirmButtonColor: '#0F172A'
      });
      if (!ok.isConfirmed) return;

      // Aplicar cambios
      Swal.fire({ title: 'Aplicando…', allowOutsideClick: false, didOpen: () => Swal.showLoading(null) });
      let exitosos = 0;
      let fallidos = 0;
      for (const s of sugerencias) {
        try {
          const docId = s.perfil.idFirestore || s.perfil.uid || s.perfil.usuario;
          await setDoc(doc(this.firestore, 'usuarios', docId), { nombre: s.nombreNuevo }, { merge: true });
          await this.api.patch('/api/usuarios', { id: docId, nombre: s.nombreNuevo }).catch(e => console.error('[personal] sync PG nombre', e));
          exitosos++;
        } catch (e) {
          console.error('[autoCorregir]', s.nombreActual, e);
          fallidos++;
        }
      }

      Swal.fire({
        icon: 'success', title: '¡Listo!',
        html: `Corregidos: <strong>${exitosos}</strong>` +
              (fallidos ? `<br>Fallidos: ${fallidos}` : '') +
              (sinMatch.length + ambiguos.length > 0 ? `<br>Para revisar manualmente: ${sinMatch.length + ambiguos.length}` : ''),
        confirmButtonColor: '#0F172A'
      });
    } catch (e: any) {
      Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'No se pudo procesar.', confirmButtonColor: '#0F172A' });
    }
  }

  /**
   * 📡 Envía un push silencioso a todos los dispositivos registrados para que
   * fuercen la activación de la versión nueva (PWA en pantalla de inicio incluida).
   * Llama al endpoint serverless /api/notify-update con el ID Token del admin.
   */
  async notificarActualizacion() {
    if (this.currentUser?.rol !== 'admin') {
      Swal.fire({ icon: 'error', title: 'Solo administradores', text: 'No tienes permiso para enviar el push.', confirmButtonColor: '#0F172A' });
      return;
    }
    const confirma = await Swal.fire({
      title: 'Notificar actualización a todos',
      text: 'Se mandará un push silencioso a todos los dispositivos para que apliquen la versión nueva. Hazlo después de publicar.',
      icon: 'question', showCancelButton: true,
      confirmButtonText: '📡 Notificar', cancelButtonText: 'Cancelar', confirmButtonColor: '#0F172A'
    });
    if (!confirma.isConfirmed) return;

    Swal.fire({ title: 'Enviando…', text: 'Empujando actualización a los dispositivos', allowOutsideClick: false, didOpen: () => Swal.showLoading(null) });
    try {
      const auth = getAuth();
      const user = auth.currentUser;
      if (!user) throw new Error('Sesión no encontrada. Vuelve a iniciar sesión.');
      const idToken = await user.getIdToken();

      const resp = await fetch('/api/notify-update', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' },
        body: '{}'
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || ('HTTP ' + resp.status));

      Swal.fire({
        icon: 'success', title: '¡Listo!',
        html: `Push enviado a <strong>${data.enviados ?? 0}</strong> dispositivos.` +
              (data.fallidos ? `<br>Fallidos: ${data.fallidos}` : '') +
              (data.tokensLimpiados ? `<br>Tokens obsoletos limpiados: ${data.tokensLimpiados}` : ''),
        confirmButtonColor: '#0F172A'
      });
    } catch (e: any) {
      Swal.fire({ icon: 'error', title: 'No se pudo enviar', text: e?.message || 'Error desconocido', confirmButtonColor: '#0F172A' });
    }
  }

// 🔥 FUNCIÓN PARA ELIMINAR USUARIO 🔥
  async eliminarUsuario(usuarioParaBorrar: any) {
    // 1. Verificamos que tengas los permisos
    if (this.currentUser?.rol !== 'admin' && !this.currentUser?.puedeAdministrarPersonal) {
      Swal.fire({ icon: 'error', title: 'Acceso Denegado', text: 'No tienes permiso para eliminar personal.', confirmButtonColor: '#0F172A' });
      return;
    }

    // 2. Pedimos confirmación de seguridad
    const confirmacion = await Swal.fire({
      title: '¿Estás seguro?',
      text: `Se eliminará permanentemente al usuario ${usuarioParaBorrar.nombre}. Esta acción no se puede deshacer.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#EF4444', // Rojo
      cancelButtonColor: '#0F172A',  // Azul oscuro
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    });

    // 3. Si dice que sí, lo borramos de Firestore
    if (confirmacion.isConfirmed) {
      try {
        const docId = usuarioParaBorrar.idFirestore || usuarioParaBorrar.uid || usuarioParaBorrar.usuario;
        
        // deleteDoc ya lo tienes importado arriba, así que esto funcionará directo
        await deleteDoc(doc(this.firestore, 'usuarios', docId));
        await this.api.del('/api/usuarios?id=' + encodeURIComponent(docId)).catch(e => console.error('[personal] sync PG borrar', e));
        this.usuariosSvc.refrescar();

        // Sácalo de las asignaciones de rutinas "por personas" para que el robot
        // no le siga generando tareas fantasma que nadie puede completar/enviar.
        const quitadas = await this.limpiarAsignacionesDe(usuarioParaBorrar.nombre);

        const extra = quitadas > 0
          ? ` Se le quitó de ${quitadas} ${quitadas === 1 ? 'asignación de rutina' : 'asignaciones de rutina'}. Revisa si alguna quedó sin responsable y reasígnala.`
          : '';
        Swal.fire({ icon: 'success', title: '¡Eliminado!', text: 'El usuario ha sido eliminado de la base de datos.' + extra, confirmButtonColor: '#0F172A' });
      } catch (error: any) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'Hubo un problema al eliminar al usuario: ' + error.message, confirmButtonColor: '#0F172A' });
      }
    }
  }

  /**
   * Quita a una persona (por nombre) de las asignaciones de rutinas "por personas".
   * Si una asignación se queda sin nadie, se desactiva (activa:false) para que el
   * robot no la procese. Devuelve cuántas asignaciones se modificaron.
   */
  private async limpiarAsignacionesDe(nombre: string): Promise<number> {
    if (!nombre) return 0;
    try {
      // FERROCARRIL: asignaciones_rutinas desde Postgres (resp.items)
      const resp = await this.api.get('/api/asignaciones-rutinas');
      const items: any[] = resp?.items || [];
      let modificadas = 0;
      for (const a of items) {
        if (a.modoAsignacion !== 'porPersonas' || !Array.isArray(a.empleadosNombres)) continue;
        const restantes = a.empleadosNombres.filter((n: string) => !mismoEmpleadoNombre(n, nombre));
        if (restantes.length === a.empleadosNombres.length) continue; // no estaba
        const cambios: any = { empleadosNombres: restantes };
        if (restantes.length === 0) cambios.activa = false;
        await setDoc(doc(this.firestore, 'asignaciones_rutinas', a.id), cambios, { merge: true });
        // FERROCARRIL: dual-write del merge a Postgres
        await this.api.parchar('/api/asignaciones-rutinas', a.id, cambios);
        modificadas++;
      }
      return modificadas;
    } catch (e) {
      console.error('[personal] limpiarAsignacionesDe', e);
      return 0;
    }
  }

  async descargarExcel() {
    const list = this.usuarios();
    if (list.length === 0) {
      Swal.fire({ icon: 'info', title: 'Lista Vacía', text: 'No hay personal para exportar.', confirmButtonColor: '#0F172A' });
      return;
    }

    // Loading toast mientras se descarga el chunk de ExcelJS (~700 KB la primera vez).
    Swal.fire({
      title: 'Generando Excel...',
      text: 'Descargando el módulo de exportación, espera un momento.',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    const listaOrdenada = list.map(u => {
      const zona = u.sucursales ? (Array.isArray(u.sucursales) ? u.sucursales.join(' - ') : u.sucursales) : 'General';
      return { ...u, zonaCalculada: zona };
    }).sort((a, b) => a.zonaCalculada.localeCompare(b.zonaCalculada));

    try {
      // ExcelJS es CommonJS: segun el bundler los exports quedan bajo `.default`
      // o directo en el namespace. Tomamos el que tenga `Workbook` para evitar
      // "Workbook is not a constructor".
      const ExcelJSModule: any = await import('exceljs');
      const ExcelJS: any = ExcelJSModule?.Workbook ? ExcelJSModule
        : (ExcelJSModule?.default?.Workbook ? ExcelJSModule.default : (ExcelJSModule?.default ?? ExcelJSModule));
      if (typeof ExcelJS?.Workbook !== 'function') {
        throw new Error('ExcelJS.Workbook no disponible tras el import');
      }
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Personal MegaDulces');

      worksheet.columns = [
        { header: 'Nombre Completo', key: 'nombre', width: 35 },
        { header: 'Usuario', key: 'usuario', width: 20 },
        { header: 'Correo Electrónico', key: 'correo', width: 35 },
        { header: 'Rol', key: 'rol', width: 15 },
        { header: 'Cargo', key: 'cargo', width: 25 },
        { header: 'Sucursales', key: 'sucursales', width: 30 },
        { header: 'Áreas', key: 'areas', width: 30 },
        { header: 'Crea Check', key: 'creaCheck', width: 12 },
        { header: 'Crea Rutinas', key: 'creaRutinas', width: 12 },
        { header: 'Crea Tareas', key: 'creaTareas', width: 12 },
        { header: 'Ve Store', key: 'veStore', width: 12 },
        { header: 'Ve Est.', key: 'veEst', width: 12 },
        { header: 'Ve Hist.', key: 'veHist', width: 12 },
        { header: 'Adm. Pers.', key: 'admPers', width: 12 },
        { header: 'Calendario', key: 'veCal', width: 12 } // 🔥 SE AGREGÓ AL EXCEL
      ];

      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
      headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      headerRow.height = 30;

      let zonaActual = '';

      listaOrdenada.forEach(u => {
        if (u.zonaCalculada !== zonaActual) {
          const separador = worksheet.addRow({ nombre: ` 📍 ZONA / DEPARTAMENTO: ${u.zonaCalculada.toUpperCase()}` });
          worksheet.mergeCells(`A${separador.number}:O${separador.number}`); // Ajustado a O por la nueva columna

          separador.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
          separador.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF475569' } };
          separador.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          separador.height = 25;

          zonaActual = u.zonaCalculada;
        }

        worksheet.addRow({
          nombre: u.nombre || '-',
          usuario: u.usuario || '-',
          correo: u.correo || '-',
          rol: (u.rol || '').toUpperCase(),
          cargo: u.cargo || '-',
          sucursales: u.zonaCalculada,
          areas: u.areas ? (Array.isArray(u.areas) ? u.areas.join(', ') : u.areas) : 'General',
          creaCheck: u.puedeCrearChecklists ? 'Sí' : 'No',
          creaRutinas: u.puedeCrearRutinas ? 'Sí' : 'No',
          creaTareas: u.puedeCrearTareasUnicas ? 'Sí' : 'No',
          veStore: u.puedeVerCheckstore ? 'Sí' : 'No',
          veEst: u.puedeVerEstadisticas ? 'Sí' : 'No',
          veHist: u.puedeVerHistorial ? 'Sí' : 'No',
          admPers: u.puedeAdministrarPersonal ? 'Sí' : 'No',
          veCal: u.puedeVerCalendario ? 'Sí' : 'No' // 🔥 SE AGREGÓ AL EXCEL
        });
      });

      worksheet.eachRow((row: any, rowNumber: number) => {
        row.eachCell((cell: any, colNumber: number) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
          };

          if (rowNumber > 1) {
            const esSeparador = row.getCell(1).value?.toString().includes(' 📍 ZONA');

            if (!esSeparador) {
              if (colNumber >= 8 || colNumber === 4) {
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
              } else {
                cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
              }
            }
          }
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      this.descargarBlob(blob, 'Nomina_Personal_Agrupado.xlsx');
      Swal.close();
    } catch (e: any) {
      // Si ExcelJS no carga/instancia (problema de bundle, red o cache), no
      // dejamos al usuario sin exportar: caemos a CSV con los mismos datos.
      console.error('[descargarExcel] ExcelJS fallo; usando CSV de respaldo:', e);
      try {
        this.exportarPersonalCSV(listaOrdenada);
        Swal.fire({
          icon: 'success',
          title: 'Exportado en CSV',
          text: 'El módulo de Excel no se pudo cargar, así que descargamos un CSV con los mismos datos (se abre en Excel).',
          confirmButtonColor: '#0F172A'
        });
      } catch (e2: any) {
        console.error('[descargarExcel] tambien fallo el CSV:', e2);
        Swal.fire({
          icon: 'error',
          title: 'No se pudo exportar',
          text: 'Intenta recargar la página (Ctrl+Shift+R) y vuelve a darle a Exportar.',
          confirmButtonColor: '#0F172A'
        });
      }
    }
  }

  /** Descarga genérica de un Blob como archivo. */
  private descargarBlob(blob: Blob, nombreArchivo: string) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  /** Fallback robusto: exporta el personal en CSV (UTF-8 con BOM y `sep=,` para
   *  que Excel lo abra correctamente en cualquier idioma). */
  private exportarPersonalCSV(listaOrdenada: any[]) {
    const cols: { header: string; valor: (u: any) => string }[] = [
      { header: 'Nombre Completo',    valor: u => u.nombre || '-' },
      { header: 'Usuario',            valor: u => u.usuario || '-' },
      { header: 'Correo Electronico', valor: u => u.correo || '-' },
      { header: 'Rol',                valor: u => (u.rol || '').toUpperCase() },
      { header: 'Cargo',              valor: u => u.cargo || '-' },
      { header: 'Sucursales',         valor: u => u.zonaCalculada || 'General' },
      { header: 'Areas',              valor: u => u.areas ? (Array.isArray(u.areas) ? u.areas.join(', ') : u.areas) : 'General' },
      { header: 'Crea Check',         valor: u => u.puedeCrearChecklists ? 'Si' : 'No' },
      { header: 'Crea Rutinas',       valor: u => u.puedeCrearRutinas ? 'Si' : 'No' },
      { header: 'Crea Tareas',        valor: u => u.puedeCrearTareasUnicas ? 'Si' : 'No' },
      { header: 'Ve Store',           valor: u => u.puedeVerCheckstore ? 'Si' : 'No' },
      { header: 'Ve Est.',            valor: u => u.puedeVerEstadisticas ? 'Si' : 'No' },
      { header: 'Ve Hist.',           valor: u => u.puedeVerHistorial ? 'Si' : 'No' },
      { header: 'Adm. Pers.',         valor: u => u.puedeAdministrarPersonal ? 'Si' : 'No' },
      { header: 'Calendario',         valor: u => u.puedeVerCalendario ? 'Si' : 'No' },
    ];
    const esc = (v: string) => `"${(v ?? '').toString().replace(/"/g, '""')}"`;
    const lineas: string[] = ['sep=,', cols.map(c => esc(c.header)).join(',')];
    for (const u of listaOrdenada) {
      lineas.push(cols.map(c => esc(c.valor(u))).join(','));
    }
    const contenido = '﻿' + lineas.join('\r\n');
    const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8;' });
    this.descargarBlob(blob, 'Nomina_Personal.csv');
  }

  togglePassword() {
      this.mostrarPassword = !this.mostrarPassword;
    }
  }
