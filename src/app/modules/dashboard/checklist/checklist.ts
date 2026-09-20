import { Component, signal, OnInit, OnDestroy, inject, effect } from '@angular/core';
import { UsuariosService } from '../../../shared/usuarios.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { Firestore, doc, setDoc, deleteDoc } from '@angular/fire/firestore';
import * as localforage from 'localforage';
import Swal from 'sweetalert2';
import { esAdminGlobal, esAdminLimitado, sucursalesPermitidas, alcanceCubre, esSupervisor, mismoEmpleadoNombre, existeEmpleadoEnUsuarios, normalizarNombre, puedeSerAsignado } from '../../../shared/permisos.util';
import { pasaFiltroTransversal } from '../../../shared/area-transversal.util';
import { nivelDeCargo } from '../../../shared/nivel-jerarquico.util';
import { TareaEquipo, FaseEquipo, ItemEquipo, SubtareaEquipo } from '../../../shared/tareas-equipo.types';
import { esItemHecho, tieneEvidencia } from '../../../shared/item-completado.util';
import { esEntregaDeManual } from '../../../shared/origen-manual.util';
import { filtrarPorBusqueda } from '../../../shared/filtro-busqueda.util';
import {
  agruparEntregas, mostrarEncabezadoSucursal, mostrarEncabezadoPersona,
  ModoAgrupacion, GrupoSucursal
} from '../../../shared/agrupacion-entregas.util';
import { obtenerSemanaISO, obtenerNombreDia } from '../../../shared/descansos.util';
import { RobotManualService, ExplicacionManual } from '../../../shared/robot-manual.service';
import { resolverPuesto } from '../../../shared/puesto.util';
import { AmbitoVisible, ambitoVisible, entregaVisible } from '../../../shared/rama-visible.util';
import { nombrePuesto } from '../../../shared/organigrama.catalogo';
import {
  tareasAutomaticasDePuesto, MANUALES_POR_PUESTO, tareaManualPorId, TareaManual,
} from '../../../shared/tareas-manual.catalogo';
import { NotificacionesService } from '../../../services/notificaciones';
import { ApiService } from '../../../shared/api.service';
import { comprimirImagenSiAplica } from '../../../shared/imagen.util';
import { ConfigTurnos, EvaluacionTurno, evaluarAsignacion, etiquetaTurno } from '../../../shared/turnos.util';
import { resolverAsignadoTarea, mapaNombreAUid } from '../../../shared/reasignacion-turnos.util';
import {
  guardarListaCache, leerListaCacheConEdad, textoAntiguedad
} from '../../../shared/lista-cache.util';
import { avisoDeFalla, AvisoDatos } from '../../../shared/aviso-datos.util';
import {
  limiteDeItem, urgenciaDeChecklist, textoUrgencia, Urgencia, ClaseUrgencia,
} from '../../../shared/urgencia-tarea.util';
import {
  MOTIVOS_SIN_PRUEBA, MotivoSinPrueba, motivoCompleto, sellarMotivo,
} from '../../../shared/motivo-sin-prueba.util';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { PanelResponsablesComponent } from './panel-responsables';
import { VistaOrganigramaComponent } from './vista-organigrama';

@Component({
  selector: 'app-checklist',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent, PanelResponsablesComponent, VistaOrganigramaComponent],
  templateUrl: './checklist.html',
  styleUrls: ['./checklist.css']
})
export class ChecklistComponent implements OnInit, OnDestroy {
  ultimaHoraNotificada: number = -1;
  cantidadPendientesAnterior: number = -1;
  notificarPorWhatsApp: boolean = true;
  notificarPorCorreo: boolean = false;
  isModalActividadIntegranteOpen = false;
  integranteActualIndex: number = -1;
  formItemsActividad: any[] = [];
  fasesTemporalesIntegrante: any[] = [];
  nuevaFaseIntegranteTexto: string = '';
  isMenuOpen = false;
  isEditandoTarea = false;
  // ID del doc de checklist que se está editando (modo edición de Tarea Única).
  editandoChecklistId: string | null = null;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }
  pasoEquipo = 1;
  nombreTareaEquipo = '';
  metaGlobalEquipo = 100;
  integrantesAsignados: any[] = [];
  currentUser: any = null;
  vistaActual = signal<'lista' | 'detalle'>('lista');
  checklistSeleccionado = signal<any>(null);
  terminoBusquedaChecklist = '';
  toastMessage = '';
  integrantesEquipo: any[] = [];
  empleadoSeleccionadoEquipo: string = '';
  mostrarDropdownEquipo: boolean = false;
  isModalEquipoOpen = false;
  notificacionesPendientes = signal<any[]>([]);
  isModalNotificacionOpen = false;
  empleadoParaNotificar = '';
  mensajeNotificacion = '';

  // ⏰ Modal de justificante de retraso (se abre al enviar si hay tareas vencidas)
  isModalJustificanteOpen = false;
  justificanteCategoria: 'Falla de equipo' | 'Falta de personal' | 'Cliente complicado' | 'Otro' | '' = '';
  justificanteComentario = '';
  readonly categoriasJustificante: string[] = [
    'Falla de equipo',
    'Falta de personal',
    'Cliente complicado',
    'Otro'
  ];

  isModalOpen = false;
  formName = '';
  busquedaEmpleadoEquipo: string = '';
  nuevaFaseTexto: string = '';
  fasesTemporales: any[] = [];
  formAssigned: string[] = [];
  formStore = '';

  // ============================================================================
  // Campos extra que aparecen SOLO cuando formStore === 'MANTENIMIENTO'.
  // Permiten capturar orden de servicio: donde esta el problema, que tipo, ubicacion
  // exacta dentro de la sucursal, prioridad y foto del problema antes de intervenir.
  // Se guardan como sub-objeto `mantenimiento` en el doc del checklist.
  // ============================================================================
  formMantSucursalOrigen: string = '';
  formMantTipo: string = '';
  formMantUbicacion: string = '';
  formMantPrioridad: 'urgente' | 'normal' | 'noUrgente' = 'normal';
  formMantFoto: string = '';
  formMantFotoSubiendo: boolean = false;
  tiposMantenimiento: string[] = [
    'Eléctrico', 'Plomería', 'Refrigeración', 'Aire acondicionado',
    'Pintura', 'Carpintería', 'Limpieza profunda', 'Equipo de cómputo', 'Otro'
  ];
  /** Sucursales operativas donde puede ESTAR el problema (excluye Mantenimiento y "ADMINISTRADORES DEL SISTEMA"). */
  sucursalesParaMantenimientoOrigen: string[] = [
    'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
    'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro',
    'OFICINAS CORPORATIVAS', 'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD',
    'FINANZAS', 'SISTEMAS', 'RH', 'MKT'
  ];
  formItems: any[] = [{
    text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false,
    permiteGaleria: false, permiteDocumentos: false, tiempoEstimado: 60,
    fechaInicio: '', horaInicio: '', fechaLimite: '', horaLimite: '',
    date: '', time: ''
  }];
  isModalRutinasOpen = false;
  isEditMode = false;
  // 📝 Originales antes de editar — para poder borrar el molde viejo aunque
  // el admin cambie el nombre o el asignado en el modal de edición.
  formNameRutinaOriginal = '';
  formAssignedRutinaOriginal = '';
  formNameRutina = '';
  formAssignedRutina: string[] = [];
  formStoreRutina = '';

  // ✅ Reglas de rutina con horaInicio + horaLimite + 📅 fechaInicio + fechaFin
  formRutinas: any[] = [{
    text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false,
    permiteGaleria: false, permiteDocumentos: false, tiempoEstimado: 60,
    frecuencia: 'Diaria', fechaInicio: '', fechaFin: null,
    horaInicio: '', horaLimite: '',
    diaSemana: 'Lunes', diaMes: 1
  }];

  frecuencias = ['Diaria', 'Semanal', 'Catorcenal', 'Mensual', 'Trimestral'];
  diasDelMes = Array.from({ length: 31 }, (_, i) => i + 1);

  isPasswordModalOpen = false;
  passwordInput = '';
  checklistToDelete: any = null;

  checklists = signal<any[]>([]);

  /**
   * 📕 EL EJE DE ORIGEN (Todas · Del manual · Fuera del manual) SE RETIRÓ.
   *
   * Vivió unas horas el 14/sep/2026. Se quitó por instrucción de David sobre
   * una captura de la barra: «solo debe estar Pendientes del equipo · Enviadas
   * del equipo · Mis tareas pendientes · Mis tareas enviadas».
   *
   * El motivo se ve en su propio número: en producción los chips decían
   * `Del manual 112 · Fuera del manual 0`. Un eje cuyo segundo valor es cero en
   * toda la empresa no está separando nada — está cobrando un renglón de barra
   * y una decisión antes de mirar. Y el día que vuelva a haber tareas creadas a
   * mano, la pastilla 🔒 MANUAL de cada tarjeta ya las distingue una por una,
   * que es donde la distinción de verdad importa.
   *
   * Lo que NO se fue con el chip es el candado: `esTareaDeManual` sigue
   * gobernando qué se puede editar y borrar, por tarjeta (invariante §5.4).
   */

  // 📡 true cuando el último poll a la nube falló: la vista sigue mostrando la
  // última lista buena (cache) y enseña un aviso, en vez de una lista vacía que
  // parezca "se borraron las tareas".
  sinConexion = signal<boolean>(false);
  // 📣 Qué dice ese aviso, con el motivo real: falta de internet, sesión vencida
  // o el servidor. Decía "Sin conexión" siempre, aunque hubiera internet.
  aviso = signal<AvisoDatos>({
    titulo: 'Sin conexión',
    detalle: 'Se actualizarán solas al volver el internet.'
  });
  // 🕒 De cuándo son las tareas que se muestran ('hace 5 minutos'). Vacío cuando
  // vienen frescas de la nube. Antes el aviso no aclaraba la antigüedad, y una
  // lista guardada se leía igual que una recién traída.
  edadDatos = signal<string>('');
  // ✉️ true mientras se sube un checklist a la nube: muestra "Enviando…" para
  // que el usuario sepa que su envío está en curso (sobre todo con mala señal) y
  // no crea que la tarea desapareció. Con tope de tiempo para no colgarse.
  enviando = signal<boolean>(false);
  // ── Historial de tareas ENVIADAS (últimos 30 días) ──────────────────────
  // Pestaña aparte dentro del Checklist para consultar lo ya enviado. Se carga
  // bajo demanda (getDocs) la primera vez que se abre, para no gastar lecturas.
  vistaHistorial = signal<'pendientes' | 'enviadas'>('pendientes');
  enviadas = signal<any[]>([]);
  /**
   * El historial, recortado por el MISMO eje que la bandeja: «Enviadas del
   * equipo» son las de los demás y «Mis tareas enviadas» las tuyas.
   *
   * ⚠ HASTA HOY «Enviadas» NO MIRABA DE QUIÉN ERAN. `cargarEnviadas()` aplica
   * el alcance —global ve todo, supervisión su sucursal, colaborador lo suyo—
   * y ahí se acababa: los dos botones de historial habrían mostrado LA MISMA
   * lista, uno de ellos mintiendo en su etiqueta. Es el defecto que tenían las
   * dos pestañas viejas, que solo se ve cuando el nombre del botón se vuelve
   * específico.
   *
   * La condición `puedeFiltrarVista` es la misma que en los pendientes, y por
   * la misma razón: a un colaborador la lista ya le viene recortada a su nombre
   * desde el cargador, así que volver a filtrarla no añade nada y sí podría
   * perderle una tarea por un apellido de más o de menos.
   */
  /**
   * ⚠ Y HASTA EL 17/sep TAMPOCO MIRABA EL BUSCADOR. Reportado por David con
   * una captura: en «Enviadas del equipo» tecleó «la piedad abastos» y las
   * cuatro tarjetas en pantalla eran de **Padre Hidalgo**, con el contador
   * intacto en (94). El `[(ngModel)]` escribía en `terminoBusquedaChecklist`
   * y esta lista nunca leía esa variable — o sea que el buscador funcionaba
   * en Pendientes y no en el historial, que es la peor forma de fallar: no da
   * error, devuelve una lista COMPLETA que se lee como «no hay más
   * resultados».
   *
   * El filtro es el MISMO de los pendientes (`filtrarPorBusqueda`), no una
   * copia: dos reglas de búsqueda serían dos listas distintas para el mismo
   * término según la bandeja, que es el defecto de hoy por la otra puerta.
   */
  private _cacheEnviadasHuella = '';
  private _cacheEnviadas: any[] = [];
  get enviadasFiltradas(): any[] {
    // El historial son ~100 tarjetas y este getter lo consulta la plantilla en
    // cada ciclo de detección. Con cache, filtrar por texto no le cuesta nada
    // a la pantalla; sin él, se recorrería la lista entera por cada tecla.
    const huella = `${this.enviadas().length}-${this.vistaTareas}-${this.terminoBusquedaChecklist}-${this.currentUser?.nombre || ''}`;
    if (huella === this._cacheEnviadasHuella) return this._cacheEnviadas;
    this._cacheEnviadasHuella = huella;

    let lista = this.enviadas();
    if (this.puedeFiltrarVista) {
      const mi = this.currentUser?.nombre;
      const mio = this.vistaTareas === 'mis';
      lista = lista.filter(c => mismoEmpleadoNombre(c.assigned, mi) === mio);
    }
    lista = filtrarPorBusqueda(lista, this.terminoBusquedaChecklist);
    this._cacheEnviadas = lista;
    return lista;
  }

  /** Cuántas enviadas hay antes de la búsqueda. La pantalla lo necesita para
   *  poder decir «0 de 94», que es distinto de «no hay historial». */
  get totalEnviadasSinBuscar(): number {
    const lista = this.enviadas();
    if (!this.puedeFiltrarVista) return lista.length;
    const mi = this.currentUser?.nombre;
    const mio = this.vistaTareas === 'mis';
    return lista.filter(c => mismoEmpleadoNombre(c.assigned, mi) === mio).length;
  }
  cargandoEnviadas = false;
  enviadasCargadas = false;
  empleados = signal<any[]>([]);
  /** Config de turnos de Canindo (manana/tarde). null mientras no carga. */
  configTurnos = signal<ConfigTurnos | null>(null);
  /** Admins globales SIEMPRE disponibles (no se filtran por sucursal). Lo usa
   *  el wizard de Tareas de Equipo para que el admin que arma el proyecto pueda
   *  incluir a la gerencia general como integrante o jefe. No se mezcla en
   *  `empleados()` para no contaminar el wizard normal de checklists. */
  adminsGlobales = signal<any[]>([]);
  sucursalesDisponibles = signal<string[]>([]);
  /** Lista COMPLETA de sucursales operativas (sin filtrar por permisos).
   *  La usa el wizard de "Proyecto en Equipo" del Espacio TEC, donde el grupo
   *  puede armar proyectos para cualquier sucursal aunque no tenga permisos de
   *  checklist en ella. */
  readonly todasLasSucursalesProyecto = [
    'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
    'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro', 'OFICINAS CORPORATIVAS',
    'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD', 'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO', 'CEDIS'
  ];
  // Opciones "abarca-todo" del wizard de Tareas en Equipo. Como valor del <select>
  // usamos la etiqueta misma (se guarda como `store` informativo del proyecto).
  readonly OPCION_TODAS_SUCURSALES = 'Todas las sucursales';
  readonly OPCION_TODO_MEGA = 'Todo Mega Dulces';
  /** Sucursales "tienda" (físicas), para la opción "Todas las sucursales". */
  readonly sucursalesTiendaProyecto = [
    'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
    'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro'
  ];

  // ===== Tareas de Equipo (proyectos colaborativos en fases) =====
  /**
   * 🧹 INTERRUPTOR DE "TAREAS EN EQUIPO" (proyectos por fases)
   *
   * APAGADO a pedido de David el 2026-08-28, junto con la limpieza del menú.
   *
   * PARA VOLVER A PRENDERLO: poner esto en true y desplegar (`railway up`).
   * Nada se borró: la tabla `mdtask_tareas_equipo`, su endpoint, los tipos y
   * TODA la lógica de fases, items, subtareas y cierre siguen completos. Lo
   * único que se apaga es la interfaz y el poll que la alimentaba.
   *
   * Mismo criterio que MOSTRAR_ASISTENTE en app.ts: un apartado que se retira
   * pero se quiere poder recuperar sin reconstruirlo.
   */
  private readonly MOSTRAR_TAREAS_EQUIPO = false;
  /** Lo que consultan las plantillas para saber si pintar algo de equipo. */
  get mostrarTareasEquipo(): boolean { return this.MOSTRAR_TAREAS_EQUIPO; }

  tareasEquipo = signal<TareaEquipo[]>([]);
  tareaEquipoSeleccionada = signal<TareaEquipo | null>(null);
  vistaEquipo = signal<'lista' | 'detalle'>('lista');

  // Wizard de creación de Tarea en Equipo (4 pasos)
  pasoEquipoWizard: 1 | 2 | 3 | 4 = 1;
  equipoFormName = '';
  equipoFormObjetivo = '';
  equipoFormStore = '';
  equipoFormDate = '';
  equipoFormIntegrantes: string[] = [];
  equipoFormJefe = '';
  /** Fases temporales mientras se crea — cada una con un array de items iniciales. */
  equipoFormFases: { id: string; nombre: string; items: { id: string; asignado: string; texto: string; objetivo?: string; horaLimite?: string; requiresPhoto?: boolean; requiresAntesDespues?: boolean; }[] }[] = [];
  equipoBusquedaIntegrante = '';

  // Estado del agregar-en-vivo dentro de una fase activa (vista detalle)
  agregandoEnFaseId: string | null = null;
  nuevoItemAsignado = '';
  nuevoItemTexto = '';
  nuevoItemHoraLimite = '';
  nuevoItemRequiresPhoto = false;
  agregandoSubtareaItemId: string | null = null;
  nuevaSubtareaTexto = '';

  // Auto-tarea del integrante en tareas de equipo (auto-asignada a sí mismo).
  agregandoTareaPropiaFaseId: string | null = null;
  nuevaTareaPropiaTexto = '';
  nuevaTareaPropiaHora = '';

  // "Agregar mi tarea del día": tarea propia/extra que el trabajador suma a su
  // lista diaria de rutinas (checklist auto-asignado para hoy).
  isModalTareaDiaOpen = false;
  tareaDiaTexto = '';
  tareaDiaHora = '';
  /** Si no es null, el modal "mi tarea" esta EDITANDO esta tarea propia (id del checklist). */
  editandoTareaPropiaId: string | null = null;
  /** Actividades (sub-items) de la tarea propia: se vuelven items con casilla. */
  tareaDiaActividades: string[] = [];
  nuevaActividadTexto = '';
  /** Si true, la tarea propia permite adjuntar fotos (varias, cámara o galería),
   *  de forma OPCIONAL (no obliga a subir para marcarla como hecha). */
  tareaDiaPermiteFotos = false;
  // Recurrencia de "mi tarea": 'unica' = solo hoy; o se repite con frecuencia.
  tareaDiaFrecuencia: 'unica' | 'Diaria' | 'Semanal' | 'Mensual' | 'Anual' = 'unica';
  tareaDiaDiaSemana = 1;      // 0=Domingo .. 6=Sabado (para Semanal)
  tareaDiaDiaMes = 1;         // 1..31 (para Mensual)
  tareaDiaFechaAnual = '';    // 'YYYY-MM-DD' (para Anual; se guarda MM-DD)
  readonly diasSemanaOpc = [
    { v: 1, t: 'Lunes' }, { v: 2, t: 'Martes' }, { v: 3, t: 'Miercoles' },
    { v: 4, t: 'Jueves' }, { v: 5, t: 'Viernes' }, { v: 6, t: 'Sabado' }, { v: 0, t: 'Domingo' }
  ];
  /** Tareas recurrentes personales del usuario actual (coleccion rutinas_personales). */
  misRutinasPersonales = signal<any[]>([]);

  // 🩺 Diagnóstico del último snapshot — alimenta el botón "¿Por qué no veo tareas?"
  // en el estado vacío para inspeccionar el filtrado desde el propio móvil.
  ultimoDiagnostico: any = null;

  // 🎯 Tab activo (Mis / Equipo / Todas). Solo aplica a admin o supervisor;
  // un trabajador puro ya ve solo lo suyo.
  /**
   * 🗂️ LA BANDEJA: de quién × en qué estado. Cuatro botones, un solo riel.
   *
   * `vistaTareas` dice DE QUIÉN y `vistaHistorial` EN QUÉ ESTADO. Hasta el
   * 14/sep/2026 eran dos rieles separados y había que combinarlos mentalmente;
   * ahora la barra ofrece las cuatro combinaciones con todas sus letras y estos
   * dos campos son su estado interno, no dos controles.
   *
   * ⚠ EL VALOR INICIAL DEPENDE DE QUIÉN ENTRÓ, y tiene que hacerlo: quien no ve
   * lo de otros solo tiene los dos botones de «mis», así que arrancar en
   * 'equipo' le dejaría los cuatro apagados —una barra sin nada seleccionado, y
   * la lista mostrando algo que ningún botón dice—. Se fija en `ngOnInit`,
   * cuando ya se sabe quién es.
   *
   * 'todas' se conserva como valor posible porque es lo que significa «no
   * filtres por persona», y es lo que usa un colaborador: su lista ya viene
   * recortada a su nombre desde el poll, así que volver a filtrarla no cambia
   * nada y sí podría perder una tarea por un apellido de más.
   */
  vistaTareas: 'mis' | 'equipo' | 'todas' = 'todas';
  cambiarVistaTareas(v: 'mis' | 'equipo' | 'todas') { this.vistaTareas = v; }

  /** ¿Está activo este botón de la bandeja? */
  esBandeja(quien: 'mis' | 'equipo', historial: 'pendientes' | 'enviadas'): boolean {
    const mio = this.vistaTareas === 'mis';
    return (quien === 'mis' ? mio : !mio) && this.vistaHistorial() === historial;
  }

  /**
   * Pulsar uno de los cuatro. Mueve los DOS ejes a la vez, que es justo el
   * punto: antes, cambiar de «Pendientes» a «Enviadas» te dejaba en el «de
   * quién» anterior sin decírtelo.
   */
  cambiarBandeja(quien: 'mis' | 'equipo', historial: 'pendientes' | 'enviadas') {
    this.vistaTareas = quien === 'mis' ? 'mis' : 'equipo';
    this._cacheFiltradosHuella = '';   // la lista depende de este eje
    this.cambiarVistaHistorial(historial);
  }

  get puedeFiltrarVista(): boolean {
    const u = this.currentUser;
    if (!u) return false;
    if (u.rol === 'admin') return true;
    return esSupervisor(u);
  }

  /**
   * 👁️ HASTA DÓNDE VE ESTA PERSONA. Derivado de su puesto en el organigrama.
   *
   * `puedeFiltrarVista` de arriba decide QUIÉN abre la puerta; esto decide QUÉ
   * hay del otro lado. Eran la misma cosa y ese era el defecto: al pasar la
   * puerta se veía la empresa entera, así que una Gerente de Zona abría sus
   * tareas y le caían los 11 chips de unidad, los 25 puestos y las 104 entregas
   * de toda la operación, con «Dirección General» de raíz (captura del 9/sep).
   *
   * OJO: el acceso a la puerta NO se tocó. Ensanchar quién ve el árbol sería
   * una escalada, que es la única dirección verdaderamente peligrosa al mover
   * visibilidad; este cambio solo RECORTA.
   *
   * Memoizado por IDENTIDAD de `currentUser`, no por valor. `ambitoVisible()`
   * construye Sets nuevos en cada llamada, y este getter lo leen la plantilla y
   * `checklistsFiltrados`: sin memo se reconstruiría en cada ciclo de detección
   * de cambios. Es exactamente lo que tumbó el sidebar el 1/sep — allá un
   * arreglo nuevo por llamada recreaba las 21 entradas del menú en cada tick y
   * la app dejaba de alcanzar reposo. Vale porque `currentUser` es un campo
   * plano (`home.ts`), no un getter que fabrique objetos.
   */
  private _ambitoPara: any = undefined;
  private _ambitoCache: AmbitoVisible | null = null;
  get ambito(): AmbitoVisible {
    if (this._ambitoPara !== this.currentUser || !this._ambitoCache) {
      this._ambitoPara = this.currentUser;
      this._ambitoCache = ambitoVisible(this.currentUser);
    }
    return this._ambitoCache;
  }

  /**
   * La frase que explica el recorte, para la pantalla.
   *
   * Un recorte MUDO se lee como un bug: alguien que ayer veía diez sucursales y
   * hoy ve dos, sin una línea que lo diga, reporta «se perdieron mis tiendas».
   * Es la misma regla del bloque con hueco nombrado del tablero (3/sep).
   */
  get motivoAmbito(): string { return this.ambito.motivo; }
  // ⚠ LOS TRES CUENTAN SOBRE EL CHIP DE ORIGEN, y antes no: contaban sobre
  //   `checklists()` entero. Mientras fueron dos pantallas casi no se notaba;
  //   con los chips al lado, un badge que dijera 12 mientras la lista muestra 3
  //   se lee como que la app perdió tareas. Dos números contiguos que hablan de
  //   conjuntos distintos son un error de lectura garantizado.
  //
  //   Lo que NO cuentan es el recorte por ámbito, y eso viene de antes: es la
  //   misma cifra que se enseña hoy. Meterlo aquí sería cambiar dos cosas en el
  //   mismo paso; queda anotado como pendiente.
  get contadorMisChecklists(): number {
    const mi = this.currentUser?.nombre;
    return this.checklists().filter(c => mismoEmpleadoNombre(c.assigned, mi)).length;
  }
  get contadorEquipoChecklists(): number {
    const mi = this.currentUser?.nombre;
    return this.checklists().filter(c => !mismoEmpleadoNombre(c.assigned, mi)).length;
  }
  get contadorTodasChecklists(): number {
    return this.checklists().length;
  }

  // ============================================================================
  //  📕 DAR UNA TAREA DEL CATÁLOGO DEL MANUAL A CUALQUIER TRABAJADOR
  // ============================================================================
  //
  // Instrucción de David (14/sep/2026): «los catálogos que creaste de acuerdo a
  // los puestos, los dejarás creados como un catálogo para poder agregarlo a
  // cualquier trabajador, quiero que le aparezca los usuarios que tiene de
  // acuerdo su sucursal».
  //
  // Es una ENTREGA PUNTUAL: un checklist para UNA fecha, sellado con su
  // documento y su versión, que no vuelve solo al día siguiente. La decisión
  // fue suya entre las dos opciones que se le plantearon; lo permanente
  // —declarar que a esa persona le aplica ese manual— necesita tabla y robot.
  //
  // El payload NO se arma aquí: lo arma `RobotManualService.entregarDelCatalogo`,
  // que reusa las mismas dos funciones que la entrega automática. Dos versiones
  // del sellado de una norma serían dos reglas libres de discrepar en silencio.

  catAbierto = false;
  catStore = '';
  catPersona = '';
  catPersonaUid: string | null = null;
  /** Puesto del que sale la tarea elegida. NO es el puesto de la persona. */
  catPuestoId = '';
  catTareaId = '';
  catFecha = '';
  catBusqueda = '';
  catGuardando = false;
  /** Lo último que pasó, dicho en la misma pantalla y no en un toast que se va. */
  catAviso = '';

  abrirCatalogoManual() {
    if (!(this.currentUser?.rol === 'admin' || this.currentUser?.puedeCrearChecklists)) return;
    this.catAbierto = true;
    this.catAviso = '';
    this.catBusqueda = '';
    this.catTareaId = '';
    this.catPuestoId = '';
    this.catPersona = '';
    this.catPersonaUid = null;
    // Una sola sucursal disponible se elige sola: obligar a pulsar lo único que
    // hay es un paso que no decide nada.
    const suc = this.sucursalesDisponibles();
    this.catStore = suc.length === 1 ? suc[0] : '';
    const off = new Date().getTimezoneOffset() * 60000;
    this.catFecha = new Date(Date.now() - off).toISOString().split('T')[0];
  }

  cerrarCatalogoManual() { this.catAbierto = false; }

  /** Al cambiar de sucursal, la persona elegida deja de tener sentido. */
  catElegirSucursal(s: string) {
    if (this.catStore === s) return;
    this.catStore = s;
    this.catPersona = '';
    this.catPersonaUid = null;
  }

  catElegirPersona(emp: any) {
    this.catPersona = emp?.nombre || '';
    this.catPersonaUid = emp?.id || emp?.uid || null;
  }

  catElegirTarea(puestoId: string, tareaId: string) {
    this.catPuestoId = puestoId;
    this.catTareaId = tareaId;
  }

  /**
   * La gente de esa sucursal, que es lo que David pidió. Se usa el MISMO
   * predicado que el wizard de tareas (`empleadoPerteneceASucursal`), no una
   * comparación de texto nueva: el hallazgo 1 de este proyecto es justamente
   * que la identidad se cruza por nombre, y dos reglas de pertenencia serían
   * dos formas distintas de dejar a alguien fuera en silencio.
   */
  get catEmpleados(): any[] {
    if (!this.catStore) return [];
    return this.empleados()
      .filter(emp => this.empleadoPerteneceASucursal(emp, this.catStore))
      .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')));
  }

  /**
   * El catálogo, agrupado por puesto. Sale de `MANUALES_POR_PUESTO`, que es la
   * transcripción de los documentos: nunca una lista local (§4).
   */
  get catGrupos(): { puestoId: string; puesto: string; documento: string; tareas: TareaManual[] }[] {
    const term = normalizarNombre(this.catBusqueda || '');
    const grupos: { puestoId: string; puesto: string; documento: string; tareas: TareaManual[] }[] = [];
    for (const m of MANUALES_POR_PUESTO) {
      for (const pid of m.puestoIds) {
        // Solo las que el robot entrega por calendario: una `soloPorEvento` se
        // dispara por un hecho (un siniestro, un cambio de custodia), y darla a
        // mano por fecha sería inventar el evento.
        const tareas = m.tareas.filter(t => !t.soloPorEvento).filter(t => {
          if (!term) return true;
          return normalizarNombre([nombrePuesto(pid), m.documento, t.nombre].join(' ')).includes(term);
        });
        if (tareas.length) {
          grupos.push({ puestoId: pid, puesto: nombrePuesto(pid), documento: m.documento, tareas });
        }
      }
    }
    return grupos.sort((a, b) => a.puesto.localeCompare(b.puesto));
  }

  /** Cuántas tareas quedan con el filtro puesto. Lo usa el estado vacío. */
  get catTotalVisible(): number {
    return this.catGrupos.reduce((n, g) => n + g.tareas.length, 0);
  }

  /**
   * ⚠ ¿ESTA PERSONA YA RECIBE ESTA TAREA SOLA?
   *
   * Si la tarea es de SU propio puesto, el robot ya se la entrega los días que
   * toque. Asignarla a mano no rompe nada —la llave de idempotencia es la
   * misma, así que no se duplica— pero es un clic que no hace nada, y sin
   * decirlo quien asigna se queda creyendo que hizo algo.
   */
  catYaLaRecibe(tareaId: string): boolean {
    if (!this.catPersona) return false;
    const ficha = this.empleados().find(e => mismoEmpleadoNombre(e.nombre, this.catPersona));
    const suyo = resolverPuesto(ficha).puestoId;
    if (!suyo) return false;
    return tareasAutomaticasDePuesto(suyo).some(t => t.id === tareaId);
  }

  get catTareaElegida(): TareaManual | null {
    return this.catTareaId ? tareaManualPorId(this.catTareaId) : null;
  }

  get catListoParaGuardar(): boolean {
    return !!this.catStore && !!this.catPersona && !!this.catTareaId && !!this.catFecha
        && !this.catGuardando;
  }

  async guardarDelCatalogo() {
    if (!this.catListoParaGuardar) return;
    // El permiso se comprueba ANTES de escribir, no solo en el `*ngIf` del
    // botón: esconder un control es cosmética (lección del 13/sep).
    if (!(this.currentUser?.rol === 'admin' || this.currentUser?.puedeCrearChecklists)) {
      this.catAviso = 'No tienes permiso para asignar tareas.';
      return;
    }
    this.catGuardando = true;
    this.catAviso = '';
    try {
      const r = await this.robotManual.entregarDelCatalogo({
        tareaId: this.catTareaId,
        puestoId: this.catPuestoId,
        sucursal: this.catStore,
        destinatario: this.catPersona,
        destinatarioUid: this.catPersonaUid,
        // Mediodía a propósito: con 'T00:00' un cambio de horario puede correr
        // la fecha un día hacia atrás y la tarea aparecería el día que no es.
        fecha: new Date(this.catFecha + 'T12:00:00'),
        autor: this.currentUser?.nombre || '(sin autor)',
      });
      if (r.estado === 'creado') {
        this.mostrarToast('Listo: «' + (this.catTareaElegida?.nombre || 'la tarea') +
          '» quedó para ' + this.catPersona + '.');
        this.cerrarCatalogoManual();
        this.recargarChecklistsAhora?.();
      } else if (r.estado === 'ya-existia') {
        this.catAviso = 'Esa persona YA tiene esa tarea ese día, así que no se creó otra. ' +
          'Si no la ves en la lista, búscala por su nombre.';
      } else if (r.estado === 'sin-tarea') {
        this.catAviso = 'Esa tarea ya no está en el catálogo del manual.';
      } else {
        this.catAviso = r.detalle || 'No se pudo guardar.';
      }
    } finally {
      this.catGuardando = false;
    }
  }

  // ============================================================================
  //  🧙 WIZARD DE TAREAS ÚNICAS (Modo Asistido para adultos mayores)
  // ============================================================================
  wizardStep: number = 1;
  wizardTotalSteps: number = 7;
  wizardTipoEvidencia: 'ninguna' | 'foto' | 'antesDespues' | 'variasFotos' = 'ninguna';
  terminoBusquedaEmpleadoWizard: string = '';
  // 📅 NUEVO: preset y valor de la fecha en que se ejecuta la tarea
  presetFechaTarea: 'hoy' | 'manana' | 'custom' | '' = '';
  formFechaTarea: string = ''; // YYYY-MM-DD

  /** Fecha de hoy en formato YYYY-MM-DD (para usar como `min` en inputs date). */
  get hoyIsoStr(): string {
    const offset = new Date().getTimezoneOffset() * 60000;
    return new Date(Date.now() - offset).toISOString().split('T')[0];
  }

  // ============================================================================
  //  🧙 WIZARD DE BLOQUE DE RUTINAS (mismo formato asistido)
  // ============================================================================
  wizardStepRutina: number = 1;
  wizardTotalStepsRutina: number = 8;
  wizardTipoEvidenciaRutina: 'ninguna' | 'foto' | 'antesDespues' | 'variasFotos' = 'ninguna';
  terminoBusquedaEmpleadoWizardRutina: string = '';

  /**
   * Fuerza un poll de checklists. Lo llena `conectarRadarNube` con su propia
   * closure: es la MISMA función que corre cada 20s, no una copia, para que
   * el post-proceso (filtros por rol, dedup, progreso) sea idéntico.
   */
  private recargarChecklistsAhora: (() => Promise<void>) | null = null;

  private firestore = inject(Firestore);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private robotManual = inject(RobotManualService);
  private usuariosSvc = inject(UsuariosService);
  private noti = inject(NotificacionesService);
  private api = inject(ApiService);
  private destructoresRadares: (() => void)[] = [];
  private intervalId: any;

  /** ¿El usuario actual pertenece al grupo Espacio TEC? Los cambios nuevos
   *  (tareas atrasadas, "Próxima", "Visto por Gerencia" y el feedback del modal)
   *  aplican SOLO a ellos; los demás usuarios quedan como estaban. */
  get esUsuarioTec(): boolean { return this.currentUser?.grupoTec === true; }

  /** ¿El usuario actual es Ubaldo (mantenimiento)? A él SIEMPRE se le permite
   *  elegir foto de galería o tomarla al instante, sin importar la opción de la
   *  tarea (no se le fuerza la cámara con capture="environment"). */
  get esUbaldoMantenimiento(): boolean {
    const u = this.currentUser;
    if (!u) return false;
    const nombre = (u.nombre || u.usuario || '').toLowerCase();
    return nombre.includes('ubaldo');
  }

  // Effect que toma la lista cruda de UsuariosService (listener compartido) y
  // delega a procesarUsuariosCompartidos() para calcular sucursalesDisponibles,
  // adminsGlobales y empleados. Reemplaza el onSnapshot duplicado en
  // conectarRadarNube() — antes este componente abria su propio listener sobre
  // `usuarios` aunque varios otros tambien lo hacian.
  private _usuariosEffect = effect(() => {
    const raw = this.usuariosSvc.usuarios();
    if (raw && raw.length > 0) this.procesarUsuariosCompartidos(raw);
  });

  // 🤖 Robot de Manual: la plantilla completa, que es lo único que necesita
  // para saber qué le toca a cada quien (puesto → tareas de su manual).
  // Antes aquí vivían además el catálogo y las asignaciones de rutinas; ese
  // modelo se retiró: ya no hay nada que capturar.
  private plantillaUsuarios: any[] = [];

  /**
   * Por qué a quien está mirando no le toca nada hoy, calculado con la regla
   * real. Lo llena `calcularExplicacionSinTareas()` y lo lee
   * `motivoSinTareasManual()`. Mientras sea `null` la pantalla usa el texto
   * genérico de siempre, así que un fallo de red no deja el hueco sin mensaje.
   */
  private explicacionManual = signal<ExplicacionManual | null>(null);
  private robotManualCorriendo = false;
  /**
   * Cuándo terminó la última corrida del robot.
   *
   * Hace falta porque la plantilla se refresca cada 30 segundos y cada refresco
   * dispara el robot; sin este freno serían dos peticiones por minuto y por
   * cliente abierto para descubrir, casi siempre, que ya no hay nada que
   * entregar. Con esto la primera corrida es inmediata y las siguientes solo
   * cada tantos minutos, que es de sobra: lo que puede cambiar a media jornada
   * es un descanso o un turno, no la lista de tareas del manual.
   */
  private robotManualUltimaCorrida = 0;
  private readonly ROBOT_MANUAL_ESPERA_MS = 5 * 60 * 1000;

  private sucursalesAdministrativas = [
    'ADMINISTRADORES DEL SISTEMA',
    'OFICINAS CORPORATIVAS', 'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD',
    'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO', 'CEDIS'
  ];

  // ============================================================================
  //  🎯 CONTADORES EN VIVO
  // ============================================================================
  actividadesValidas(): number {
    return this.formItems.filter((it: any) => it && it.text && it.text.trim() !== '').length;
  }

  totalTareasAGenerar(): number {
    return this.formAssigned.length * this.actividadesValidas();
  }

  totalEjecucionesPorSemana(): number {
    const pesos: Record<string, number> = {
      'Diaria': 7, 'Semanal': 1, 'Catorcenal': 0.5, 'Mensual': 0.25, 'Trimestral': 0.08
    };
    const validas = (this.formRutinas || []).filter(
      (r: any) => r && r.text && r.text.trim() !== ''
    );
    const total = validas.reduce(
      (acc: number, r: any) => acc + (pesos[r.frecuencia] || 0), 0
    );
    return Math.max(0, Math.round(total));
  }

  totalRutinasSemanales(): number {
    return this.totalEjecucionesPorSemana() * (this.formAssignedRutina?.length || 0);
  }

  // ============================================================================
  //  🧙 WIZARD: NAVEGACIÓN Y VALIDACIÓN
  // ============================================================================
  avanzarPasoWizard() {
    if (!this.puedeAvanzarWizard()) return;
    if (this.wizardStep < this.wizardTotalSteps) {
      this.wizardStep++;
    }
  }

  retrocederPasoWizard() {
    if (this.wizardStep > 1) {
      this.wizardStep--;
    }
  }

  irAPasoWizard(paso: number) {
    if (paso >= 1 && paso <= this.wizardTotalSteps) {
      this.wizardStep = paso;
    }
  }

  /** True si la tarea actual del wizard es del area de Mantenimiento. */
  get esTareaMantenimiento(): boolean {
    return this.formStore === 'MANTENIMIENTO';
  }

  /** Campos obligatorios de mantenimiento llenos? (sucursal origen + tipo) */
  private validarMantenimientoMinimo(): boolean {
    if (!this.esTareaMantenimiento) return true;
    return !!this.formMantSucursalOrigen && !!this.formMantTipo;
  }

  /** Sube la foto del problema inicial a Cloudinary. Se llama desde el input file. */
  async onMantFotoChange(event: any) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    this.formMantFotoSubiendo = true;
    try {
      const r = await this.subirACloudinary(file);
      if (r.ok && r.url) {
        this.formMantFoto = r.url;
        this.mostrarToast('Foto del problema subida');
      } else {
        this.mostrarToast('No se pudo subir: ' + (r.error || 'Error desconocido'));
      }
    } finally {
      this.formMantFotoSubiendo = false;
      if (event?.target) event.target.value = '';
    }
  }

  quitarFotoMantenimiento() {
    this.formMantFoto = '';
  }

  /** Labels humanos de la prioridad para el resumen / vista de detalle. */
  prioridadLabel(p: string): string {
    if (p === 'urgente') return 'Urgente';
    if (p === 'noUrgente') return 'No urgente';
    return 'Normal';
  }

  puedeAvanzarWizard(): boolean {
    switch (this.wizardStep) {
      case 1: return !!this.formName && this.formName.trim().length > 0;
      case 2: return !!this.formStore && this.validarMantenimientoMinimo();
      case 3: return this.formAssigned.length > 0;
      case 4: return !!this.presetFechaTarea && !!this.formFechaTarea; // 📅 fecha de ejecución
      case 5: return !!this.formItems[0]?.horaInicio && !!this.formItems[0]?.horaLimite;
      case 6: return true; // evidencia
      case 7: return true; // resumen
      default: return false;
    }
  }

  seleccionarTipoEvidencia(tipo: 'ninguna' | 'foto' | 'antesDespues' | 'variasFotos') {
    this.wizardTipoEvidencia = tipo;
    if (!this.formItems[0]) return;
    this.formItems[0].requiresPhoto = false;
    this.formItems[0].requiresAntesDespues = false;
    this.formItems[0].requiresVariasFotos = false;
    if (tipo === 'foto') this.formItems[0].requiresPhoto = true;
    else if (tipo === 'antesDespues') this.formItems[0].requiresAntesDespues = true;
    else if (tipo === 'variasFotos') this.formItems[0].requiresVariasFotos = true;
  }

  /** Cambia el tiempo (en minutos) entre la foto "Antes" y la foto "Después". 0 = sin límite. */
  seleccionarTiempoAntesDespues(minutos: number) {
    if (this.formItems[0]) this.formItems[0].tiempoEstimado = minutos;
  }

  /** Cambia el tiempo (en minutos) entre la foto "Antes" y la foto "Después" en rutinas. */
  seleccionarTiempoAntesDespuesRutina(minutos: number) {
    if (this.formRutinas[0]) this.formRutinas[0].tiempoEstimado = minutos;
  }

  /** Texto humano del tiempo entre Antes/Después (para el resumen). */
  getTextoTiempoAD(minutos: number | null | undefined): string {
    if (!minutos || minutos <= 0) return 'Sin límite';
    if (minutos === 30) return '30 minutos';
    if (minutos === 60) return '1 hora';
    if (minutos === 120) return '2 horas';
    if (minutos === 240) return '4 horas';
    if (minutos % 60 === 0) return `${minutos / 60} horas`;
    return `${minutos} minutos`;
  }

  get empleadosFiltradosWizard() {
    let lista = this.empleadosFiltrados;
    if (this.terminoBusquedaEmpleadoWizard.trim() !== '') {
      const t = this.terminoBusquedaEmpleadoWizard.toLowerCase();
      lista = lista.filter(emp => emp.nombre.toLowerCase().includes(t));
    }
    return lista;
  }

  getResumenEvidencia(): string {
    switch (this.wizardTipoEvidencia) {
      case 'foto': return 'Sí, una foto';
      case 'antesDespues': return 'Sí, foto Antes y Después';
      default: return 'No requiere foto';
    }
  }

  getEmpleadosResumen(): string {
    if (this.formAssigned.length === 0) return 'Nadie';
    if (this.formAssigned.length === 1) return this.formAssigned[0];
    if (this.formAssigned.length <= 3) return this.formAssigned.join(', ');
    return `${this.formAssigned[0]}, ${this.formAssigned[1]} y ${this.formAssigned.length - 2} más`;
  }

  ponerHoraInicio(hora: string) {
    if (this.formItems[0]) this.formItems[0].horaInicio = hora;
  }

  ponerHoraLimite(hora: string) {
    if (this.formItems[0]) this.formItems[0].horaLimite = hora;
  }

  /** 📅 Aplica un preset de fecha (hoy / mañana / personalizar) al formulario. */
  seleccionarPresetFechaTarea(preset: 'hoy' | 'manana' | 'custom') {
    this.presetFechaTarea = preset;
    const offset = new Date().getTimezoneOffset() * 60000;
    if (preset === 'hoy') {
      this.formFechaTarea = new Date(Date.now() - offset).toISOString().split('T')[0];
    } else if (preset === 'manana') {
      this.formFechaTarea = new Date(Date.now() + 86400000 - offset).toISOString().split('T')[0];
    }
    // En 'custom' el usuario llena el input manualmente
  }

  /** 📅 Texto humano para el resumen del paso final. */
  getResumenFechaTarea(): string {
    if (!this.formFechaTarea) return 'Sin fecha';
    if (this.presetFechaTarea === 'hoy') return `📅 Hoy (${this.formFechaTarea})`;
    if (this.presetFechaTarea === 'manana') return `📅 Mañana (${this.formFechaTarea})`;
    return `📅 ${this.formFechaTarea}`;
  }

  finalizarWizard() {
    if (this.formItems[0]) {
      this.formItems[0].text = this.formName;
      // 📅 Aplica la fecha elegida al item — se guardará en `date` del checklist
      this.formItems[0].fechaLimite = this.formFechaTarea;
    }
    this.guardarChecklistUnico();
  }

  // ============================================================================
  //  🧙 WIZARD DE RUTINAS: NAVEGACIÓN Y VALIDACIÓN
  // ============================================================================
  avanzarPasoWizardRutina() {
    if (!this.puedeAvanzarWizardRutina()) return;
    if (this.wizardStepRutina < this.wizardTotalStepsRutina) {
      this.wizardStepRutina++;
    }
  }

  retrocederPasoWizardRutina() {
    if (this.wizardStepRutina > 1) {
      this.wizardStepRutina--;
    }
  }

  irAPasoWizardRutina(paso: number) {
    if (paso >= 1 && paso <= this.wizardTotalStepsRutina) {
      this.wizardStepRutina = paso;
    }
  }

  puedeAvanzarWizardRutina(): boolean {
    const regla = this.formRutinas[0];
    switch (this.wizardStepRutina) {
      case 1: return !!this.formNameRutina && this.formNameRutina.trim().length > 0;
      case 2: return !!this.formStoreRutina;
      case 3: return !!regla?.frecuencia;                                   // 🔁 Frecuencia (era paso 4)
      case 4: return !!regla?.horaInicio && !!regla?.horaLimite;            // 🕒 Horario
      case 5: {                                                              // 📅 Vigencia
        if (!regla?.fechaInicio) return false;
        if (regla?.fechaFin && regla.fechaFin < regla.fechaInicio) return false;
        return true;
      }
      case 6: return true;                                                   // 📷 Evidencia
      case 7: return this.formAssignedRutina.length > 0;                     // 👤 Empleados (movido al final)
      case 8: return true;                                                   // ✅ Resumen
      default: return false;
    }
  }

  /** 📅 Resumen humano de la vigencia (Desde X hasta Y). */
  getResumenVigenciaRutina(): string {
    const r = this.formRutinas[0];
    if (!r?.fechaInicio) return 'Sin vigencia';
    if (r.fechaFin) return `Del ${r.fechaInicio} al ${r.fechaFin}`;
    return `Desde ${r.fechaInicio} (sin fecha de fin)`;
  }

  seleccionarTipoEvidenciaRutina(tipo: 'ninguna' | 'foto' | 'antesDespues' | 'variasFotos') {
    this.wizardTipoEvidenciaRutina = tipo;
    if (!this.formRutinas[0]) return;
    this.formRutinas[0].requiresPhoto = false;
    this.formRutinas[0].requiresAntesDespues = false;
    this.formRutinas[0].requiresVariasFotos = false;
    if (tipo === 'foto') this.formRutinas[0].requiresPhoto = true;
    else if (tipo === 'antesDespues') this.formRutinas[0].requiresAntesDespues = true;
    else if (tipo === 'variasFotos') this.formRutinas[0].requiresVariasFotos = true;
  }

  seleccionarFrecuenciaRutina(frecuencia: string) {
    if (!this.formRutinas[0]) return;
    this.formRutinas[0].frecuencia = frecuencia;
  }

  get empleadosFiltradosWizardRutina() {
    let lista = this.empleadosFiltradosRutina;
    if (this.terminoBusquedaEmpleadoWizardRutina.trim() !== '') {
      const t = this.terminoBusquedaEmpleadoWizardRutina.toLowerCase();
      lista = lista.filter(emp => emp.nombre.toLowerCase().includes(t));
    }
    return lista;
  }

  getResumenEvidenciaRutina(): string {
    switch (this.wizardTipoEvidenciaRutina) {
      case 'foto': return 'Sí, una foto';
      case 'antesDespues': return 'Sí, foto Antes y Después';
      default: return 'No requiere foto';
    }
  }

  getEmpleadosResumenRutina(): string {
    if (this.formAssignedRutina.length === 0) return 'Nadie';
    if (this.formAssignedRutina.length === 1) return this.formAssignedRutina[0];
    if (this.formAssignedRutina.length <= 3) return this.formAssignedRutina.join(', ');
    return `${this.formAssignedRutina[0]}, ${this.formAssignedRutina[1]} y ${this.formAssignedRutina.length - 2} más`;
  }

  getResumenFrecuenciaRutina(): string {
    const r = this.formRutinas[0];
    if (!r) return '';
    if (r.frecuencia === 'Diaria') return 'Todos los días';
    if (r.frecuencia === 'Semanal') return `Cada semana, los ${r.diaSemana || 'Lunes'}`;
    if (r.frecuencia === 'Catorcenal') return `Cada 2 semanas, los ${r.diaSemana || 'Lunes'}`;
    if (r.frecuencia === 'Mensual') return `Los días ${r.diaMes || 1} del mes`;
    if (r.frecuencia === 'Trimestral') return `El día ${r.diaMes || 1} cada 3 meses`;
    return '';
  }

  ponerHoraInicioRutina(hora: string) {
    if (this.formRutinas[0]) this.formRutinas[0].horaInicio = hora;
  }

  ponerHoraLimiteRutina(hora: string) {
    if (this.formRutinas[0]) this.formRutinas[0].horaLimite = hora;
  }

  finalizarWizardRutina() {
    if (this.formRutinas[0]) this.formRutinas[0].text = this.formNameRutina;
    this.guardarBloqueRutinas();
  }

  asignarATodoMiPersonalRutina() {
    const lista = this.empleadosFiltradosRutina.map(emp => emp.nombre);
    this.formAssignedRutina = [...lista];
    this.mostrarToast(` 🚀 Se asignaron ${lista.length} personas.`);
  }

  // ============================================================================

  asignarATodos(tipo: 'tarea' | 'rutina') {
    const empleadosParaAsignar = tipo === 'tarea' ? this.empleadosFiltrados : this.empleadosFiltradosRutina;
    if (empleadosParaAsignar.length === 0) {
      this.mostrarToast(' ⚠️ No hay empleados en esta sucursal para asignar.');
      return;
    }
    const nombres = empleadosParaAsignar.map(emp => emp.nombre);
    if (tipo === 'tarea') this.formAssigned = [...nombres];
    else this.formAssignedRutina = [...nombres];
    this.mostrarToast(` ✅ Se asignaron ${nombres.length} empleados.`);
  }

  desmarcarTodos(tipo: 'tarea' | 'rutina') {
    if (tipo === 'tarea') this.formAssigned = [];
    else this.formAssignedRutina = [];
  }

  esSucursalAdministrativa(sucursal: string): boolean {
    return this.sucursalesAdministrativas.includes(sucursal);
  }

  get empleadosFiltrados() {
    if (!this.formStore) return this.empleados();
    return this.empleados().filter(emp => this.empleadoPerteneceASucursal(emp, this.formStore));
  }

  get empleadosFiltradosRutina() {
    if (!this.formStoreRutina) return this.empleados();
    return this.empleados().filter(emp => this.empleadoPerteneceASucursal(emp, this.formStoreRutina));
  }

  /**
   * Evalua el estado de turno de un empleado AHORA (para mostrar badge y bloquear).
   * Devuelve null si no esta sujeto al control de turnos.
   */
  estadoTurnoEmpleado(emp: any): EvaluacionTurno | null {
    const uid = emp?.id || emp?.uid;
    if (!uid) return null;
    const ev = evaluarAsignacion(this.configTurnos(), uid);
    return ev.restringido ? ev : null;
  }

  /** Texto del badge de turno para el wizard, o '' si no aplica. */
  badgeTurno(emp: any): string {
    const ev = this.estadoTurnoEmpleado(emp);
    if (!ev) return '';
    const t = etiquetaTurno(ev.turno);
    return ev.permitido ? `Turno ${t}` : `Fuera de turno (${t})`;
  }

  /**
   * ¿Este empleado se puede asignar en `store`?
   *
   * - Sucursal "ADMINISTRADORES DEL SISTEMA": solo admins.
   * - Admins: aparecen SOLO si tienen esa sucursal explícitamente en su lista.
   *   No usamos el atajo 'General (Acceso Total)' para ellos, para no saturar
   *   cada sucursal con la gerencia general. (Petición del cliente.)
   * - Trabajadores: lógica original — 'General (Acceso Total)' los pone en todas.
   * - EXCEPCION: el creador (usuario actual) SIEMPRE se ve a si mismo, aunque
   *   no tenga la sucursal explicita. Sin esto, un admin global no puede
   *   asignarse las tareas que el mismo crea para sucursales especificas.
   */
  private empleadoPerteneceASucursal(emp: any, store: string): boolean {
    if (store === 'ADMINISTRADORES DEL SISTEMA') return emp.rol === 'admin';
    // El creador siempre se ve a si mismo
    if (emp.usuario && this.currentUser?.usuario && emp.usuario === this.currentUser.usuario) {
      return true;
    }
    // Asignable a esta sucursal (comparación normalizada; admin global y comodín
    // 'General (Acceso Total)' aplican a cualquier sucursal). Incluye admins:
    // hay cargos operativos con cuenta admin que igual reciben tareas.
    return puedeSerAsignado(emp, store ? [store] : []);
  }

  /**
   * Map cache (nombre normalizado → nivel) construido una sola vez cada vez
   * que cambia `empleados()`. Antes hacíamos `.find()` en empleados por cada
   * checklist en cada render → cientos de iteraciones por ciclo de change
   * detection. Ahora es O(1).
   */
  private _nivelPorNombre = new Map<string, 'mando' | 'operativo'>();
  /**
   * Puesto del organigrama por nombre, en el MISMO recorrido que el nivel.
   * Resolverlo en la plantilla costaria una busqueda por tarjeta y por ciclo de
   * deteccion; aqui se paga una vez.
   */
  private _puestoPorNombre = new Map<string, string>();
  private _empleadosVersion = -1;
  private actualizarMapaNivelSiCambio() {
    const empleados = this.empleados();
    if (empleados.length === this._empleadosVersion) return;
    this._empleadosVersion = empleados.length;
    const mapa = new Map<string, 'mando' | 'operativo'>();
    const puestos = new Map<string, string>();
    for (const e of empleados) {
      if (!e?.nombre) continue;
      const k = (e.nombre || '').trim().toLowerCase();
      mapa.set(k, nivelDeCargo(e.cargo));

      // El puesto del organigrama si se pudo resolver; si no, el cargo tal como
      // lo trae la ficha. Nunca se inventa: quien no tiene ninguno no muestra
      // nada, que es la senal de que le falta asignarlo.
      const r = resolverPuesto(e);
      const nombreP = r.puestoId ? nombrePuesto(r.puestoId) : (e.cargo || '');
      if (nombreP) puestos.set(k, nombreP);
    }
    this._nivelPorNombre = mapa;
    this._puestoPorNombre = puestos;
  }

  /**
   * El puesto de la persona a la que esta asignado un checklist, o '' si no se
   * le conoce. Se muestra junto al nombre: dos personas distintas pueden verse
   * igual en una lista de 500 tarjetas, y el puesto es lo que dice de que va la
   * tarea sin tener que abrirla.
   */
  puestoDelAssigned(assigned: string | undefined | null): string {
    if (!assigned) return '';
    this.actualizarMapaNivelSiCambio();
    return this._puestoPorNombre.get(assigned.trim().toLowerCase()) || '';
  }

  /**
   * Devuelve el nivel jerárquico ('mando' | 'operativo') de la persona a la
   * que está asignado un checklist. Usa el Map cacheado.
   */
  nivelDelAssigned(assigned: string | undefined | null): 'mando' | 'operativo' {
    if (!assigned) return 'operativo';
    this.actualizarMapaNivelSiCambio();
    return this._nivelPorNombre.get(assigned.trim().toLowerCase()) || 'operativo';
  }

  /**
   * Cache de los 3 derivados (mandos, operativos, ordenados) recalculado solo
   * cuando cambia la huella: length de checklists + tab + busqueda + version
   * de empleados. Antes estos eran 3 getters separados que se invocaban en
   * cada change detection y cada uno recorría toda la lista filtrada.
   */
  private _cacheChecklistsHuella = '';
  private _cacheChecklistsMandos: any[] = [];
  private _cacheChecklistsOperativos: any[] = [];
  private _cacheChecklistsOrdenados: any[] = [];
  private actualizarCacheChecklistsSiCambio() {
    const filtrados = this.checklistsFiltrados;
    const huella = `${filtrados.length}-${this.vistaTareas}-${this.terminoBusquedaChecklist}-${this._empleadosVersion}`;
    if (huella === this._cacheChecklistsHuella) return;
    this._cacheChecklistsHuella = huella;
    const mandos: any[] = [];
    const operativos: any[] = [];
    for (const c of filtrados) {
      if (this.nivelDelAssigned(c.assigned) === 'mando') mandos.push(c);
      else operativos.push(c);
    }
    this._cacheChecklistsMandos = mandos;
    this._cacheChecklistsOperativos = operativos;
    this._cacheChecklistsOrdenados = [...mandos, ...operativos];
  }

  /** Sublista de mandos del set filtrado actual. Alimenta la sub-sección "Mandos de sucursal". */
  get checklistsDeMandos() {
    this.actualizarCacheChecklistsSiCambio();
    return this._cacheChecklistsMandos;
  }
  /** Sublista de operativos del set filtrado actual. Alimenta la sub-sección "Operativos". */
  get checklistsDeOperativos() {
    this.actualizarCacheChecklistsSiCambio();
    return this._cacheChecklistsOperativos;
  }
  /**
   * Lista filtrada ordenada por nivel: mandos primero, después operativos.
   * El template itera con `*ngFor` único + separadores cuando cambia el nivel.
   */
  get checklistsOrdenadosPorNivel() {
    this.actualizarCacheChecklistsSiCambio();
    return this._cacheChecklistsOrdenados;
  }

  /**
   * 🏛️ Cómo se agrupa el apartado del Manual: por persona (lo de siempre) o por
   * el organigrama (unidad → puesto → sucursal).
   *
   * Conviven a propósito, no se reemplazan: la vista por persona es la que ya se
   * usa todos los días, y la del organigrama contesta otra pregunta —cómo va el
   * mismo puesto entre sucursales—. Cada jefe usa la que le sirve.
   *
   * Solo aplica en /tareas-manual: agrupar por organigrama las tareas libres no
   * significaría nada, porque esas no salen de un puesto.
   */
  /**
   * Ya no hay dos vistas: el arbol unico es la unica. Se conserva el signal
   * -en 'organigrama' fijo- porque `verPorOrganigrama` y la plantilla lo
   * consultan, y cambiarlos seria tocar el componente dios para nada. El
   * interruptor de la barra si desaparecio: no hay forma de volver a la lista
   * plana de personas, que era la misma pregunta peor contestada.
   */
  agrupacion = signal<'persona' | 'organigrama'>('organigrama');
  /**
   * ⚠️ EL ARBOL ES UNA HERRAMIENTA DE SUPERVISION, NO LA VISTA DE UN COLABORADOR.
   *
   * Falta `puedeFiltrarVista` y ESO FUE UN ERROR MIO. Antes el arbol vivia
   * detras de una pestaña que solo se pintaba para quien puede ver mas que lo
   * suyo; al quitar el interruptor y dejar 'organigrama' por defecto, se lo
   * abri a TODOS.
   *
   * Resultado en produccion: una Anaquelista -sin nadie debajo en el
   * organigrama- entraba a sus tareas y veia el arbol completo de la empresa
   * desde Direccion General, con sus 88 puestos y el avance agregado de cada
   * rama. Ella tiene que ver SUS tareas, y nada mas.
   *
   * `puedeFiltrarVista` es la definicion que la app ya usa para "puede ver mas
   * que lo suyo" (admin o supervisor con sucursal). No se inventa criterio
   * nuevo: se recupera el que el interruptor aplicaba sin decirlo.
   */
  get verPorOrganigrama(): boolean {
    // Ya no lleva `modoManual`: el eje de origen se retiró el 14/sep/2026 y con
    // él la condición «estás en el apartado del Manual». Ahora decide la
    // BANDEJA, y la condición va ENTERA aquí, no repartida en la plantilla.
    //
    // ⚠ ESO ÚLTIMO COSTÓ UN DEFECTO, cazado por el arnés el mismo día: al
    // quitarle `modoManual` y dejar solo `puedeFiltrarVista && organigrama`,
    // este getter quedó PERMANENTEMENTE TRUE para cualquier supervisor. El
    // árbol seguía saliendo donde debía —la plantilla lo acotaba— pero la
    // rejilla de ENVIADAS se esconde con `!verPorOrganigrama`, así que una
    // Encargada abría «Enviadas del equipo» y veía la pantalla en blanco. Con
    // la condición en un solo sitio, los cuatro `*ngIf` que dependen de ella
    // no pueden volver a desalinearse. Tiene sentido por lo que el árbol ES —recorre
    // unidad → puesto → personas—: en «Mis tareas» hay una sola persona, así
    // que el recorrido no tendría nada que recorrer (bug del 13/sep), y en el
    // historial no hay nada que supervisar.
    return this.puedeFiltrarVista
        && this.agrupacion() === 'organigrama'
        && this.vistaTareas === 'equipo'
        && this.vistaHistorial() === 'pendientes';
  }

  /**
   * La plantilla que recibe la vista del organigrama.
   *
   * Le hace falta para dos cosas: resolver el puesto de cada checklist viejo que
   * no trae `_puestoId`, y —la que de verdad importa— saber quién OCUPA un
   * puesto aunque hoy no haya recibido nada. Sin eso, alguien que se quedó sin
   * su checklist simplemente no aparecería, y no aparecer se lee como que va
   * bien.
   */
  get plantillaParaOrganigrama(): any[] {
    return this.plantillaUsuarios;
  }

  /**
   * ══════════ CÓMO SE ORDENA LA LISTA: SUCURSAL · PERSONA · PLANA ══════════
   *
   * Instrucción de David (17/sep/2026): «el agrupador de los usuarios para que
   * los tengas por sucursal». Antes esto era un booleano —agrupado por persona
   * sí o no— y la sucursal solo viajaba DENTRO de cada tarjeta, así que no
   * había forma de ver una sucursal como bloque en ninguna bandeja.
   *
   * Arranca en 'sucursal' porque es lo que se pidió, y la elección se recuerda
   * por navegador: obligar a elegir el mismo modo cada mañana es la forma de
   * que nadie lo use. El `try/catch` no es ceremonia — en una ventana privada
   * o con el almacenamiento bloqueado, leer `localStorage` LANZA, y eso
   * tumbaría el arranque del componente entero por una preferencia de vista.
   */
  private static readonly LLAVE_AGRUPACION = 'md_agrupacion_tareas';
  agrupacionLista = signal<ModoAgrupacion>(ChecklistComponent.leerAgrupacionGuardada());
  private static leerAgrupacionGuardada(): ModoAgrupacion {
    try {
      const v = localStorage.getItem(ChecklistComponent.LLAVE_AGRUPACION);
      if (v === 'sucursal' || v === 'persona' || v === 'plana') return v;
    } catch { /* sin almacenamiento: se usa el de siempre */ }
    return 'sucursal';
  }

  /** Nombres (en minusculas) de los grupos colapsados. */
  gruposColapsados = new Set<string>();

  /** El botón cicla los tres modos en el orden en que se leen de más a menos
   *  estructura. No es un menú: un solo control con tres estados ocupa el
   *  mismo sitio que el interruptor que había. */
  toggleAgruparPorPersona() {
    const orden: ModoAgrupacion[] = ['sucursal', 'persona', 'plana'];
    const siguiente = orden[(orden.indexOf(this.agrupacionLista()) + 1) % orden.length];
    this.agrupacionLista.set(siguiente);
    try { localStorage.setItem(ChecklistComponent.LLAVE_AGRUPACION, siguiente); } catch { }
  }

  /** Rótulo del botón. Dice el estado ACTUAL, no el que se va a aplicar:
   *  un botón que anuncia lo que hará al pulsarlo deja al usuario sin saber
   *  qué está viendo ahora mismo. */
  get rotuloAgrupacion(): string {
    const m = this.agrupacionLista();
    return m === 'sucursal' ? 'Agrupado por sucursal'
         : m === 'persona'  ? 'Agrupado por persona'
         : 'Lista plana';
  }

  /**
   * Los grupos de la lista de PENDIENTES cuando no manda el panel de
   * responsables (colaborador, «Mis tareas», o modo plana).
   *
   * Cuelga de `checklistsOrdenadosPorNivel` —no de `checklists()`— para que
   * herede el recorte por ámbito, por bandeja y por búsqueda. Agrupar sobre la
   * lista cruda habría devuelto a la pantalla tareas que el ámbito ya había
   * escondido: una fuga de visibilidad disfrazada de mejora visual.
   *
   * ⚠ CACHEADO POR HUELLA, Y NO ES OPTIMIZACIÓN PREMATURA. Un getter que
   * construye un arreglo NUEVO en cada llamada es literalmente la caída del
   * 1/sep/2026: `menuDe()` devolvía un arreglo nuevo, el `*ngFor` lo comparaba
   * por identidad y destruía y recreaba el bloque entero en cada ciclo de
   * detección —con cuatro polls y cada respuesta HTTP disparando uno—. Aquí
   * son ~160 tarjetas y la plantilla lo consulta varias veces por ciclo.
   * Con la huella, el `*ngFor` recibe EL MISMO arreglo y no hace nada.
   */
  private _cacheGruposPendHuella = '';
  private _cacheGruposPend: GrupoSucursal[] = [];
  get gruposDePendientes(): GrupoSucursal[] {
    const lista = this.checklistsOrdenadosPorNivel;
    const huella = `${this._cacheChecklistsHuella}-${this.agrupacionLista()}`;
    if (huella === this._cacheGruposPendHuella) return this._cacheGruposPend;
    this._cacheGruposPendHuella = huella;
    this._cacheGruposPend = agruparEntregas(lista, this.agrupacionLista(), n => this.nivelDelAssigned(n));
    return this._cacheGruposPend;
  }

  /** Los mismos grupos, para el historial. Mismo cache, misma razón. */
  private _cacheGruposEnvHuella = '';
  private _cacheGruposEnv: GrupoSucursal[] = [];
  get gruposDeEnviadas(): GrupoSucursal[] {
    const lista = this.enviadasFiltradas;   // deja el cache de enviadas al día
    const huella = `${this._cacheEnviadasHuella}-${this.agrupacionLista()}`;
    if (huella === this._cacheGruposEnvHuella) return this._cacheGruposEnv;
    this._cacheGruposEnvHuella = huella;
    this._cacheGruposEnv = agruparEntregas(lista, this.agrupacionLista(), n => this.nivelDelAssigned(n));
    return this._cacheGruposEnv;
  }

  /**
   * ¿Se pinta el encabezado de sucursal? Son propiedades y no una función con
   * argumento: `hayQuePintarSucursal(gruposDePendientes)` habría re-evaluado el
   * getter en cada binding, que es justo lo que el cache viene a evitar.
   */
  get pintarSucursalEnPendientes(): boolean { return mostrarEncabezadoSucursal(this.gruposDePendientes); }
  get pintarSucursalEnEnviadas(): boolean { return mostrarEncabezadoSucursal(this.gruposDeEnviadas); }
  hayQuePintarPersona(g: GrupoSucursal): boolean { return mostrarEncabezadoPersona(g); }
  trackGrupoSuc(_: number, g: GrupoSucursal): string { return g.clave; }
  trackGrupoPer(_: number, g: { clave: string }): string { return g.clave; }

  // ══════════ CADA BLOQUE ES UN BOTÓN QUE SE DESGLOSA (17/sep/2026) ══════════
  //
  // Instrucción de David, sobre la captura de «8 Esquinas · 42 tareas» con las
  // tarjetas debajo: «no lo quiero solo así, quiero que esté dentro de botones
  // y de ahí se desglose». Hasta hoy los dos encabezados eran <div> de adorno:
  // la bandeja escupía las 42 tarjetas de golpe y para llegar a la tercera
  // sucursal había que recorrer cien tarjetas con el dedo.
  //
  // EL CONJUNTO GUARDA LOS ABIERTOS, NO LOS CERRADOS, y no es un detalle. David
  // eligió que todo arranque cerrado, así que el conjunto VACÍO es exactamente
  // ese estado inicial y no hay que sembrarlo con nada. Al revés —guardando los
  // cerrados— habría que registrar cada grupo que nace, y el que llegara sin
  // registrar aparecería ABIERTO: el poll de 20 s iría abriendo bloques solo
  // cada vez que entrara una sucursal nueva. Es la misma decisión que ya tomó
  // el árbol del organigrama (2–3/sep).
  //
  // Y NO SE RECUERDA ENTRE SESIONES, también por decisión suya: una sucursal
  // que quedó plegada hace tres días se lee como «esa tienda no tiene tareas»,
  // que es el mismo modo de fallo mudo que este proyecto lleva un mes cazando.
  private abiertosLista = signal<Set<string>>(new Set<string>());

  /**
   * La llave lleva la BANDEJA delante porque Pendientes y Enviadas son dos
   * listas distintas con las mismas sucursales: sin el prefijo, abrir «8
   * Esquinas» en una la abriría también en la otra. Y la llave de persona lleva
   * la sucursal, porque `per.clave` solo es única DENTRO de su grupo: sin eso,
   * abrir a Claudia en 8 Esquinas la abriría también en La Piedad.
   */
  private llaveSuc(bandeja: 'pend' | 'env', g: GrupoSucursal): string {
    return bandeja + '|' + g.clave;
  }
  private llavePer(bandeja: 'pend' | 'env', g: GrupoSucursal, per: { clave: string }): string {
    return bandeja + '|' + g.clave + '|' + per.clave;
  }

  /** Abre o cierra. Se crea un Set NUEVO: mutar el mismo no dispara la señal. */
  private alternarBloque(llave: string) {
    const s = new Set(this.abiertosLista());
    if (s.has(llave)) s.delete(llave); else s.add(llave);
    this.abiertosLista.set(s);
  }
  alternarSuc(bandeja: 'pend' | 'env', g: GrupoSucursal) { this.alternarBloque(this.llaveSuc(bandeja, g)); }
  alternarPer(bandeja: 'pend' | 'env', g: GrupoSucursal, per: { clave: string }) {
    this.alternarBloque(this.llavePer(bandeja, g, per));
  }

  /**
   * ⚠ HAY BLOQUES QUE NO SE PLIEGAN, y los tres casos son la misma regla:
   * plegar solo sirve cuando hay ENTRE QUÉ elegir. Sin estas tres salidas, el
   * cambio de hoy dejaría gente mirando una pantalla de botones sin tareas, que
   * es indistinguible de «no tengo trabajo» (§5.2).
   *
   *   1. El encabezado no se pinta. Sin botón no habría forma de volver a
   *      abrirlo: quedaría cerrado para siempre.
   *   2. Hay UNA sola persona en toda la bandeja. Es el caso de «Mis tareas» de
   *      los 154 trabajadores: abrirían la app para encontrar su propio nombre
   *      y cero tarjetas, y tendrían que pulsarse a sí mismos para trabajar.
   *   3. Hay búsqueda escrita. Quien tecleó «Pasillo» ya recortó la lista;
   *      esconderle el resultado detrás de un clic es deshacerle el trabajo.
   */
  private get busquedaActiva(): boolean {
    return !!String(this.terminoBusquedaChecklist || '').trim();
  }

  private cuantasPersonasEn(bandeja: 'pend' | 'env'): number {
    const grupos = bandeja === 'pend' ? this.gruposDePendientes : this.gruposDeEnviadas;
    let n = 0;
    for (const g of grupos) n += g.personas.length;
    return n;
  }

  /** ¿Se ve lo que hay dentro de esta sucursal? */
  sucAbierta(bandeja: 'pend' | 'env', g: GrupoSucursal): boolean {
    const pinta = bandeja === 'pend' ? this.pintarSucursalEnPendientes : this.pintarSucursalEnEnviadas;
    if (!pinta) return true;                       // caso 1: no hay botón
    if (this.busquedaActiva) return true;          // caso 3
    return this.abiertosLista().has(this.llaveSuc(bandeja, g));
  }

  /** ¿Se ven las TARJETAS de esta persona? La sucursal manda: cerrada ella,
   *  no se pinta nada de dentro aunque la persona estuviera abierta. */
  perAbierta(bandeja: 'pend' | 'env', g: GrupoSucursal, per: { clave: string }): boolean {
    if (!this.sucAbierta(bandeja, g)) return false;
    if (!this.hayQuePintarPersona(g)) return true;              // caso 1
    if (this.busquedaActiva) return true;                       // caso 3
    if (this.cuantasPersonasEn(bandeja) <= 1) return true;      // caso 2
    return this.abiertosLista().has(this.llavePer(bandeja, g, per));
  }
  grupoEstaColapsado(nombre: string): boolean { return this.gruposColapsados.has((nombre || '').toLowerCase()); }
  toggleGrupoColapsado(nombre: string) {
    const k = (nombre || '').toLowerCase();
    if (this.gruposColapsados.has(k)) this.gruposColapsados.delete(k);
    else this.gruposColapsados.add(k);
  }

  /**
   * Checklists agrupados por persona asignada. Mandos primero, luego por nombre.
   * Cada grupo: { nombre, nivel, checklists[], total, completas }.
   * Reusa el cache ordenado para no recorrer la lista en cada change detection.
   */
  private _cacheGruposHuella = '';
  private _cacheGrupos: any[] = [];
  get gruposPorPersona() {
    this.actualizarCacheChecklistsSiCambio();
    if (this._cacheChecklistsHuella === this._cacheGruposHuella) return this._cacheGrupos;
    this._cacheGruposHuella = this._cacheChecklistsHuella;
    const mapa = new Map<string, any>();
    for (const c of this._cacheChecklistsOrdenados) {
      const nombre = (c.assigned || 'Sin asignar').trim();
      const key = nombre.toLowerCase();
      let g = mapa.get(key);
      if (!g) {
        g = { nombre, nivel: this.nivelDelAssigned(nombre), checklists: [], total: 0, completas: 0 };
        mapa.set(key, g);
      }
      g.checklists.push(c);
      g.total++;
      if (c.status === 'completo') g.completas++;
    }
    this._cacheGrupos = [...mapa.values()].sort((a, b) =>
      a.nivel === b.nivel ? a.nombre.localeCompare(b.nombre) : (a.nivel === 'mando' ? -1 : 1)
    );
    return this._cacheGrupos;
  }

  trackByGrupo(_: number, g: any): string { return g?.nombre || _; }

  /**
   * Cache de `checklistsFiltrados`. Recalcula solo si cambian length de
   * checklists, vistaTareas o el termino de búsqueda. Sin esto, los templates
   * lo evaluaban en cada change detection y cada vez recorría toda la lista.
   */
  private _cacheFiltradosHuella = '';
  private _cacheFiltrados: any[] = [];

  get checklistsFiltrados() {
    const amb = this.ambito;
    // La huella lleva el ámbito porque el recorte depende de él: sin esto, una
    // ficha que gana su puesto seguiría viendo la lista vieja hasta que algo más
    // cambiara la huella, y el recorte parecería no haber funcionado.
    const huella = `${this.checklists().length}-${this.vistaTareas}-${this.terminoBusquedaChecklist}-${this.currentUser?.nombre || ''}-${amb.amplitud}${amb.restringido ? ':' + [...(amb.lugares || [])].sort().join(',') : ''}`;
    if (huella === this._cacheFiltradosHuella) return this._cacheFiltrados;
    this._cacheFiltradosHuella = huella;
    let lista = this.checklists();

    // 👁️ EL CORTE POR ÁMBITO — va AQUÍ y no en la vista, por lo que dice el
    // comentario de abajo: éste es el único punto de filtrado, y las vistas
    // derivadas (árbol del organigrama, panel de responsables, agrupada por
    // persona) cuelgan todas de aquí. Puesto en la vista, se colaría por las
    // otras dos.
    //
    // Recorta por LUGAR, que es el eje horizontal. El vertical —qué puesto le
    // reporta— no esconde nada: marca «servicio a» dentro del árbol, porque la
    // gente de Ventas que trabaja en la tienda de una Encargada tiene que verse
    // sin contarle a ella (§5, atribución transversal).
    if (amb.restringido) lista = lista.filter(c => entregaVisible(amb, c));

    // Cuántas hay HOY antes de recortar por persona y antes de la búsqueda.
    // `motivoSinTareasManual()` lo usa para poder decir «ninguna de las N de hoy
    // está a tu nombre», que es una frase que solo tiene sentido con el total
    // sin recortar. El orden de estas líneas no es cosmético: moverlo cambia lo
    // que ese mensaje afirma.
    this._totalEnEsteModo = lista.length;

    // Filtro por pestaña (Mis / Equipo / Todas). Solo aplica si el usuario
    // puede alternar — para trabajadores puros, la lista ya viene filtrada por
    // su nombre desde el snapshot. Match tolerante a apellido extra/de menos.
    if (this.puedeFiltrarVista && this.vistaTareas !== 'todas') {
      const mi = this.currentUser?.nombre;
      lista = lista.filter(c => {
        const esMia = mismoEmpleadoNombre(c.assigned, mi);
        return this.vistaTareas === 'mis' ? esMia : !esMia;
      });
    }

    // Filtro por búsqueda libre (texto en nombre/empleado/sucursal).
    //
    // ⚠ LA REGLA YA NO VIVE AQUÍ, y ese es el arreglo del 17/sep/2026. Estaba
    // escrita en este `filter` y por eso solo la tenía la mitad de la
    // pantalla: el historial (`enviadasFiltradas`) nunca la llamaba, así que
    // buscar «la piedad abastos» en «Enviadas del equipo» devolvía la lista
    // entera con el contador intacto. Una sola definición, dos listas.
    lista = filtrarPorBusqueda(lista, this.terminoBusquedaChecklist);
    this._cacheFiltrados = lista;
    return lista;
  }

  /** Total del apartado actual sin contar la búsqueda (lo llena el getter de arriba). */
  private _totalEnEsteModo = 0;
  get totalEnEsteModo(): number {
    this.checklistsFiltrados;   // asegura que el cache esté al día
    return this._totalEnEsteModo;
  }

  /**
   * Por qué este trabajador no ve ninguna tarea del Manual.
   *
   * Existe porque una sección vacía sin explicación se lee como que la app está
   * rota, y aquí hay tres causas muy distintas con arreglos muy distintos: que
   * no le hayan capturado el puesto (lo arregla un admin en Usuarios), que su
   * puesto todavía no tenga manual levantado (no lo arregla nadie en la app), o
   * que hoy simplemente no le toque nada.
   */
  motivoSinTareasManual(): string {
    // ── «MIS TAREAS» VACIO NO ES «NO HAY TAREAS» ───────────────────────────
    // Reportado el 13/sep: la pestaña decia «Mis tareas 0 · Toda la operacion
    // 1». Con el mensaje generico, quien la abre concluye que la app no le
    // entrego nada — cuando lo que pasa es que esas tareas son de OTRA persona
    // y estan a un clic, en la pestaña de al lado. Se dice, con la cifra.
    if (this.puedeFiltrarVista && this.vistaTareas === 'mis' && this.totalEnEsteModo > 0) {
      return `Ninguna de las ${this.totalEnEsteModo} tarea(s) de hoy está a tu nombre. ` +
             'Las de tu equipo están en «Pendientes del equipo», aquí al lado.';
    }
    const r = resolverPuesto(this.currentUser);
    if (!r.puestoId) {
      return 'Tu puesto no está capturado en el organigrama, así que la app no sabe qué ' +
             'checklists del manual te tocan. Pídele a un administrador que te asigne tu ' +
             'puesto en la sección de Usuarios.';
    }
    if (tareasAutomaticasDePuesto(r.puestoId).length === 0) {
      return `El puesto "${nombrePuesto(r.puestoId)}" todavía no tiene su Manual Corporativo ` +
             'levantado, así que no recibe tareas automáticas. Cuando el manual se autorice, ' +
             'sus checklists van a aparecer aquí solos.';
    }
    // ── LA CAUSA EXACTA, NO TRES POSIBLES ──────────────────────────────────
    // Lo de abajo enumeraba «puede ser que ya las enviaste, que es tu día de
    // descanso o que la hora cae fuera de tu turno» — tres causas, y el
    // 15/sep/2026 una Jefa de Zona con su puesto bien capturado leyó las tres
    // sin que ninguna fuera la suya. Un mensaje que enumera causas falsas es
    // peor que el silencio: manda a corregir lo que no está roto.
    //
    // `explicacionManual` sale de correr la MISMA regla que emite, así que lo
    // que se lee aquí no puede contradecir a lo que el robot hizo.
    const exp = this.explicacionManual();
    if (exp?.motivo) {
      return `Hoy no te toca ninguna tarea del manual: ${exp.motivo}.`;
    }
    // Le tocan y no están en su lista. Es el caso que más importa nombrar,
    // porque es el único que NO se arregla solo y necesita que alguien mire.
    if (exp && exp.planeadas > 0) {
      return `Según tu puesto te toca(n) ${exp.planeadas} tarea(s) del manual hoy, y no ` +
             'están en tu lista. Puede ser que ya las enviaste; si no, avísale a un ' +
             'administrador con esta pantalla abierta.';
    }
    return 'Hoy no tienes pendientes del manual. Puede ser que ya las enviaste, que es tu ' +
           'día de descanso o que la hora de esas tareas cae fuera de tu turno.';
  }

  /**
   * Calcula por qué a quien está mirando no le toca nada, con la regla real.
   *
   * Se dispara desde `procesarUsuariosCompartidos` y no desde el getter del
   * mensaje: un getter de plantilla se evalúa en CADA ciclo de detección de
   * cambios, y esto hace tres peticiones —horarios, turnos y descansos—. Sería
   * la caída del sidebar del 1/sep otra vez, con red de por medio.
   *
   * Usa la ficha VIVA de la lista de usuarios, no `currentUser` de
   * localStorage: si un admin acaba de capturarle el puesto, la sesión guardada
   * todavía no lo tiene y el motivo saldría equivocado justo el día que alguien
   * lo está corrigiendo.
   *
   * Nunca lanza: si falla, el signal se queda en null y la pantalla usa el
   * texto genérico de siempre.
   */
  private calcularExplicacionSinTareas(todosLosUsuarios: any[]) {
    try {
      const miUid = this.currentUser?.uid;
      const yo = (miUid && todosLosUsuarios.find((u: any) => u.uid === miUid)) || this.currentUser;
      if (!yo) return;
      this.robotManual.explicarPara(yo, new Date(), {
        esDiaCerrado: (suc, f) => this.esDiaCerrado(suc, f),
        esSucursalAdministrativa: (suc) => this.esSucursalAdministrativa(suc),
      }).then(exp => this.explicacionManual.set(exp))
        .catch(() => { /* sin explicación => mensaje genérico */ });
    } catch { /* idem */ }
  }

  mostrarToast(mensaje: string) {
    this.toastMessage = mensaje;
    setTimeout(() => { this.toastMessage = ''; }, 3500);
  }

  ngOnInit() {
    // ⏰ Cada 30 s: la mitad del minuto que se muestra, para que la cuenta
    // regresiva no se salte ninguno. Se apaga en ngOnDestroy.
    this.relojId = setInterval(() => { this.ahoraReloj = Date.now(); }, 30000);

    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) this.currentUser = JSON.parse(sesion);

    // 🗂️ LA BANDEJA CON LA QUE SE ABRE, y por qué depende de quién entró.
    //
    // Quien NO puede ver lo de otros solo tiene los dos botones de «mis», así
    // que arrancar en 'equipo' le dejaría los cuatro apagados: una barra sin
    // nada seleccionado, con la lista mostrando algo que ningún botón nombra.
    // Se fija aquí porque `puedeFiltrarVista` necesita `currentUser`, que se
    // acaba de leer tres líneas arriba.
    this.vistaTareas = this.puedeFiltrarVista ? 'equipo' : 'mis';
    // Listener compartido de usuarios (refcount; no abre uno duplicado si ya existe).
    this.usuariosSvc.iniciar();
    this.conectarRadarNube();
    this.iniciarRobotNotificador();
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
    // (Nota: this.intervalId se setea en iniciarRobotNotificador())
  }

  ngOnDestroy() {
    // 🔥 Cierra todos los listeners de Firestore para evitar memory leaks
    this.destructoresRadares.forEach(apagarRadar => apagarRadar());
    this.destructoresRadares = [];
    // Soltar el refcount del listener compartido de usuarios
    this.usuariosSvc.detener();
    // 🔥 Detiene el robot notificador (setInterval de 30s)
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    // ⏰ Y el reloj de las cuentas regresivas. Sin esto seguiría corriendo sobre
    // un componente destruido, que es el memory leak de arriba con otra ropa.
    if (this.relojId) {
      clearInterval(this.relojId);
      this.relojId = null;
    }
  }

  /** ¿El usuario actual es el dueño del checklist actualmente abierto?
   *  Match tolerante a tildes/espacios/apellido extra (para que Jorge Alberto
   *  Duarte Vazquez pueda editar tareas asignadas a Jorge Alberto Duarte). */
  esElDueno(): boolean {
    const cs = this.checklistSeleccionado();
    if (!cs) return false;
    // 1) Por uid: inmune a diferencias de nombre (checklists nuevos lo traen).
    const miUid = this.currentUser?.uid || this.currentUser?.id;
    if (miUid && cs.assignedUid && cs.assignedUid === miUid) return true;
    // 2) Por nombre tolerante (acentos/espacios/orden de apellidos).
    return mismoEmpleadoNombre(this.currentUser?.nombre, cs.assigned);
  }

  /** ¿Puede editar el checklist actual? (es el dueño y no se ha enviado). */
  puedoEditarChecklistActivo(): boolean {
    const cs = this.checklistSeleccionado();
    if (!cs || cs.enviado) return false;
    return this.esElDueno();
  }

  /**
   * ¿Puede editar/subir evidencia en este item?
   *
   * Ya NO se bloquea por vencimiento: aunque la tarea pase de su hora límite,
   * el trabajador puede seguir completándola y subir evidencia. Al enviar el
   * checklist se le pedirá el justificante de retraso (ver enviarChecklist).
   * Solo se bloquea si el checklist ya fue enviado o no es el dueño.
   */
  puedoEditarItem(_item: any): boolean {
    return this.puedoEditarChecklistActivo();
  }

  /** Agrega una foto al array item.photos[] (para tareas con `requiresVariasFotos`). */
  /**
   * Agrega evidencia a la galeria del punto. Sube TODOS los archivos elegidos.
   *
   * ANTES SE COMIA LOS DEMAS EN SILENCIO. Tomaba `files[0]` y descartaba el
   * resto. Con el input sin `multiple` eso no se notaba porque solo podia
   * llegar uno; al poner `multiple` -para que los 45 puntos de documento
   * puedan adjuntar varias hojas de un jalon- la persona habria seleccionado
   * tres archivos, habria visto uno, y no habria habido ningun error. El punto
   * quedaria "con evidencia" con un tercio de lo que entrego.
   *
   * En el celular con la camara forzada llega uno por toque de todos modos
   * (la camara devuelve una foto por disparo): ahi el que suma varias es el
   * boton "Agregar otra foto". Este arreglo es para el otro camino.
   */
  async onMultiplePhotoSelected(event: any, item: any) {
    const archivos: File[] = Array.from(event.target?.files || []);
    if (!archivos.length) return;
    if (!item.photos) item.photos = [];
    const inputReal = event.target;

    for (const file of archivos) {
      // Evento SINTETICO con un solo archivo. `onFileSelected` lee
      // `target.files[0]` y escribe `target.value = ''`, y no usa nada mas del
      // evento -verificado leyendo la funcion completa-, asi que esto le basta.
      // Se le pasa un item temporal porque esa funcion escribe en `item.photo`
      // y aqui el destino es el arreglo `photos`.
      const tempItem: any = {};
      await this.onFileSelected({ target: { files: [file], value: '' } }, tempItem, 'photo');
      if (tempItem.photo && tempItem.photo !== 'subiendo...') {
        item.photos.push({ url: tempItem.photo, time: tempItem.photoTime || '' });
      }
    }
    // Limpiar el input REAL: sin esto, volver a elegir el mismo archivo no
    // dispara `change` y parece que la app lo ignoro.
    try { if (inputReal) inputReal.value = ''; } catch { /* noop */ }
    this.actualizarEstado();
  }

  /** Quita una foto del array item.photos[] por índice. */
  removerFotoDeArray(item: any, index: number) {
    if (item.photos && index >= 0 && index < item.photos.length) {
      item.photos.splice(index, 1);
      this.actualizarEstado();
    }
  }

  isDespuesExpirado(item: any): boolean {
    if (!item.requiresAntesDespues || !item.photoAntesTimestamp) return false;
    // El "Después" expira cuando expira la TAREA (su horaLimite/time del día).
    // Antes esto se basaba en un contador entre fotos — quitado a petición.
    const fecha = this.checklistSeleccionado()?.date;
    if (!fecha) return false;
    return this.isTareaVencida(item, fecha);
  }

  /** Hora límite efectiva del item (HH:mm), o fallback a la del checklist. */
  horaLimiteItem(item: any): string {
    return item?.horaLimite || item?.time || this.checklistSeleccionado()?.time || '23:59';
  }

  iniciarRobotNotificador() {
    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
    // 🔥 FIX MEMORY LEAK: guardamos la referencia para limpiar en ngOnDestroy.
    // Antes este setInterval quedaba huérfano. Cada vez que el admin entraba
    // a Checklist se acumulaba uno nuevo → 20 entradas = 20 intervals corriendo.
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => {
      const ahora = new Date();
      if (ahora.getMinutes() === 0 && this.ultimaHoraNotificada !== ahora.getHours()) {
        this.ultimaHoraNotificada = ahora.getHours();
        this.verificarYNotificarPendientes();
      }
    }, 30000);
  }

  verificarYNotificarPendientes() {
    const misPendientes = this.checklists().filter(c => !c.esFutura && c.status !== 'completo' && c.enviado !== true);
    if (misPendientes.length > 0) {
      const mensaje = `Tienes ${misPendientes.length} checklist(s) pendientes por terminar. ¡No te retrases! 🕒`;
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Mega Dulces Task 🍭', { body: mensaje, vibrate: [200, 100, 200] } as any);
      }
      this.mostrarToast(`⏰ ¡Hora de checar! ${mensaje}`);
    }
  }

  /** Cambia entre la vista de pendientes (hoy) y el historial de enviadas. */
  cambiarVistaHistorial(v: 'pendientes' | 'enviadas') {
    this.vistaHistorial.set(v);
    if (v === 'enviadas' && !this.enviadasCargadas) this.cargarEnviadas();
  }

  /** Carga (bajo demanda) las tareas ENVIADAS de los últimos 30 días, filtradas
   *  según el alcance de quien mira: trabajador → las suyas; admin limitado /
   *  supervisor → las de sus sucursales; admin global → todas. */
  async cargarEnviadas() {
    this.cargandoEnviadas = true;
    try {
      // ⏱️ SOLO LAS DE HOY (20/sep/2026)
      //
      // Reporte de David: «en enviadas del equipo aparecen las viejas y tienen
      // que ser solo las del día». Aquí se pedían **30 días** y después no se
      // recortaba la fecha, así que el historial traía un mes entero mientras
      // «Pendientes» pedía `desde = hoy`. Las dos bandejas vivían en escalas
      // distintas y eso es lo que se veía en pantalla.
      //
      // ─── POR QUÉ SE FILTRA POR `date` Y NO POR CUÁNDO SE ENVIÓ ────────────
      // Porque no existe. La tabla tiene `enviado` (booleano) y
      // `timestamp_creacion`, pero NINGUNA columna con la hora del envío
      // (`009_checklists.sql`). O sea que «se envió hoy» no se puede saber: lo
      // único que hay es el día al que pertenece la tarea, que además es el
      // mismo criterio que usa «Pendientes». Queda anotado como dato que falta.
      //
      // CONSECUENCIA, dicha para que no sorprenda: un checklist de AYER que se
      // entregue esta mañana no sale en esta bandeja. Es la misma regla que ya
      // tenía «Pendientes» —que tampoco trae días pasados, salvo TEC— así que
      // esto alinea las dos en vez de abrir un caso nuevo.
      const offset = new Date().getTimezoneOffset() * 60000;
      const hoyLocal = new Date(Date.now() - offset).toISOString().split('T')[0];
      // Se acota por LOS DOS LADOS. Con solo `desde`, un checklist fechado
      // mañana y marcado enviado seguiría saliendo —y los hay: el 31/ago se
      // midieron 15 con fecha 01/sep creados el día anterior—.
      const respEnv = await this.api.get(
        '/api/checklists?desde=' + encodeURIComponent(hoyLocal) +
        '&hasta=' + encodeURIComponent(hoyLocal));
      const filas: any[] = respEnv?.checklists || [];
      const sesion = (() => { try { return JSON.parse(localStorage.getItem('md_sesion_actual') || 'null'); } catch { return null; } })() || this.currentUser;
      const esGlobal = esAdminGlobal(sesion);
      const esLimitado = esAdminLimitado(sesion);
      const supervisor = esSupervisor(sesion);
      // OJO con el `?? []` que había aquí: `null` significa TODAS, no ninguna.
      // Ver `alcanceCubre`. Con el comodín «General (Acceso Total)» esta lista
      // salía vacía entera y el historial se veía como si no existiera.
      const permitidas = sucursalesPermitidas(sesion);
      const miNombre = sesion?.nombre;

      const lista: any[] = [];
      filas.forEach((c: any) => {
        if (c.enviado !== true) return;            // solo enviadas
        if (c.eliminado === true || c.archivado === true) return;
        // El rango ya lo acota el servidor; esto lo vuelve EXACTO y sobrevive a
        // que alguien cambie la consulta sin acordarse de la intencion.
        if (c.date !== hoyLocal) return;
        // Alcance
        if (esGlobal) { /* ve todas */ }
        else if (esLimitado || supervisor) { if (!alcanceCubre(permitidas, c.store)) return; }
        else { if (!mismoEmpleadoNombre(c.assigned, miNombre)) return; }
        // El mismo recorte que en pendientes: el historial tiene que contar lo
        // mismo que la lista, o los dos numeros se contradicen en pantalla.
        if (!pasaFiltroTransversal(sesion, c, permitidas)) return;
        lista.push(c);
      });
      // Más recientes primero (por fecha y, dentro del día, por creación).
      lista.sort((a, b) => {
        if (a.date !== b.date) return String(b.date).localeCompare(String(a.date));
        return (b.timestampCreacion || 0) - (a.timestampCreacion || 0);
      });
      this.enviadas.set(lista);
      this.enviadasCargadas = true;
    } catch (e) {
      console.error('[checklist] cargarEnviadas', e);
      this.mostrarToast('No se pudo cargar el historial. Intenta de nuevo.');
    } finally {
      this.cargandoEnviadas = false;
    }
  }

  lanzarNotificacionInmediata() {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Nueva Tarea - Mega Dulces 🍭', { body: '¡Acaban de asignarte una nueva tarea! Entra a revisarla. 🚀', vibrate: [300, 100, 300] } as any);
    }
    this.mostrarToast('🔔 ¡Te acaban de asignar una nueva tarea!');
  }

  /**
   * Calcula sucursalesDisponibles, adminsGlobales y empleados a partir de la
   * lista cruda de usuarios. Se llama desde el effect _usuariosEffect cada
   * vez que el UsuariosService publica una actualizacion del snapshot
   * compartido. Antes vivia inline en el callback del onSnapshot dedicado.
   */
  procesarUsuariosCompartidos(todosLosUsuarios: any[]) {
    // Cache para el Robot V2 (necesita expandir roles → personas)
    this.plantillaUsuarios = todosLosUsuarios;
    this.dispararRobotManual();
    this.calcularExplicacionSinTareas(todosLosUsuarios);

    const todasLasSucursales = [
      'ADMINISTRADORES DEL SISTEMA', 'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
      'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro', 'OFICINAS CORPORATIVAS',
      'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD', 'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO', 'CEDIS'
    ];

    // Version VIVA del usuario actual (no la stale del localStorage).
    // IMPORTANTE: identificamos SOLO por `uid` (identidad estable). NUNCA por
    // `usuario` a secas: si dos cuentas comparten nombre de usuario (o viene
    // vacío), el match traía a OTRA persona y sobrescribía `md_sesion_actual`
    // con su perfil — ese era el bug de "la app se abre en otra cuenta sola".
    // Si no hay uid o no hay match confiable, dejamos la sesión intacta.
    const miUid = this.currentUser?.uid;
    const yoVivoReal = miUid ? todosLosUsuarios.find((u: any) => u.uid === miUid) : null;
    const yoVivo = yoVivoReal || this.currentUser;
    // Solo persistimos cuando el match fue por uid (confiable).
    if (yoVivoReal && yoVivoReal !== this.currentUser) {
      this.currentUser = { ...this.currentUser, ...yoVivoReal };
      try { localStorage.setItem('md_sesion_actual', JSON.stringify(this.currentUser)); } catch (e) { /* noop */ }
    }

    // SUCURSALES DISPONIBLES
    if (esAdminGlobal(yoVivo)) {
      this.sucursalesDisponibles.set(todasLasSucursales);
    } else if (esAdminLimitado(yoVivo) || yoVivo?.puedeCrearChecklists) {
      const permitidas = sucursalesPermitidas(yoVivo);
      if (permitidas === null) {
        // null = acceso a TODAS (admin con comodin 'General (Acceso Total)').
        // OJO: antes esto se volvia [] y dejaba la lista vacia (bug de Ivette).
        this.sucursalesDisponibles.set(todasLasSucursales.filter(s => s !== 'ADMINISTRADORES DEL SISTEMA'));
      } else {
        const misSucNorm = new Set(permitidas.map(s => normalizarNombre(s)));
        const sucursalesFiltradas = todasLasSucursales.filter(
          s => s !== 'ADMINISTRADORES DEL SISTEMA' && s !== 'MANTENIMIENTO'
               && misSucNorm.has(normalizarNombre(s))
        );
        if (sucursalesFiltradas.length === 0) {
          console.warn('[checklist] Lista de sucursales vacia para Nueva Tarea. ' +
            `rol=${yoVivo?.rol} alcance=${yoVivo?.alcance} ` +
            `sucursales=${JSON.stringify(yoVivo?.sucursales)} ` +
            `puedeCrearChecklists=${!!yoVivo?.puedeCrearChecklists}. ` +
            'Si tienes sucursales asignadas, verifica que esten escritas exactamente como en el catalogo (tildes, mayusculas).');
        }
        // MANTENIMIENTO es una capacidad transversal: cualquiera que pueda crear
        // tareas puede levantar una orden de mantenimiento, sin tener que meterla
        // en sus sucursales (antes eso pisaba su departamento real al "darles" la
        // seccion). Siempre la ofrecemos como ultima opcion.
        this.sucursalesDisponibles.set([...sucursalesFiltradas, 'MANTENIMIENTO']);
      }
    } else {
      this.sucursalesDisponibles.set([]);
      console.warn('[checklist] No tienes permisos para crear tareas. ' +
        `rol=${yoVivo?.rol} alcance=${yoVivo?.alcance} ` +
        `puedeCrearChecklists=${!!yoVivo?.puedeCrearChecklists}. ` +
        'Si esto es un error, pidele al admin global que te active "Crear checklists" o te haga admin limitado.');
    }

    // Admins globales (para wizard de Tareas en Equipo)
    const globales = todosLosUsuarios.filter((u: any) =>
      u.rol === 'admin' && ((u.alcance ?? 'global') === 'global'
                            || (u.sucursales || []).includes('General (Acceso Total)'))
    );
    this.adminsGlobales.set(globales);

    // Empleados que el usuario actual puede asignar
    if (esAdminGlobal(this.currentUser)) {
      const personalActivo = todosLosUsuarios.filter((u: any) => u.rol === 'trabajador' || u.rol === 'admin');
      this.empleados.set(personalActivo);
    } else if (esAdminLimitado(this.currentUser) || this.currentUser?.puedeCrearChecklists) {
      const permitidas = sucursalesPermitidas(this.currentUser);
      // Aquí el `?? []` SÍ es correcto, y conviene decir por qué para que nadie
      // lo "arregle" como los otros cuatro: `puedeSerAsignado` trata la lista
      // objetivo vacía como SIN FILTRO y devuelve true (permisos.util.ts:322),
      // así que el `null` de «todas» acaba dando todas. Es correcto por el
      // camino contrario al de `alcanceCubre`, donde una lista vacía esconde
      // todo. Dos funciones que reciben `[]` y significan lo opuesto.
      const misSucursales = permitidas ?? [];
      // Candidatos: trabajadores + admins (incluye admin global). Algunos cargos
      // operativos tienen cuenta admin y aun asi deben poder recibir tareas.
      const candidatos = todosLosUsuarios.filter((u: any) => u.rol === 'trabajador' || u.rol === 'admin');
      // Asignables en las sucursales del usuario actual (normalizado; admin global
      // y comodín 'General (Acceso Total)' pasan en cualquier sucursal).
      const empleadosFiltrados = candidatos.filter((t: any) => puedeSerAsignado(t, misSucursales));
      this.empleados.set(empleadosFiltrados);
    }
  }

  conectarRadarNube() {
    // La coleccion `usuarios` ya viene por UsuariosService (listener compartido).
    // El effect _usuariosEffect llama procesarUsuariosCompartidos() cada vez que
    // se actualiza. No abrimos onSnapshot duplicado aqui.

    // 🤖 ROBOT DE MANUAL: reintento periódico de la entrega del día.
    //
    // Ya no se consultan `moldes_checklists`, `catalogo_rutinas` ni
    // `asignaciones_rutinas`: el modelo de rutinas quedó retirado y sus tablas
    // se conservan solo como historial. Lo que se necesita es la plantilla, y
    // esa llega por el listener compartido de UsuariosService, que dispara
    // `dispararRobotManual()` desde procesarUsuariosCompartidos().
    //
    // Este intervalo existe por dos razones concretas: que la primera corrida
    // pudo fallar por red, y que a media jornada puede cambiar un descanso o un
    // turno. El robot es idempotente, así que reintentar no cuesta nada, y su
    // propio freno de cadencia decide si la vuelta llega a hacer trabajo.
    const idRadarManual = setInterval(() => this.dispararRobotManual(), 5 * 60 * 1000);
    this.destructoresRadares.push(() => clearInterval(idRadarManual));

    // 🕐 Config de turnos de Canindo: para bloquear asignaciones fuera de turno.
    // FERROCARRIL Etapa 9 (config): turnos desde Postgres (poll; antes onSnapshot).
    const recargarTurnos = async () => {
      const resp = await this.api.get('/api/config?id=turnos').catch(() => null);
      if (!resp) return;
      this.configTurnos.set((resp.item as ConfigTurnos) || null);
    };
    recargarTurnos();
    const idRadarTurnos = setInterval(recargarTurnos, 20000);
    this.destructoresRadares.push(() => clearInterval(idRadarTurnos));

    // 🔁 Tareas recurrentes personales del usuario: las regenera para hoy si aplican.
    const miUid = this.miUid();
    if (miUid) {
      // FERROCARRIL Etapa 8: rutinas_personales del usuario desde Postgres (poll).
      const recargarRP = async () => {
        const resp = await this.api.get('/api/rutinas-personales?uid=' + encodeURIComponent(miUid))
          .catch((e: any) => { console.error('[checklist] poll rutinas personales', e); return null; });
        if (!resp) return;
        this.misRutinasPersonales.set(resp.items || []);
        this.generarRutinasPersonalesDeHoy();
      };
      recargarRP();
      const idRadarRP = setInterval(recargarRP, 20000);
      this.destructoresRadares.push(() => clearInterval(idRadarRP));
    }

    // 📅 SOLO HOY: el trabajador ve únicamente las tareas del día de hoy.
    // Las que vencieron su HORA siguen siendo de hoy, así que siguen apareciendo
    // y se pueden enviar con retardo (con justificante). NO se arrastran días
    // anteriores: las de ayer ya son historia.
    const offset = new Date().getTimezoneOffset() * 60000;
    const fechaHoyLocal = new Date(Date.now() - offset).toISOString().split('T')[0];

    // 🔒 Lee la sesión actualizada desde localStorage en CADA snapshot. Si solo
    // usamos `this.currentUser` (que se setea una vez en ngOnInit), una persona
    // que cambió permisos vería el filtro viejo hasta que cierre sesión y vuelva.
    // Mismo patrón que home.ts.
    const leerSesion = (): any => {
      try { return JSON.parse(localStorage.getItem('md_sesion_actual') || 'null'); }
      catch { return null; }
    };

    // 🗓️ Ventana hacia atrás: SOLO para usuarios de Espacio TEC traemos hasta 45
    // días atrás para mostrar tareas ATRASADAS (no enviadas de días pasados). Los
    // demás usuarios ven solo de hoy en adelante, como estaban.
    const esTec = this.esUsuarioTec;
    const hace45 = new Date(Date.now() - offset - 45 * 86400000).toISOString().split('T')[0];
    const desde = esTec ? hace45 : fechaHoyLocal;
    // FERROCARRIL Etapa 3: antes onSnapshot(checklists, where date>=desde); ahora
    // poll periódico a Postgres (GET /api/checklists?desde=..). La lógica de
    // post-proceso (filtros por rol, dedup, progreso, diagnóstico) queda IGUAL.
    const claveUsuario = (s: any) => String(s?.uid || s?.id || s?.usuario || 'anon');
    const recargarChecklists = async () => {
      let falla: any = null;
      const resp = await this.api.get('/api/checklists?desde=' + encodeURIComponent(desde))
        .catch((e: any) => { falla = e; console.error('[checklist] poll PG', e); return null; });
      if (!resp) {
        // Falló la lectura: NO vaciar. Marcamos el aviso (con el motivo real, que
        // no siempre es el internet) y, si aún no tenemos nada en pantalla (p.ej.
        // recién se abrió/recargó la vista), hidratamos desde la última lista
        // buena guardada para no mostrar vacío.
        this.sinConexion.set(true);
        this.aviso.set(avisoDeFalla(falla));
        if (this.checklists().length === 0) {
          const cache = leerListaCacheConEdad('checklists', claveUsuario(leerSesion() || this.currentUser));
          if (cache && cache.lista.length) {
            this.checklists.set(cache.lista);
            this.edadDatos.set(textoAntiguedad(cache.edadMinutos));
          }
        }
        return;
      }
      this.sinConexion.set(false);
      this.edadDatos.set('');   // datos frescos de la nube
      const filas: any[] = resp.checklists || [];
      const todasLasListas: any[] = [];
      let descartadosEnviados = 0;
      let descartadosEliminados = 0;
      let descartadosFecha = 0;
      // 🩺 Diagnóstico: guarda los assigned de TODO lo que existe hoy (incluye
      // enviados/eliminados), separado por motivo. Permite ver si el checklist
      // del usuario existe pero quedó marcado como enviado/eliminado.
      const muestraEnviados: { id: string; assigned: string; name: string }[] = [];
      const muestraEliminados: { id: string; assigned: string; name: string }[] = [];
      const todosAssignedHoy = new Set<string>();

      filas.forEach((c: any) => {
        const docId = c.id;
        if (c.date === fechaHoyLocal && c.assigned) todosAssignedHoy.add(c.assigned);
        if (c.eliminado === true || c.archivado === true) {
          descartadosEliminados++;
          if (c.assigned) muestraEliminados.push({ id: docId, assigned: c.assigned, name: c.name });
          return;
        }
        if (c.enviado === true) {
          descartadosEnviados++;
          if (c.assigned) muestraEnviados.push({ id: docId, assigned: c.assigned, name: c.name });
          return;
        }
        // HOY + FUTURAS: el query trae de hoy en adelante. Antes descartábamos las
        // futuras (las tareas programadas para más adelante no aparecían). Ahora las
        // incluimos y las marcamos como "esFutura" para distinguirlas en la tarjeta.
        c.esFutura = c.date > fechaHoyLocal;
        // Tarea de un día pasado que sigue viva (no enviada ni eliminada) → atrasada.
        // Solo para TEC (para el resto el query ni siquiera trae días pasados).
        c.esAtrasada = esTec && c.date < fechaHoyLocal;
        if (c.esFutura) descartadosFecha++; // contador solo para diagnóstico
        // 🔢 Progreso visual: una tarea cuenta como completa si TIENE su evidencia
        // (foto / antes+después / varias fotos / palomeo) O si el checklist trae
        // una nota del colaborador o se entregó con retraso justificado. Usamos
        // el helper unificado para mantener consistencia con Dashboard, Auditoría,
        // Checkstore, Estadísticas y Ranking.
        const tareasMarcadas = (c.items || []).filter((i: any) => esItemHecho(i, c)).length;
        c.calcCompletados = tareasMarcadas;
        c.calcProgreso = Math.round((tareasMarcadas / (c.items?.length || 1)) * 100) || 0;
        todasLasListas.push(c);
      });

      const listasSinClones = new Map();
      todasLasListas.forEach(c => {
        const firma = `${c.name}_${c.assigned}_${c.store}_${c.date}`;
        if (!listasSinClones.has(firma)) {
          listasSinClones.set(firma, c);
        } else {
          const existente = listasSinClones.get(firma);
          if (c.calcProgreso > existente.calcProgreso) listasSinClones.set(firma, c);
        }
      });
      const listasFinales = Array.from(listasSinClones.values());
      listasFinales.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return b.timestampCreacion - a.timestampCreacion;
      });

      // Recalculamos permisos cada vez desde la sesión FRESCA en localStorage
      // (currentUser podría estar viejo si el admin le cambió permisos).
      const sesion = leerSesion() || this.currentUser;
      const esGlobal = esAdminGlobal(sesion);
      const esLimitado = esAdminLimitado(sesion);
      const supervisor = esSupervisor(sesion);
      const permitidas = sucursalesPermitidas(sesion);
      const esTrabajadorPuro = sesion?.rol === 'trabajador' && !supervisor;

      let resultado: any[];
      let rama: string;
      if (esGlobal) {
        rama = 'admin-global';
        resultado = listasFinales;
      } else if (esLimitado) {
        rama = 'admin-limitado';
        resultado = listasFinales.filter((c: any) => alcanceCubre(permitidas, c.store));
      } else if (supervisor) {
        // ⚠ ESTA ES LA RAMA DE LA CAPTURA DEL 15/sep. Con `(permitidas ?? [])`,
        // una Jefa de Zona con el comodín «General (Acceso Total)» filtraba
        // contra una lista VACÍA, así que no le quedaba ni una tarea —ni las de
        // su equipo ni las suyas—, y la pantalla decía «No tienes tareas hoy»
        // con sus checklists vivos en la base. Ver `alcanceCubre`.
        rama = 'supervisor';
        resultado = listasFinales.filter((c: any) => alcanceCubre(permitidas, c.store));
      } else {
        rama = 'trabajador-puro';
        // 🔥 Match tolerante: tildes/espacios/casing + apellido extra/de menos
        // (perfil "Jorge Alberto Duarte Vazquez" matchea assigned "Jorge Alberto Duarte").
        const miNombre = sesion?.nombre;
        resultado = listasFinales.filter((c: any) => mismoEmpleadoNombre(c.assigned, miNombre));
      }

      // ✂️ AREAS TRANSVERSALES (20/sep) — MANTENIMIENTO y SISTEMAS.
      //
      // Va DESPUES de las ramas y no dentro de cada una, para que ninguna se
      // quede sin el recorte por descuido cuando alguien añada la sexta.
      //
      // `pasaFiltroTransversal` se auto-acota: devuelve true para todo lo que
      // no sea de esas dos areas y para todo el que no sea operacion de zona,
      // asi que aqui no hace falta repetir ninguna condicion de rol.
      //
      // Por que hacia falta: la ficha de una Encargada lleva MANTENIMIENTO y
      // SISTEMAS en `sucursales[]` —estan ahi para que pueda levantar un
      // ticket, no porque trabaje ahi— y `alcanceCubre` casa el `store`
      // contra esa lista, asi que le ensenaba las ordenes de las otras siete
      // tiendas. Ahora solo ve las que su sucursal origino, las que ella
      // levanto y las que le asignaron.
      const antesTransversal = resultado.length;
      resultado = resultado.filter((c: any) => pasaFiltroTransversal(sesion, c, permitidas));
      const recortadasPorArea = antesTransversal - resultado.length;

      // Ajuste de atrasadas (solo TEC): sin diarias y, por tarea recurrente, solo
      // la más reciente. Para el resto no hay atrasadas, así que se deja igual.
      if (esTec) resultado = this.depurarAtrasadas(resultado);

      this.checklists.set(resultado);
      // 💾 Guardamos la lista buena para poder mostrarla si un próximo poll falla
      // por red (evita la pantalla vacía que parece "se borraron las tareas").
      guardarListaCache('checklists', claveUsuario(sesion), resultado);

      // 🐛 DEBUG para diagnosticar por qué un usuario ve 0 tareas.
      // Guardamos en `ultimoDiagnostico` para mostrar inline (móvil sin consola).
      // Resaltamos los checklists que matchearían contra el nombre del usuario,
      // separando los que están vivos vs los marcados como enviados/eliminados.
      const miNombre = sesion?.nombre || '';
      const matcheaUsuario = (assigned: string) => mismoEmpleadoNombre(assigned, miNombre);
      this.ultimoDiagnostico = {
        usuario: sesion?.usuario, nombre: sesion?.nombre, rol: sesion?.rol,
        alcance: sesion?.alcance, sucursales: sesion?.sucursales,
        rama, descartadosEliminados, descartadosEnviados, descartadosFecha,
        // ✂️ Cuantas se quitaron por ser de MANTENIMIENTO o SISTEMAS sin que
        // esta sucursal las originara (20/sep). Va aqui porque el recorte es
        // MUDO en pantalla: una Encargada que hoy veia doce ordenes y manana ve
        // dos no tiene forma de saber por que, y lo va a reportar como que se
        // perdieron. Con esta cifra la respuesta se da en un vistazo, sin
        // ponerle un cartel en medio del turno por algo que es correcto.
        recortadasPorArea,
        crudoTrasFiltro: listasFinales.length, resultadoFinal: resultado.length,
        fechaHoyLocal,
        // Lista única de empleados con tareas hoy (en cualquier estado)
        empleadosConTareasHoy: Array.from(todosAssignedHoy).sort(),
        // ¿Existen tareas para este usuario en otros estados?
        misEnviadosHoy: muestraEnviados.filter(x => matcheaUsuario(x.assigned)),
        misEliminadosHoy: muestraEliminados.filter(x => matcheaUsuario(x.assigned)),
        primerosAssigned: resultado.slice(0, 3).map((c: any) => c.assigned),
        crudoAssignedMuestra: listasFinales.slice(0, 10).map((c: any) => `${c.assigned}@${c.store} [${c.date}]`)
      };
      console.log('[DBG checklist]', this.ultimoDiagnostico);

      if (esTrabajadorPuro) {
        // Solo cuentan las de HOY para la alerta de "nueva tarea"; las futuras no
        // deben disparar la notificación antes de tiempo.
        const pendientesActuales = resultado.filter((c: any) => !c.esFutura && c.status !== 'completo' && c.enviado !== true).length;
        if (this.cantidadPendientesAnterior !== -1 && pendientesActuales > this.cantidadPendientesAnterior) {
          this.lanzarNotificacionInmediata();
        }
        this.cantidadPendientesAnterior = pendientesActuales;
      }
    };
    // Hidratación inmediata desde la última lista buena: si la vista se acaba de
    // abrir/recargar, se pinta al instante (aunque haya mala señal) y el primer
    // poll la refresca en cuanto responda la nube.
    if (this.checklists().length === 0) {
      const cacheInicial = leerListaCacheConEdad('checklists', claveUsuario(leerSesion() || this.currentUser));
      if (cacheInicial && cacheInicial.lista.length) {
        this.checklists.set(cacheInicial.lista);
        this.edadDatos.set(textoAntiguedad(cacheInicial.edadMinutos));
      }
    }
    // Se guarda la referencia para poder FORZAR una recarga desde fuera (lo usa
    // la entrega a mano desde el catálogo). Sin esto, la tarea recién asignada
    // tardaría hasta 20 segundos en aparecer y quien la asignó creería que no
    // se guardó — y volvería a pulsar.
    this.recargarChecklistsAhora = recargarChecklists;
    recargarChecklists();
    const idRadarChecklists = setInterval(recargarChecklists, 20000);
    this.destructoresRadares.push(() => clearInterval(idRadarChecklists));

    // Radar de Tareas de Equipo (colección separada `tareas_equipo`).
    // Cada usuario solo ve las tareas donde es integrante, jefe o admin.
    // FERROCARRIL Etapa 7: tareas_equipo desde Postgres (poll; antes onSnapshot).
    const recargarTareasEquipo = async () => {
      const resp = await this.api.get('/api/tareas-equipo').catch((e: any) => { console.error('[checklist] poll tareas equipo', e); return null; });
      if (!resp) return;
      const sesion = leerSesion() || this.currentUser;
      const esGlobal = esAdminGlobal(sesion);
      const esLimitado = esAdminLimitado(sesion);
      const permitidas = sucursalesPermitidas(sesion);
      const miNombre = sesion?.nombre;

      const arr: TareaEquipo[] = [];
      (resp.items || []).forEach((data: any) => {
        const tarea: TareaEquipo = { ...data, id: data.id };
        // Eliminado con el botón de borrar: fuera de la lista para todos. El
        // registro sigue en la base, nada más deja de mostrarse.
        if ((tarea as any).eliminado === true) return;
        if (tarea.cerrado === true && esAdminGlobal(sesion) === false) {
          // Trabajadores y admins limitados no ven proyectos cerrados (limpieza visual)
          return;
        }
        // Filtro por sucursal / rol
        if (esGlobal) {
          arr.push(tarea);
        } else if (esLimitado) {
          if (alcanceCubre(permitidas, tarea.store)) arr.push(tarea);
        } else {
          // Trabajador: solo si está como integrante o jefe del proyecto
          if (mismoEmpleadoNombre(tarea.jefeEquipo, miNombre) ||
              (tarea.integrantes || []).some(n => mismoEmpleadoNombre(n, miNombre))) {
            arr.push(tarea);
          }
        }
      });
      arr.sort((a, b) => (b.timestampCreacion || 0) - (a.timestampCreacion || 0));
      this.tareasEquipo.set(arr);

      // 🔄 Mantener el DETALLE abierto sincronizado con los cambios en vivo.
      // Sin esto, al completar un item / agregar tarea / cerrar fase, se guardaba
      // pero la pantalla del proyecto seguía mostrando los datos viejos.
      const sel = this.tareaEquipoSeleccionada();
      if (sel) {
        const actualizado = arr.find(t => t.id === sel.id);
        if (actualizado) this.tareaEquipoSeleccionada.set(actualizado);
      }
    };
    // 🧹 Con el apartado retirado no se pide la colección: sin esto seguirían
    // saliendo tres peticiones por minuto por cliente abierto para llenar una
    // lista que ya nadie ve.
    if (this.MOSTRAR_TAREAS_EQUIPO) {
      recargarTareasEquipo();
      const idRadarTareasEquipo = setInterval(recargarTareasEquipo, 20000);
      this.destructoresRadares.push(() => clearInterval(idRadarTareasEquipo));
    }

    // Notificaciones (campana): migradas a Postgres (API). Poll cada 20s.
    this.cargarNotificaciones();
    const notiPoll = setInterval(() => this.cargarNotificaciones(), 20000);
    this.destructoresRadares.push(() => clearInterval(notiPoll));
  }

  /** Carga las alertas NO leídas del usuario actual desde /api/notificaciones. */
  async cargarNotificaciones() {
    const nombre = this.currentUser?.nombre;
    if (!nombre) return;
    try {
      const r = await this.api.get('/api/notificaciones?empleado=' + encodeURIComponent(nombre));
      this.notificacionesPendientes.set(r.notificaciones || []);
    } catch (e) {
      console.error('[checklist] cargarNotificaciones', e);
    }
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
    try {
      await this.api.post('/api/notificaciones', {
        empleado: this.empleadoParaNotificar,
        mensaje: this.mensajeNotificacion,
        de: this.currentUser?.nombre || 'Gerencia'
      });
      this.mostrarToast(` 🔔 ¡Zumbido enviado a ${this.empleadoParaNotificar}!`);
      this.cerrarModalNotificacion();
    } catch (error) { alert('Error al enviar la alerta.'); }
  }

  async marcarNotificacionComoLeida(noti: any) {
    // Optimista: la quitamos de la lista y marcamos leída en la API.
    this.notificacionesPendientes.set(this.notificacionesPendientes().filter(n => n.id !== noti.id));
    try { await this.api.patch('/api/notificaciones', { id: noti.id }); }
    catch (error) { console.error('Error cerrando notificación', error); }
  }

  getPrimerasTareas(checklist: any): any[] {
    if (!checklist || !checklist.items) return [];
    return checklist.items.slice(0, 4);
  }

  /** Hora límite (epoch) de la tarea, o null si no se puede calcular. */
  /**
   * ⚠ EL CUERPO SE MUDÓ A `shared/urgencia-tarea.util.ts` (18/sep/2026).
   *
   * No cambió una coma de la regla: esto es un delegado. Se mudó porque la
   * cuenta regresiva de la tarjeta («Vence en 30 min») necesita el MISMO
   * límite con el que se juzga el retraso, y dejarlo privado aquí obligaba a
   * escribir una segunda versión «parecida» en el util. Dos reglas libres de
   * discrepar sobre el retraso de una persona, en silencio (§8.11 d).
   *
   * Los tres sitios que ya lo llamaban no se tocaron.
   */
  private limiteDeTarea(item: any, checklistDate: string, checklistTime?: string): number | null {
    return limiteDeItem(item, checklistDate, checklistTime);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  ⏰ EL RELOJ DE LA PANTALLA
  // ══════════════════════════════════════════════════════════════════════════
  /**
   * El «ahora» con el que se pintan las cuentas regresivas.
   *
   * NO se usa `Date.now()` dentro de los getters de la plantilla, y el motivo
   * no es rendimiento: en modo desarrollo Angular corre la detección de cambios
   * DOS veces por tick, así que si el minuto cambiara entre las dos pasadas la
   * cadena sería distinta y saltaría `ExpressionChangedAfterItHasBeenChecked`.
   * Con un valor fijo por tick, las dos pasadas leen lo mismo.
   *
   * Se refresca cada 30 s —la mitad del minuto que se muestra, para que ningún
   * minuto se salte— y el intervalo se apaga en `ngOnDestroy`.
   */
  ahoraReloj = Date.now();
  private relojId: any = null;

  /** La urgencia del checklist entero, que es lo que se pinta en la tarjeta. */
  urgenciaDe(checklist: any): Urgencia {
    return urgenciaDeChecklist(
      checklist?.items || [], checklist?.date, checklist?.time,
      (i: any) => this.esItemCompleto(i), this.ahoraReloj,
    );
  }

  /**
   * La clase para la pastilla. Devuelve CADENA y no el objeto de urgencia a
   * propósito: la plantilla lo llama una vez por tarjeta en cada ciclo de
   * detección, y un objeto nuevo cada vez es justo lo que tumbó el sidebar el
   * 1/sep. Una cadena compara por valor y no hace nada.
   */
  claseUrgencia(checklist: any): ClaseUrgencia | '' {
    const u = this.urgenciaDe(checklist);
    return u.minutos == null || u.clase === 'a_tiempo' ? '' : u.clase;
  }

  /** La frase, con la hora formateada por el MISMO `formatearHora` de la pantalla. */
  textoUrgenciaDe(checklist: any): string {
    const u = this.urgenciaDe(checklist);
    const hora = u.limite != null
      ? this.formatearHora(new Date(u.limite).toTimeString().slice(0, 5))
      : '';
    return textoUrgencia(u, hora);
  }

  /**
   * ¿Los puntos de este checklist tienen horas límite DISTINTAS?
   *
   * Decide si se pinta el chip de «se pasó la hora» punto por punto. Cuando
   * todos comparten ventana —que es el caso del manual— el chip diría lo mismo
   * en cada renglón, debajo de un aviso que ya lo dijo: es el párrafo repetido
   * que este paso vino a quitar, en pequeño. Se vio MIRANDO la captura, no
   * midiendo: las tres aserciones del arnés estaban en verde.
   *
   * Con horas distintas sí hace falta, porque el aviso de arriba solo puede
   * nombrar el más próximo y no habría forma de saber cuál de los puntos es.
   */
  horasLimiteDistintas(checklist: any): boolean {
    const horas = new Set(
      (checklist?.items || []).map((i: any) => i?.horaLimite || i?.time || checklist?.time || ''),
    );
    return horas.size > 1;
  }

  /** Cuántos puntos siguen sin prueba. Es el número que va en el botón de enviar. */
  puntosSinPrueba(checklist: any): any[] {
    return (checklist?.items || []).filter((i: any) => !this.esItemCompleto(i));
  }

  /**
   * Lo que dice el botón de enviar.
   *
   * Dice «fotos» solo cuando TODO lo que falta son fotos. Si entre lo que falta
   * hay un punto que se cierra palomeando, «te faltan 3 fotos» mandaría a buscar
   * una cámara para algo que no la lleva.
   */
  etiquetaEnvio(checklist: any): string {
    const faltan = this.puntosSinPrueba(checklist);
    if (!faltan.length) return 'Confirmar y Enviar';
    const todasFoto = faltan.every((i: any) => this.pideEvidencia(i));
    const que = todasFoto
      ? (faltan.length === 1 ? 'foto' : 'fotos')
      : (faltan.length === 1 ? 'punto' : 'puntos');
    return 'Enviar — te ' + (faltan.length === 1 ? 'falta' : 'faltan') + ' ' + faltan.length + ' ' + que;
  }

  /** ¿Ya pasó su hora límite? Es para MOSTRARLA como vencida, no para el justificante. */
  isTareaVencida(item: any, checklistDate: string, checklistTime?: string): boolean {
    const limite = this.limiteDeTarea(item, checklistDate, checklistTime);
    return limite != null && Date.now() > limite;
  }

  /** "08:45 PM" (formato de photoTime/photoDespuesTime) + la fecha -> epoch. */
  private horaAmPmEpoch(fecha: string, txt: any): number | null {
    const m = /^\s*(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]\.?\s*$/.exec(String(txt || ''));
    if (!m || !fecha) return null;
    let h = Number(m[1]) % 12;
    if (m[3].toLowerCase() === 'p') h += 12;
    const [year, month, day] = fecha.split('-');
    return new Date(Number(year), Number(month) - 1, Number(day), h, Number(m[2]), 0).getTime();
  }

  /**
   * CUÁNDO quedó lista la tarea (epoch), o null si no hay sello de tiempo.
   * Se toma el sello más TARDÍO de lo que exigía: la foto de DESPUÉS manda sobre
   * la de ANTES, y la última de "varias" sobre las anteriores.
   */
  private completadaEn(item: any, fecha: string): number | null {
    if (!item || !fecha) return null;
    const sellos: number[] = [];
    const push = (v: any) => { const n = Number(v); if (n > 0) sellos.push(n); };
    if (item.requiresAntesDespues) {
      push(item.photoDespuesTimestamp);
      push(this.horaAmPmEpoch(fecha, item.photoDespuesTime));
      if (!sellos.length) { push(item.photoAntesTimestamp); push(this.horaAmPmEpoch(fecha, item.photoAntesTime)); }
    } else if (item.requiresVariasFotos) {
      for (const f of (Array.isArray(item.photos) ? item.photos : [])) {
        push(f?.timestamp);
        push(this.horaAmPmEpoch(fecha, f?.time));
      }
    } else if (item.requiresPhoto) {
      push(item.photoTimestamp);
      push(this.horaAmPmEpoch(fecha, item.photoTime));
    } else {
      push(item.checkedEn);
    }
    return sellos.length ? Math.max(...sellos) : null;
  }

  /**
   * ¿Esta tarea se entrega CON RETRASO? (lo que obliga a dar justificante)
   *
   * ⚠️ NO es isTareaVencida(). Antes sí lo era, y ese era el bug: comparaba la
   * hora límite contra AHORA aunque la tarea llevara horas hecha, así que quien
   * terminaba a las 07:50 con límite 08:00 y le daba a "Enviar" a las 08:05
   * tenía que justificar un retraso que no existió.
   *
   * Ahora manda CUÁNDO se hizo. Si está hecha pero no hay sello (datos de antes
   * de que se guardaran), se conserva el criterio viejo: no se puede probar que
   * fue a tiempo, y abrir la mano ahí dejaría pasar retrasos reales.
   */
  entregadaTarde(item: any, checklist: any): boolean {
    const limite = this.limiteDeTarea(item, checklist?.date, checklist?.time);
    if (limite == null) return false;
    const cuando = this.esItemCompleto(item) ? this.completadaEn(item, checklist.date) : null;
    return (cuando != null ? cuando : Date.now()) > limite;
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
    if (rutina.frecuencia === 'Catorcenal') return `Cada 2 semanas, los ${rutina.diaSemana || 'Lunes'}`;
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

  /**
   * 🤖 Robot de Manual: entrega las tareas del día según el PUESTO de cada
   * persona, tomadas de su Manual Corporativo de Operación.
   *
   * Se dispara cada vez que se actualiza la plantilla. Es idempotente: el
   * service no recrea un checklist que ya existe, así que puede correr tantas
   * veces como haga falta sin duplicar ni pisar lo ya contestado.
   *
   * No necesita catálogo ni asignaciones: no hay nada que capturar. Quien tiene
   * puesto y manual, recibe sus tareas.
   */
  private dispararRobotManual() {
    if (this.robotManualCorriendo) return;
    if (!this.plantillaUsuarios.length) return;
    // Freno de cadencia (ver ROBOT_MANUAL_ESPERA_MS). La primera corrida pasa
    // derecho porque `ultimaCorrida` arranca en 0.
    if (Date.now() - this.robotManualUltimaCorrida < this.ROBOT_MANUAL_ESPERA_MS) return;

    this.robotManualCorriendo = true;
    this.robotManual.generarTareasDeFecha(
      this.plantillaUsuarios,
      new Date(),
      {
        esDiaCerrado: (suc, f) => this.esDiaCerrado(suc, f),
        esSucursalAdministrativa: (suc) => this.esSucursalAdministrativa(suc)
      }
    ).then(r => {
      if (r.creados > 0) console.log(`[Robot Manual] ${r.creados} tarea(s) de manual entregadas.`);
    }).catch(err => {
      console.error('[Robot Manual] Error al generar tareas:', err);
    }).finally(() => {
      this.robotManualUltimaCorrida = Date.now();
      this.robotManualCorriendo = false;
    });
  }

  async guardarEnLaNube(checklist: any) {
    try { await setDoc(doc(this.firestore, 'checklists', checklist.id.toString()), checklist, { merge: true }); }
    catch (error) { console.error("Error: ", error); }
    // Dual-write FERROCARRIL: mismo id en Postgres (upsert completo). Best-effort.
    await this.api.guardarChecklist({ ...checklist, id: checklist.id.toString() });
  }

  // ==========================================================================
  // TAREA PROPIA DEL DÍA — el trabajador suma una tarea/extra a sus rutinas de hoy
  // ==========================================================================
  abrirModalTareaDia() {
    this.resetCamposTareaDia();
    this.isModalTareaDiaOpen = true;
  }

  cerrarModalTareaDia() { this.isModalTareaDiaOpen = false; }

  private resetCamposTareaDia() {
    this.tareaDiaTexto = '';
    this.tareaDiaHora = '';
    this.tareaDiaFrecuencia = 'unica';
    this.tareaDiaDiaSemana = 1;
    this.tareaDiaDiaMes = 1;
    this.tareaDiaFechaAnual = '';
    this.editandoTareaPropiaId = null;
    this.tareaDiaActividades = [];
    this.nuevaActividadTexto = '';
    this.tareaDiaPermiteFotos = false;
  }

  agregarActividadDia() {
    const t = this.nuevaActividadTexto.trim();
    if (!t) return;
    this.tareaDiaActividades = [...this.tareaDiaActividades, t];
    this.nuevaActividadTexto = '';
  }
  quitarActividadDia(i: number) {
    const arr = [...this.tareaDiaActividades];
    arr.splice(i, 1);
    this.tareaDiaActividades = arr;
  }

  /**
   * Construye los items (casillas) de una tarea propia.
   * Si hay actividades, una casilla por actividad; si no, una sola con el nombre.
   * `previos` permite conservar el estado "marcado" al editar.
   */
  private construirItemsPersonal(nombreTarea: string, actividades: string[], hora: string, previos?: any[], permiteFotos = false): any[] {
    const base = Date.now();
    const lista = (actividades && actividades.length) ? actividades : [nombreTarea];
    return lista.map((txt, i) => {
      const prev = previos?.find(p => (p.text || '').trim() === txt.trim());
      return {
        id: base + i, text: txt,
        requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false,
        // permiteFotos: adjuntar fotos OPCIONALES (varias). permiteGaleria en true
        // deja que el botón abra cámara O galería.
        permiteFotos, permiteGaleria: permiteFotos, permiteDocumentos: false,
        checked: prev?.checked || false,
        photo: null, photoTime: null, photoAntes: null, photoAntesTime: null,
        // Conserva las fotos ya adjuntadas al editar la tarea.
        photoAntesTimestamp: null, photoDespues: null, photoDespuesTime: null,
        photos: Array.isArray(prev?.photos) ? prev!.photos : [],
        tipo: 'manual', horaInicio: null, horaLimite: hora || null, frecuencia: null
      };
    });
  }

  /** Identificador estable del usuario actual. */
  private miUid(): string { return this.currentUser?.uid || this.currentUser?.id || ''; }

  // ---- Tareas recurrentes personales (coleccion rutinas_personales) ----

  /** Etiqueta legible de una rutina personal (frecuencia + dia). */
  etiquetaRutinaPersonal(r: any): string {
    switch (r?.frecuencia) {
      case 'Diaria': return 'Diaria';
      case 'Semanal': return 'Semanal (' + (this.diasSemanaOpc.find(d => d.v === Number(r.diaSemana))?.t || '?') + ')';
      case 'Mensual': return 'Mensual (dia ' + r.diaMes + ')';
      case 'Anual': return 'Anual (' + (r.fechaAnual || '') + ')';
      default: return '';
    }
  }

  /** Frase amigable de cuando se repite una rutina personal (para el toast). */
  private descripcionRecurrencia(r: any): string {
    switch (r?.frecuencia) {
      case 'Diaria': return 'todos los dias';
      case 'Semanal': {
        const dia = this.diasSemanaOpc.find(d => d.v === Number(r.diaSemana))?.t || 'el dia elegido';
        return `cada ${dia.toLowerCase()}`;
      }
      case 'Mensual': return `el dia ${r.diaMes} de cada mes`;
      case 'Anual': {
        const [mm, dd] = String(r.fechaAnual || '').split('-');
        return mm && dd ? `cada ${dd}/${mm}` : 'cada ano';
      }
      default: return 'cuando toque';
    }
  }

  private aplicaRutinaPersonalHoy(r: any, hoy: Date): boolean {
    switch (r?.frecuencia) {
      case 'Diaria': return true;
      case 'Semanal': return hoy.getDay() === Number(r.diaSemana);
      case 'Mensual': {
        const diasDelMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
        const objetivo = Math.min(Number(r.diaMes) || 1, diasDelMes); // si es 31 en feb -> ultimo dia
        return hoy.getDate() === objetivo;
      }
      case 'Anual': {
        const mmdd = `${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
        return r.fechaAnual === mmdd;
      }
      default: return false;
    }
  }

  private periodoRutinaPersonal(r: any, hoy: Date): string {
    switch (r?.frecuencia) {
      case 'Semanal': return obtenerSemanaISO(hoy);
      case 'Mensual': return `${hoy.getFullYear()}-${hoy.getMonth() + 1}`;
      case 'Anual': return `${hoy.getFullYear()}`;
      default: return this.hoyIsoStr; // Diaria
    }
  }

  /**
   * Depura las tareas ATRASADAS de la lista para que no se acumulen:
   *   1) Las de frecuencia alta (DIARIA/SEMANAL/CATORCENAL) no se arrastran como
   *      atrasadas (se repiten seguido e inundarían la lista); solo se ve la de
   *      hoy o la próxima. Sí se arrastran las poco frecuentes y las únicas.
   *   2) De una misma tarea recurrente, solo se muestra la atrasada MÁS RECIENTE.
   * Las de hoy/futuras no se tocan.
   */
  private depurarAtrasadas(lista: any[]): any[] {
    const SUFIJO_RECUR = /\((Diaria|Semanal|Catorcenal|Mensual|Trimestral)\)\s*$/;

    // Mapa id-de-rutina → rutina, para leer la frecuencia REAL (confiable, no
    // depende de parsear el id de la instancia).
    const rutinasPorId = new Map<string, any>();
    for (const r of this.misRutinasPersonales()) rutinasPorId.set(r.id, r);

    // Las frecuencias que se repiten seguido (diaria, semanal, catorcenal) NO se
    // arrastran como atrasadas: se acumularían e inundarían la lista. Solo se
    // arrastran las poco frecuentes (mensual/trimestral/anual) y las únicas.
    const esFrecuente = (c: any): boolean => {
      let f = c?.frecuencia;
      if (c?._rutinaPersonalId && rutinasPorId.has(c._rutinaPersonalId)) {
        f = rutinasPorId.get(c._rutinaPersonalId)?.frecuencia || f;
      }
      if (f === 'Diaria' || f === 'Semanal' || f === 'Catorcenal') return true;
      return /\((Diaria|Semanal|Catorcenal)\)\s*$/.test(c?.name || '');
    };

    // Clave de "serie" para agrupar instancias de la misma tarea recurrente.
    // null = tarea única (no se agrupa; se muestra tal cual).
    const claveSerie = (c: any): string | null => {
      if (c?._rutinaPersonalId) return 'rp_' + c._rutinaPersonalId;
      if (SUFIJO_RECUR.test(c?.name || '')) {
        const base = (c.name || '').replace(SUFIJO_RECUR, '').trim();
        return 'mol_' + base + '_' + (c.assigned || '') + '_' + (c.store || '');
      }
      return null;
    };

    const vigentes = lista.filter(c => !c.esAtrasada);
    const atrasadas = lista.filter(c => c.esAtrasada && !esFrecuente(c)); // (1) fuera diarias/semanales

    // (2) por serie recurrente, quedarnos con la de fecha más reciente.
    const mejorPorSerie = new Map<string, any>();
    const unicas: any[] = [];
    for (const c of atrasadas) {
      const clave = claveSerie(c);
      if (!clave) { unicas.push(c); continue; }
      const prev = mejorPorSerie.get(clave);
      if (!prev || String(c.date) > String(prev.date)) mejorPorSerie.set(clave, c);
    }

    return [...vigentes, ...unicas, ...Array.from(mejorPorSerie.values())]
      .sort((a, b) => {
        if (a.date !== b.date) return String(a.date).localeCompare(String(b.date));
        return (b.timestampCreacion || 0) - (a.timestampCreacion || 0);
      });
  }

  private construirChecklistPersonal(r: any, id: string, hoyIso: string): any {
    const ahora = Date.now();
    return {
      id, timestampCreacion: ahora,
      name: r.texto, assigned: r.nombre, store: r.sucursal || this.miSucursalPrincipal(),
      date: hoyIso, time: r.hora || '23:59', status: 'pendiente', enviado: false,
      createdBy: r.createdBy || r.nombre,
      // Si la asignó el Espacio TEC, no es "propia" (el empleado no la edita/borra).
      esTareaPropia: !r.origenTec,
      origenTec: !!r.origenTec,
      _rutinaPersonalId: r.id, frecuencia: r.frecuencia || null, notaEmpleado: '',
      items: this.construirItemsPersonal(r.texto, r.actividades || [], r.hora || '', undefined, !!r.permiteFotos)
    };
  }

  /**
   * Crea (idempotente) las instancias de las rutinas personales que apliquen.
   * Genera la de HOY (si aplica) y además la PRÓXIMA ocurrencia dentro de 45 días,
   * para que una recurrente programada (ej. "mensual el día 15" o "semanal los
   * lunes") se vea de una vez como "Próxima" en vez de aparecer recién el día
   * exacto. Solo la siguiente (no todas) para no llenar la lista de repetidas.
   * Las DIARIAS solo se generan para hoy.
   */
  private async generarRutinasPersonalesDeHoy() {
    const lista = this.misRutinasPersonales();
    if (!lista.length) return;
    const pad = (n: number) => String(n).padStart(2, '0');
    const hoy = new Date();
    // La pre-generación de la PRÓXIMA ocurrencia (para verla como "Próxima") es
    // solo para Espacio TEC. Para los demás se genera únicamente la de hoy.
    const esTec = this.esUsuarioTec;
    for (const r of lista) {
      if (r.activa === false) continue;
      const maxD = (esTec && r.frecuencia !== 'Diaria') ? 45 : 0;
      for (let d = 0; d <= maxD; d++) {
        const fecha = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + d);
        if (!this.aplicaRutinaPersonalHoy(r, fecha)) continue;
        const fechaIso = `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}`;
        const id = `rpers_${r.id}_${this.periodoRutinaPersonal(r, fecha)}`;
        try {
          const ref = doc(this.firestore, 'checklists', id);
          // FAIL-SAFE: si la consulta de existencia FALLA (parpadeo de red en el
          // celular del trabajador), NO recrear: asumimos que existe para no pisar
          // con una rutina personal vacia la que el trabajador ya completo. Ver los
          // robots V1/V2 con el mismo criterio.
          const existe = await this.api.get('/api/checklists?id=' + encodeURIComponent(id))
            .then((x: any) => !!x?.checklist).catch(() => true);
          if (!existe) {
            const nuevo = this.construirChecklistPersonal(r, id, fechaIso);
            await setDoc(ref, nuevo);
            await this.api.guardarChecklist(nuevo);
          }
        } catch (e) {
          console.error('[rutina-personal] error generando', r?.id, e);
        }
        // Ya generamos hoy y/o la próxima ocurrencia: con la primera futura basta.
        if (d > 0) break;
      }
    }
  }

  /** Guarda una rutina personal recurrente. El snapshot regenera la instancia de hoy. */
  private async guardarRutinaPersonal(texto: string) {
    const nombre = this.currentUser?.nombre;
    const uid = this.miUid();
    if (!uid) { this.mostrarToast(' No se pudo identificar tu usuario.'); return; }
    const frecuencia = this.tareaDiaFrecuencia;
    let fechaAnual: string | null = null;
    if (frecuencia === 'Anual') {
      const v = this.tareaDiaFechaAnual;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { this.mostrarToast(' Elige la fecha de la tarea anual.'); return; }
      fechaAnual = v.slice(5); // MM-DD
    }
    const id = `rp_${normalizarNombre(nombre).replace(/\s+/g, '_')}_${Date.now()}`;
    const r: any = {
      id, uid, nombre, texto,
      hora: this.tareaDiaHora || '',
      sucursal: this.miSucursalPrincipal(),
      frecuencia,
      diaSemana: frecuencia === 'Semanal' ? Number(this.tareaDiaDiaSemana) : null,
      diaMes: frecuencia === 'Mensual' ? Number(this.tareaDiaDiaMes) : null,
      fechaAnual,
      actividades: [...this.tareaDiaActividades],
      permiteFotos: this.tareaDiaPermiteFotos,
      activa: true,
      creadoEn: Date.now()
    };
    try {
      await setDoc(doc(this.firestore, 'rutinas_personales', id), r);
      await this.api.guardar('/api/rutinas-personales', { ...r, id: String(id) }); // FERROCARRIL Etapa 8
      this.isModalTareaDiaOpen = false;
      this.resetCamposTareaDia();
      // Mensaje explícito de CUÁNDO aparecerá (solo para Espacio TEC; el resto ve
      // el mensaje simple de siempre).
      if (this.esUsuarioTec) {
        const aplicaHoy = this.aplicaRutinaPersonalHoy(r, new Date());
        const cuando = this.descripcionRecurrencia(r);
        this.mostrarToast(aplicaHoy
          ? ` Tarea recurrente creada. Ya la agregamos a tu dia de hoy y se repetira ${cuando}.`
          : ` Tarea recurrente creada. Aparecera sola ${cuando}.`);
      } else {
        this.mostrarToast(' Tarea recurrente creada. Aparecera sola cuando toque.');
      }
    } catch (e) {
      console.error('[rutina-personal] error al guardar', e);
      this.mostrarToast(' Error al crear la tarea recurrente.');
    }
  }

  /** ¿Es una tarea propia del usuario actual? (para permitir editar/eliminar simple). */
  esTareaPropiaMia(checklist: any): boolean {
    if (!checklist?.esTareaPropia) return false;
    return mismoEmpleadoNombre(checklist.assigned, this.currentUser?.nombre) ||
           checklist.createdBy === this.currentUser?.nombre;
  }

  /** Abre el modal simple (nombre + hora + actividades) para editar una tarea propia. */
  editarTareaPropia(checklist: any, event: Event) {
    event.stopPropagation();
    this.resetCamposTareaDia();
    this.editandoTareaPropiaId = String(checklist.id);
    this.tareaDiaTexto = checklist.name || '';
    const hora = (checklist.time && checklist.time !== '23:59')
      ? checklist.time
      : (checklist.items?.[0]?.horaLimite || '');
    this.tareaDiaHora = hora || '';
    // Carga las actividades existentes (salvo que sea un solo item igual al nombre).
    const items: any[] = checklist.items || [];
    const esItemUnicoIgualAlNombre = items.length === 1 &&
      (items[0]?.text || '').trim() === (checklist.name || '').trim();
    this.tareaDiaActividades = esItemUnicoIgualAlNombre ? [] : items.map(i => i.text);
    this.tareaDiaPermiteFotos = !!items[0]?.permiteFotos;
    this.isModalTareaDiaOpen = true;
  }

  /** Guarda los cambios (nombre + hora + actividades) de una tarea propia. */
  private async actualizarTareaPropia(texto: string) {
    const id = this.editandoTareaPropiaId!;
    const hora = this.tareaDiaHora || '';
    try {
      const ref = doc(this.firestore, 'checklists', id);
      const prevResp = await this.api.get('/api/checklists?id=' + encodeURIComponent(id)).catch(() => null);
      const previos = (prevResp?.checklist?.items) || [];
      const items = this.construirItemsPersonal(texto, this.tareaDiaActividades, hora, previos, this.tareaDiaPermiteFotos);
      await setDoc(ref, { name: texto, time: hora || '23:59', items }, { merge: true });
      await this.api.patchChecklist(id, { name: texto, time: hora || '23:59', items });
      this.isModalTareaDiaOpen = false;
      this.resetCamposTareaDia();
      this.mostrarToast(' Tarea actualizada.');
    } catch (e) {
      console.error('[actualizarTareaPropia]', e);
      this.mostrarToast(' Error al actualizar la tarea.');
    }
  }

  /** Elimina (soft-delete) una sola tarea propia del usuario. Sin contraseña ni admin. */
  async eliminarTareaPropia(checklist: any) {
    const res = await Swal.fire({
      title: 'Eliminar tu tarea',
      html: `¿Quitar "<strong>${checklist.name}</strong>" de tu día?`,
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Si, eliminar', cancelButtonText: 'Cancelar', confirmButtonColor: 'var(--bad-fg)'
    });
    if (!res.isConfirmed) return;
    try {
      await setDoc(doc(this.firestore, 'checklists', String(checklist.id)), { eliminado: true }, { merge: true });
      await this.api.patchChecklist(String(checklist.id), { eliminado: true });
      this.mostrarToast(' Tarea eliminada.');
    } catch (e) {
      console.error('[eliminarTareaPropia]', e);
      this.mostrarToast(' Error al eliminar.');
    }
  }

  /** Quita una rutina personal (deja de repetirse; lo ya generado se queda). */
  async eliminarRutinaPersonal(r: any) {
    const res = await Swal.fire({
      title: 'Dejar de repetir',
      html: `"<strong>${r.texto}</strong>" ya no se repetira (${this.etiquetaRutinaPersonal(r)}).<br>Lo que ya esta en tu dia se queda.`,
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Si, quitar', cancelButtonText: 'Cancelar', confirmButtonColor: 'var(--bad-fg)'
    });
    if (!res.isConfirmed) return;
    try {
      await deleteDoc(doc(this.firestore, 'rutinas_personales', r.id));
      await this.api.borrar('/api/rutinas-personales', r.id); // FERROCARRIL Etapa 8
      this.mostrarToast(' Tarea recurrente eliminada.');
    } catch (e) {
      this.mostrarToast(' Error al eliminar.');
    }
  }

  /** Sucursal por defecto del usuario para asociar la tarea propia. */
  private miSucursalPrincipal(): string {
    const u = this.currentUser;
    return (u?.sucursales && u.sucursales[0]) || u?.sucursal || 'General';
  }

  /** Crea un checklist auto-asignado para hoy con una sola tarea manual.
   *  Aparece junto a las rutinas del día del trabajador y se completa/envía
   *  con el flujo normal (sin requerir foto). */
  async guardarTareaDia() {
    const texto = this.tareaDiaTexto.trim();
    if (!texto) { this.mostrarToast(' Escribe el nombre de tu tarea.'); return; }
    const nombre = this.currentUser?.nombre;
    if (!nombre) { this.mostrarToast(' No hay sesión activa.'); return; }

    // Modo edición: actualiza la tarea propia existente (solo nombre + hora).
    if (this.editandoTareaPropiaId) {
      await this.actualizarTareaPropia(texto);
      return;
    }

    // Recurrente: se guarda como rutina personal; el snapshot genera la de hoy.
    if (this.tareaDiaFrecuencia !== 'unica') {
      await this.guardarRutinaPersonal(texto);
      return;
    }

    const hoy = this.hoyIsoStr;
    const id = `propia_${normalizarNombre(nombre).replace(/\s+/g, '_')}_${Date.now()}`;
    const checklist: any = {
      id,
      timestampCreacion: Date.now(),
      name: texto,
      assigned: nombre,
      store: this.miSucursalPrincipal(),
      date: hoy,
      time: this.tareaDiaHora || '23:59',
      status: 'pendiente',
      enviado: false,
      createdBy: nombre,
      esTareaPropia: true,
      notaEmpleado: '',
      items: this.construirItemsPersonal(texto, this.tareaDiaActividades, this.tareaDiaHora, undefined, this.tareaDiaPermiteFotos)
    };

    try {
      // El snapshot de checklists la muestra sola (incluso con cache local).
      // NO hacemos push optimista: causaba que apareciera DUPLICADA hasta refrescar
      // (el snapshot ya la traia y ademas la agregabamos a mano).
      await this.guardarEnLaNube(checklist);
      this.isModalTareaDiaOpen = false;
      this.resetCamposTareaDia();
      this.mostrarToast(' Tu tarea fue agregada a tu día.');
    } catch (e) {
      console.error('[tarea-propia-dia] error', e);
      this.mostrarToast(' Error al agregar tu tarea.');
    }
  }

  // ==========================================================================
  //  📕 TAREAS DE MANUAL — el candado
  // ==========================================================================

  /**
   * ¿Esta tarea la entregó el Manual Corporativo?
   *
   * Se comprueba con la bandera que pone el robot. Si es de manual, NADIE la
   * edita ni la borra: ni el trabajador, ni el Encargado, ni el admin global.
   * Un checklist de manual es la evidencia de un documento controlado; si se
   * pudiera recortar desde la app, el documento dejaría de valer.
   *
   * Lo que sí se puede hacer con ella es lo que el manual espera: cumplirla,
   * marcar sus puntos de control y dejar observaciones.
   */
  esTareaDeManual(checklist: any): boolean {
    // La regla vive en `origen-manual.util.ts` porque el panel de responsables
    // también la necesita POR TAREA desde que las dos listas son una sola. Dos
    // copias de una regla es una copia que se queda atrás (§2).
    return esEntregaDeManual(checklist);
  }

  /** Código del anexo/formato del manual (CEDIS-CH-01, Anexo A...), para la píldora. */
  codigoFormatoManual(checklist: any): string {
    return checklist?._formatoCodigo || checklist?.datos?._formatoCodigo || '';
  }

  /** Tooltip de la píldora: de qué documento sale esta tarea. */
  tituloManual(checklist: any): string {
    const doc = checklist?._manualDocumento || checklist?.datos?._manualDocumento || '';
    const ver = checklist?._manualVersion || checklist?.datos?._manualVersion || '';
    const nota = checklist?._nota || checklist?.datos?._nota || '';
    const cab = [doc, ver].filter(Boolean).join(' · ') || 'Manual Corporativo de Operación';
    return nota ? `${cab}\n\n${nota}` : `${cab}\n\nNo se puede editar ni eliminar.`;
  }

  /** El aviso que se muestra cuando alguien intenta tocar una tarea de manual. */
  private avisarTareaBloqueada(checklist: any) {
    const doc = checklist?._manualDocumento || checklist?.datos?._manualDocumento || 'su Manual Corporativo de Operación';
    const codigo = checklist?._manualCodigo || checklist?.datos?._manualCodigo || '';
    Swal.fire({
      icon: 'info',
      title: 'Tarea del Manual Corporativo',
      html: `Esta tarea viene de <b>${doc}</b>${codigo ? ` (${codigo})` : ''} y no se puede editar ni eliminar.<br><br>` +
            `Los checklists del manual son documentos controlados: cambian con una nueva versión autorizada, no desde la app. ` +
            `Lo que sí puedes hacer es cumplirla y dejar tus observaciones.<br><br>` +
            `Si necesitas una tarea distinta, créala en el apartado de <b>Tareas</b>, que es libre.`,
      confirmButtonColor: 'var(--action)',
      confirmButtonText: 'Entendido',
    });
  }

  eliminarChecklist(checklist: any, event: Event) {
    event.stopPropagation();
    // 📕 Candado del manual: primero que nada, antes de cualquier otra regla.
    if (this.esTareaDeManual(checklist)) { this.avisarTareaBloqueada(checklist); return; }
    // Tarea propia del usuario: la puede eliminar el mismo, sin contraseña ni admin.
    if (this.esTareaPropiaMia(checklist)) { this.eliminarTareaPropia(checklist); return; }
    this.checklistToDelete = checklist;
    this.passwordInput = '';
    this.isPasswordModalOpen = true;
  }

  cerrarPasswordModal() { this.isPasswordModalOpen = false; this.checklistToDelete = null; this.passwordInput = ''; }

  async confirmarEliminacion() {
    // 🔒 Antes pedía una contraseña maestra hardcodeada ('Mega2323') visible en el
    // bundle. Ahora exige rol de administrador. La protección real vive en las
    // Firestore Security Rules (Fase 2).
    if (this.currentUser?.rol !== 'admin') { alert(' ⚠️ Solo un administrador puede eliminar checklists.'); return; }
    // La confirmación ya la dio el usuario en el modal "Confirmar eliminación".
    // No pedimos un segundo confirm() ni mostramos alert() de éxito: basta ese modal.
    {
      try {
        const checklist = this.checklistToDelete;
        const targetName = checklist.name.replace(/ \((Diaria|Semanal|Catorcenal|Mensual|Trimestral)\)$/, '').trim();
        const targetAssigned = checklist.assigned;

        // 1) Soft-delete de TODOS los checklists ya generados con este nombre+assigned.
        const chkResp = await this.api.get('/api/checklists');
        const chkFilas: any[] = chkResp?.checklists || [];
        for (const cData of chkFilas) {
          if ((cData.name || '').startsWith(targetName) && cData.assigned === targetAssigned) {
            await setDoc(doc(this.firestore, 'checklists', String(cData.id)), { eliminado: true }, { merge: true });
            await this.api.patchChecklist(String(cData.id), { eliminado: true });
          }
        }

        // 2) Borrado físico del molde V1. FERROCARRIL Etapa 5: lista desde Postgres + dual-write.
        const moldesResp = await this.api.get('/api/moldes-checklists');
        const moldesFilas: any[] = moldesResp?.items || [];
        for (const mData of moldesFilas) {
          if (targetName.includes(mData.name) && mData.assigned === targetAssigned) {
            await deleteDoc(doc(this.firestore, 'moldes_checklists', String(mData.id)));
            await this.api.borrar('/api/moldes-checklists', mData.id);
          }
        }

        // 3) 🔥 Desactivar la asignación V2 para que el Robot V2 deje de regenerar.
        // Antes este paso faltaba: por eso al día siguiente reaparecía la rutina.
        // - Si la asignación es porPersonas con varios empleados, sacamos SOLO a
        //   este empleado (no rompemos las tareas de los demás).
        // - Si queda con 0 empleados, o es porRol, marcamos `activa: false`.
        if (checklist._v2 && checklist._asignacionId) {
          const asigRef = doc(this.firestore, 'asignaciones_rutinas', checklist._asignacionId);
          // FERROCARRIL Etapa 4: leer asignación desde Postgres + dual-write.
          const asigResp = await this.api.get('/api/asignaciones-rutinas?id=' + encodeURIComponent(String(checklist._asignacionId)));
          const a = asigResp?.item;
          if (a) {
            const asigId = String(checklist._asignacionId);
            if (a.modoAsignacion === 'porPersonas' && Array.isArray(a.empleadosNombres)) {
              const sinEste = a.empleadosNombres.filter((n: string) => n !== targetAssigned);
              if (sinEste.length > 0) {
                await setDoc(asigRef, { empleadosNombres: sinEste }, { merge: true });
                await this.api.parchar('/api/asignaciones-rutinas', asigId, { empleadosNombres: sinEste });
              } else {
                await setDoc(asigRef, { activa: false, empleadosNombres: [] }, { merge: true });
                await this.api.parchar('/api/asignaciones-rutinas', asigId, { activa: false, empleadosNombres: [] });
              }
            } else {
              await setDoc(asigRef, { activa: false }, { merge: true });
              await this.api.parchar('/api/asignaciones-rutinas', asigId, { activa: false });
            }
          }
        }

        this.mostrarToast(' Tarea/rutina eliminada definitivamente.');
      } catch (error) {
        console.error('[confirmarEliminacion]', error);
        this.mostrarToast(' Error al eliminar.');
      }
    }
    this.cerrarPasswordModal();
  }

  /**
   * Muestra el diagnóstico del último snapshot en un modal visible en pantalla,
   * útil cuando un usuario ve "No hay tareas asignadas" y queremos saber por qué
   * sin tener que abrir la consola del navegador (típico en móviles).
   */
  mostrarDiagnostico() {
    const d = this.ultimoDiagnostico;
    if (!d) {
      Swal.fire({
        icon: 'info', title: 'Sin diagnóstico todavía',
        text: 'Aún no se ha cargado ningún snapshot. Espera unos segundos.',
        confirmButtonColor: 'var(--action)'
      });
      return;
    }
    const sucursales = (d.sucursales && d.sucursales.length)
      ? d.sucursales.join(', ') : '(ninguna)';
    const crudo = (d.crudoAssignedMuestra && d.crudoAssignedMuestra.length)
      ? d.crudoAssignedMuestra.map((s: string) => `<li style="font-size:11px;color:var(--neutral-600)">${s}</li>`).join('')
      : '<li style="color:var(--neutral-400)">(0 checklists pasaron el filtro de fecha/estado)</li>';
    const empleadosUnicos = (d.empleadosConTareasHoy && d.empleadosConTareasHoy.length)
      ? d.empleadosConTareasHoy.map((s: string) => `<li style="font-size:11px;color:var(--neutral-600)">${s}</li>`).join('')
      : '<li style="color:var(--neutral-400)">(no se encontraron empleados con tareas hoy)</li>';
    const misEnviados = (d.misEnviadosHoy && d.misEnviadosHoy.length)
      ? `<ul style="padding-left:18px;margin:4px 0">${d.misEnviadosHoy.map((x: any) => `<li style="font-size:11px;color:var(--warn-fg)">${x.assigned}: ${x.name}</li>`).join('')}</ul>`
      : '<div style="color:var(--neutral-400);font-size:12px;padding-left:8px">— ninguno —</div>';
    const misEliminados = (d.misEliminadosHoy && d.misEliminadosHoy.length)
      ? `<ul style="padding-left:18px;margin:4px 0">${d.misEliminadosHoy.map((x: any) => `<li style="font-size:11px;color:var(--bad-fg)">${x.assigned}: ${x.name}</li>`).join('')}</ul>`
      : '<div style="color:var(--neutral-400);font-size:12px;padding-left:8px">— ninguno —</div>';
    // Botón "Reabrir" solo si hay mis tareas marcadas como enviadas y el usuario
    // es admin o es el propio dueño de las tareas.
    const puedeReabrir = (d.misEnviadosHoy && d.misEnviadosHoy.length > 0) &&
      (this.currentUser?.rol === 'admin' ||
       mismoEmpleadoNombre(this.currentUser?.nombre, d.misEnviadosHoy[0].assigned));
    const botonReabrir = puedeReabrir
      ? `<button id="btn-reabrir-misenviados" style="margin-top:10px;background:var(--warn-fg);color:white;border:none;padding:10px 18px;border-radius:8px;font-weight:600;cursor:pointer">🔓 Reabrir mis ${d.misEnviadosHoy.length} tarea(s) marcadas como enviadas</button>`
      : '';
    const html = `
      <div style="text-align:left;font-size:13px;line-height:1.55">
        <div><strong>Usuario:</strong> ${d.usuario || '(vacío)'}</div>
        <div><strong>Nombre:</strong> ${d.nombre || '(vacío)'}</div>
        <div><strong>Rol:</strong> ${d.rol || '(vacío)'}</div>
        <div><strong>Alcance:</strong> ${d.alcance || '(vacío)'}</div>
        <div><strong>Sucursales:</strong> ${sucursales}</div>
        <div><strong>Rama de filtrado:</strong> <code>${d.rama}</code></div>
        <div><strong>Fecha hoy local:</strong> <code>${d.fechaHoyLocal}</code></div>
        <hr style="margin:10px 0">
        <div><strong>Descartados:</strong></div>
        <div style="padding-left:12px;color:var(--neutral-500)">
          • Por eliminado: ${d.descartadosEliminados}<br>
          • Por enviado: ${d.descartadosEnviados}<br>
          • Por fecha distinta a hoy: ${d.descartadosFecha}
        </div>
        <div style="margin-top:8px"><strong>Tras filtros de estado/fecha:</strong> ${d.crudoTrasFiltro}</div>
        <div><strong>Tras filtro de permisos:</strong> ${d.resultadoFinal}</div>
        <hr style="margin:10px 0">
        <div style="color:var(--warn-fg)"><strong>🚨 Mis tareas marcadas como ENVIADAS hoy:</strong></div>
        ${misEnviados}
        ${botonReabrir}
        <div style="color:var(--bad-fg);margin-top:6px"><strong>🚨 Mis tareas marcadas como ELIMINADAS hoy:</strong></div>
        ${misEliminados}
        <hr style="margin:10px 0">
        <div><strong>Empleados con tareas creadas hoy (cualquier estado):</strong></div>
        <ul style="padding-left:18px;margin:4px 0;max-height:160px;overflow:auto">${empleadosUnicos}</ul>
        <hr style="margin:10px 0">
        <div><strong>Muestra del universo crudo (no enviadas, no eliminadas):</strong></div>
        <ul style="padding-left:18px;margin:4px 0">${crudo}</ul>
      </div>
    `;
    Swal.fire({
      title: '🩺 Diagnóstico del filtro',
      html, width: 560, confirmButtonText: 'Cerrar', confirmButtonColor: 'var(--action)',
      didOpen: () => {
        const btn = document.getElementById('btn-reabrir-misenviados');
        if (btn) {
          btn.addEventListener('click', () => {
            Swal.close();
            this.reabrirMisTareasEnviadas();
          });
        }
      }
    });
  }

  /**
   * Pone `enviado: false` en los checklists de hoy que están marcados como
   * enviados Y son del usuario actual (o de cualquiera si es admin). Resuelve
   * el caso en que se envió un checklist sin completar todas las tareas y el
   * trabajador queda sin poder verlas.
   */
  async reabrirMisTareasEnviadas() {
    const d = this.ultimoDiagnostico;
    if (!d || !Array.isArray(d.misEnviadosHoy) || d.misEnviadosHoy.length === 0) return;
    const lista = d.misEnviadosHoy as { id: string; assigned: string; name: string }[];
    const itemsHtml = lista.map(x => `<li style="text-align:left;font-size:13px">${x.name}</li>`).join('');
    const confirma = await Swal.fire({
      title: `¿Reabrir ${lista.length} tarea(s)?`,
      html: `<div>Se desmarcarán como enviadas y volverán a aparecer en el Checklist del día:</div><ul style="padding-left:18px;margin:8px 0">${itemsHtml}</ul>`,
      icon: 'question', showCancelButton: true,
      confirmButtonText: 'Sí, reabrir', cancelButtonText: 'Cancelar',
      confirmButtonColor: 'var(--warn-fg)'
    });
    if (!confirma.isConfirmed) return;
    let ok = 0, fail = 0;
    for (const item of lista) {
      try {
        await setDoc(doc(this.firestore, 'checklists', item.id), { enviado: false }, { merge: true });
        await this.api.patchChecklist(String(item.id), { enviado: false });
        ok++;
      } catch (e) { console.error('[reabrirMisTareasEnviadas]', e); fail++; }
    }
    Swal.fire({
      icon: 'success', title: 'Tareas reabiertas',
      html: `Reabiertas: <strong>${ok}</strong>${fail > 0 ? `<br>Errores: <strong style="color:var(--bad-fg)">${fail}</strong>` : ''}<br><br>Recarga la pantalla para verlas.`,
      confirmButtonColor: 'var(--action)'
    });
  }

  /**
   * Decide qué flujo de edición abrir según el tipo de checklist.
   * - Si el nombre termina en `(Diaria)`, `(Semanal)`, etc. → es rutina → editor de rutinas.
   * - En cualquier otro caso → editor de Tarea Única.
   */
  editarChecklist(checklist: any, event: Event) {
    event.stopPropagation();
    // 📕 Candado del manual: no se edita ni siendo admin global.
    if (this.esTareaDeManual(checklist)) { this.avisarTareaBloqueada(checklist); return; }
    // Tarea propia: edición simple (solo nombre + hora), no el wizard completo.
    if (this.esTareaPropiaMia(checklist)) { this.editarTareaPropia(checklist, event); return; }
    const esRutina = /\((Diaria|Semanal|Catorcenal|Mensual|Trimestral)\)$/.test(checklist?.name || '');
    if (esRutina) this.editarBloqueRutinas(checklist, event);
    else this.editarTareaUnica(checklist, event);
  }

  async editarBloqueRutinas(checklist: any, event: Event) {
    event.stopPropagation();
    this.isEditMode = true;
    const targetName = checklist.name.replace(/ \((Diaria|Semanal|Catorcenal|Mensual|Trimestral)\)$/, '').trim();
    const targetAssigned = checklist.assigned;
    // FERROCARRIL Etapa 5: moldes desde Postgres (antes getDocs Firestore).
    const moldesResp = await this.api.get('/api/moldes-checklists');
    let rutinasEncontradas: any[] = [];
    let sucursalOriginal = '';
    (moldesResp?.items || []).forEach((mData: any) => {
      if (mData['name'] === targetName && mData['assigned'] === targetAssigned) {
        sucursalOriginal = mData['store'];
        if (mData['items'] && Array.isArray(mData['items'])) {
          rutinasEncontradas = [...rutinasEncontradas, ...mData['items']];
        }
      }
    });
    if (rutinasEncontradas.length === 0) {
      alert('Esta es una "Tarea Única" o no tiene rutinas registradas en la Bóveda.');
      return;
    }
    // 📝 Guarda originales para que `guardarBloqueRutinas` pueda limpiar el
    // molde viejo aunque cambies nombre/sucursal/asignado.
    this.formNameRutinaOriginal = targetName;
    this.formAssignedRutinaOriginal = targetAssigned;
    this.formNameRutina = targetName;
    this.formAssignedRutina = [targetAssigned];
    this.formStoreRutina = sucursalOriginal;
    this.formRutinas = rutinasEncontradas.map((r: any) => ({
      ...r,
      horaInicio: r.horaInicio || '',
      horaLimite: r.horaLimite || '',
      fechaInicio: r.fechaInicio || this.hoyIsoStr,
      fechaFin: r.fechaFin || null
    }));
    // 🧙 Reset wizard de rutinas para edición
    this.wizardStepRutina = 1;
    this.terminoBusquedaEmpleadoWizardRutina = '';
    const primeraRutina = this.formRutinas[0];
    if (primeraRutina?.requiresAntesDespues) this.wizardTipoEvidenciaRutina = 'antesDespues';
    else if (primeraRutina?.requiresVariasFotos) this.wizardTipoEvidenciaRutina = 'variasFotos';
    else if (primeraRutina?.requiresPhoto) this.wizardTipoEvidenciaRutina = 'foto';
    else this.wizardTipoEvidenciaRutina = 'ninguna';
    this.isModalRutinasOpen = true;
  }

  verDetalle(checklist: any) {
    this.checklistSeleccionado.set(checklist);
    this.vistaActual.set('detalle');
    // Si quien abre es Gerencia (y no el mismo trabajador), deja constancia de
    // que la tarea enviada ya fue revisada -> el empleado lo ve en "Enviadas".
    this.registrarVistoGerencia(checklist);
  }

  /** ¿La sesión actual es Gerencia? (puede revisar tareas de otros). */
  private esGerencia(sesion: any): boolean {
    return esAdminGlobal(sesion) || esAdminLimitado(sesion) || esSupervisor(sesion) || !!sesion?.puedeCrearChecklists;
  }

  /** Marca una tarea enviada como "vista por Gerencia" la primera vez que un
   *  admin/supervisor abre su detalle. No cuenta si la abre el propio empleado. */
  private async registrarVistoGerencia(checklist: any) {
    if (!this.esUsuarioTec) return; // función solo para Espacio TEC
    if (!checklist?.id || !checklist.enviado || checklist.vistoPor) return;
    const sesion = this.currentUser;
    if (!this.esGerencia(sesion)) return;
    if (mismoEmpleadoNombre(checklist.assigned, sesion?.nombre)) return; // no es revisión de otro
    const vistoPor = sesion?.nombre || 'Gerencia';
    const vistoTimestamp = Date.now();
    checklist.vistoPor = vistoPor;        // refleja al instante en la UI local
    checklist.vistoTimestamp = vistoTimestamp;
    try {
      await setDoc(doc(this.firestore, 'checklists', checklist.id), { vistoPor, vistoTimestamp }, { merge: true });
      await this.api.patchChecklist(String(checklist.id), { vistoPor, vistoTimestamp });
    } catch (e) {
      console.error('[checklist] registrarVistoGerencia', e);
    }
  }

  /** Etiqueta legible del "visto" para mostrar al empleado en sus enviadas. */
  etiquetaVistoGerencia(checklist: any): string {
    if (!checklist?.vistoPor) return '';
    let cuando = '';
    if (checklist.vistoTimestamp) {
      try {
        cuando = ' · ' + new Date(checklist.vistoTimestamp).toLocaleString('es-MX', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        });
      } catch { cuando = ''; }
    }
    return `Visto por ${checklist.vistoPor}${cuando}`;
  }
  volverALista() { this.checklistSeleccionado.set(null); this.vistaActual.set('lista'); }
  toggleItem(item: any) { item.checked = !item.checked; this.sellarCheck(item); this.actualizarEstado(); }

  /**
   * Deja constancia de CUANDO se marco (o se desmarco) la tarea.
   *
   * Sin este sello no habia forma de saber si el trabajo se hizo a tiempo: al
   * entregar se comparaba la hora limite contra el reloj de ESE momento, asi que
   * terminar 07:50 y darle a "Enviar" 07:05 pedia justificante por un retraso
   * que no existio. Ver `entregadaTarde()`.
   */
  private sellarCheck(item: any) {
    if (item.checked) item.checkedEn = Date.now();
    else item.checkedEn = null;
  }

  /** ¿Esta tarea pide alguna evidencia (foto / antes-después / varias fotos)? */
  pideEvidencia(item: any): boolean {
    return !!(item.requiresPhoto || item.requiresAntesDespues || item.requiresVariasFotos);
  }

  /**
   * Toque sobre el indicador de la tarea.
   *
   * - Tareas CON evidencia: NO se palomean a mano. Se completan solas al subir
   *   la foto, así que el toque no hace nada (el círculo es solo indicador visual).
   * - Tareas SIN evidencia: se marcan/desmarcan con el toque (única forma de
   *   indicar que se hicieron).
   */
  onClickCheck(item: any) {
    if (!this.puedoEditarItem(item)) return;
    if (this.pideEvidencia(item)) return; // las de foto se completan subiendo evidencia
    item.checked = !item.checked;
    this.sellarCheck(item);
    this.actualizarEstado();
  }

  async onFileSelected(event: any, item: any, tipoFoto: string = 'photo') {
    const fileOriginal = event.target.files[0];
    if (!fileOriginal) return;
    const checklistActual = this.checklistSeleccionado();
    if (!checklistActual) return;

    // ── Tope de tamaño ────────────────────────────────────────────────────
    // Las imagenes se comprimen mas abajo, asi que este tope es para los
    // documentos, que suben tal cual. Cloudinary corta la subida sin firmar
    // alrededor de los 10 MB, y sin este aviso el usuario solo veria el error
    // generico de "no se pudo subir" y volveria a intentar con el mismo
    // archivo. Decirle el tamano real es lo que le permite resolverlo.
    const esImagen = (fileOriginal.type || '').startsWith('image/');
    const TOPE_MB = 10;
    if (!esImagen && fileOriginal.size > TOPE_MB * 1024 * 1024) {
      const mb = (fileOriginal.size / (1024 * 1024)).toFixed(1);
      event.target.value = '';
      await Swal.fire({
        icon: 'warning',
        title: 'El archivo pesa demasiado',
        html: `<div style="text-align:left">
                 <p><strong>${fileOriginal.name}</strong> pesa ${mb} MB y el limite son ${TOPE_MB} MB.</p>
                 <p style="font-size:13px;color:var(--neutral-500);margin-top:8px">
                   Si es un PDF escaneado, vuelve a guardarlo en menor calidad.
                   Si son varias hojas, adjunta solo la que hace falta.</p>
               </div>`,
        confirmButtonColor: 'var(--action)'
      });
      return;
    }

    // Compresión cliente: bajamos JPGs de 4-6 MB a ~300 KB antes de subir.
    // Si no es imagen (PDF, etc.) o ya es pequeña, devuelve el original sin tocar.
    let file: File;
    try {
      file = await comprimirImagenSiAplica(fileOriginal);
    } catch (e: any) {
      console.error('[compresion]', e);
      // Si la compresión falla, intentamos subir el archivo original tal cual
      file = fileOriginal;
    }

    // Sin conexión → guardamos offline desde el inicio.
    if (!navigator.onLine) {
      await this.guardarFotoOffline(item, tipoFoto, file, checklistActual);
      event.target.value = '';
      this.mostrarToast(' Guardado sin conexión. Se subirá cuando regrese la señal.');
      return;
    }

    // Subida online con un reintento automático y fallback offline si falla.
    item[tipoFoto] = 'subiendo...';
    const resultado = await this.subirACloudinary(file);
    if (resultado.ok && resultado.url) {
      item[tipoFoto] = resultado.url;
      item.pendienteDeSync = false;
      const ahora = new Date();
      item[tipoFoto + 'Time'] = ahora.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      // Sello en epoch de TODAS las fotos, no solo la de ANTES: es lo que prueba
      // que la evidencia se subio dentro de la hora (ver `entregadaTarde()`).
      item[tipoFoto + 'Timestamp'] = ahora.getTime();
      this.actualizarEstado();
    } else {
      // Fallback: si falla la subida online (cuota, red intermitente, etc.) la
      // guardamos offline para que se reintente automáticamente. Antes se
      // perdía la foto y el trabajador veía solo un alert genérico.
      console.error('[Cloudinary error]', resultado.error);
      await this.guardarFotoOffline(item, tipoFoto, file, checklistActual);
      Swal.fire({
        icon: 'warning',
        title: 'No se pudo subir la foto',
        html: `<div style="text-align:left">
                 <p>Se guardó en tu dispositivo y se subirá cuando regrese la señal.</p>
                 <p style="font-size:11px;color:var(--neutral-500);margin-top:8px">
                   <strong>Detalle técnico:</strong>
                   <code style="word-break:break-word">${(resultado.error || 'sin detalle').toString().slice(0, 240)}</code>
                 </p>
               </div>`,
        confirmButtonColor: 'var(--action)'
      });
    }
    event.target.value = '';
  }

  /**
   * Sube un archivo a Cloudinary con 2 intentos (espera 800ms entre intentos).
   * Devuelve `{ok, url, error}` para que el llamador decida qué hacer.
   */
  private async subirACloudinary(file: File | Blob): Promise<{ ok: boolean; url?: string; error?: string }> {
    const cloudName = 'duherjgyg';
    const uploadPreset = 'fotos_mega';
    const url = `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`;
    let ultimoError = '';
    for (let intento = 1; intento <= 2; intento++) {
      try {
        const formData = new FormData();
        // El preset ANTES del archivo: si la subida se corta a medias, Cloudinary
        // ya lo leyo. Al final, se perdia y contestaba "Upload preset must be
        // specified" aunque el preset si iba en la peticion.
        formData.append('upload_preset', uploadPreset);
        formData.append('file', file);
        const response = await fetch(url, { method: 'POST', body: formData });
        const data = await response.json();
        if (data && data.secure_url) {
          return { ok: true, url: data.secure_url };
        }
        // Cloudinary suele devolver `error.message` cuando rechaza algo (cuota,
        // formato, tamaño). Lo guardamos para mostrarlo al usuario.
        ultimoError = (data && data.error && data.error.message)
          ? `Cloudinary: ${data.error.message}`
          : `Cloudinary respondió sin URL (HTTP ${response.status})`;
      } catch (e: any) {
        ultimoError = e?.message || 'Error de red';
      }
      if (intento < 2) await new Promise(r => setTimeout(r, 800));
    }
    return { ok: false, error: ultimoError };
  }

  /**
   * Guarda una foto en la cola offline (localforage). El robot de sincronización
   * la subirá cuando regrese la conexión. Antes esta lógica estaba duplicada
   * inline en `onFileSelected` y solo se usaba cuando `!navigator.onLine`;
   * ahora también se usa como fallback cuando Cloudinary falla online.
   */
  private async guardarFotoOffline(item: any, tipoFoto: string, file: File | Blob, checklistActual: any): Promise<void> {
    item[tipoFoto] = 'offline_syncing';
    item.pendienteDeSync = true;
    const ahora = new Date();
    item[tipoFoto + 'Time'] = ahora.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    item[tipoFoto + 'Timestamp'] = ahora.getTime();
    await new Promise<void>((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64String = reader.result as string;
        const indexItem = checklistActual.items.findIndex((i: any) => i === item);
        const fotoEstancada = {
          idTarea: checklistActual.id,
          indexItem,
          tipoFoto,
          base64: base64String
        };
        const colaActual: any[] = (await localforage.getItem('md_fotos_offline')) || [];
        colaActual.push(fotoEstancada);
        // 🛡️ Tope de la cola: cada foto es base64 (cientos de KB). Si el usuario
        // acumula muchas (señal mala), IndexedDB puede llenar el cupo del sitio y
        // el navegador desaloja TODO el origen — incluida la sesión — botándolo
        // al login. Nos quedamos con las MÁS RECIENTES y avisamos si descartamos.
        const TOPE_COLA = 40;
        if (colaActual.length > TOPE_COLA) {
          const descartadas = colaActual.length - TOPE_COLA;
          colaActual.splice(0, descartadas);
          console.warn(`[fotos-offline] cola llena: se descartaron ${descartadas} foto(s) antiguas para no llenar el almacenamiento.`);
        }
        await localforage.setItem('md_fotos_offline', colaActual);
        this.actualizarEstado();
        resolve();
      };
      reader.onerror = () => resolve();
    });
  }

  async adjuntarDocumentoInstruccion(event: any, item: any) {
    const fileOriginal = event.target.files[0];
    if (!fileOriginal) return;
    // Si es imagen, la comprimimos; PDFs y otros formatos pasan sin tocar.
    const file = await comprimirImagenSiAplica(fileOriginal);
    item.archivoInstruccion = 'subiendo...';
    item.nombreArchivo = file.name;
    const cloudName = 'duherjgyg';
    const uploadPreset = 'fotos_mega';
    const formData = new FormData();
    // El preset ANTES del archivo (ver checklist.ts): si la subida se corta a
    // medias, Cloudinary ya lo leyo y no rebota la peticion.
    formData.append('upload_preset', uploadPreset);
    formData.append('file', file);
    try {
      const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, { method: 'POST', body: formData });
      const data = await response.json();
      if (data.secure_url) {
        item.archivoInstruccion = data.secure_url;
        this.mostrarToast(' 📎 Documento adjuntado');
      } else {
        item.archivoInstruccion = null; item.nombreArchivo = null;
        alert(' ❌ Error al subir el documento.');
      }
    } catch (error) {
      item.archivoInstruccion = null; item.nombreArchivo = null;
      alert(' ❌ Error de conexión al subir.');
    }
    event.target.value = '';
  }

  quitarDocumentoInstruccion(item: any) {
    item.archivoInstruccion = null;
    item.nombreArchivo = null;
  }

  removeImage(item: any, tipoFoto: string = 'photo') {
    item[tipoFoto] = null; item[tipoFoto + 'Time'] = null;
    if (tipoFoto === 'photoAntes') item.photoAntesTimestamp = null;
    this.actualizarEstado();
  }

  /**
   * ¿La tarea está completa?
   *
   * - Tareas CON evidencia: completas cuando la evidencia está subida.
   *   Ya NO requieren palomear — subir la foto basta.
   * - Tareas SIN evidencia: completas con el toque manual (item.checked).
   */
  /**
   * Para esta vista (modal de detalle del trabajador / verificación al ENVIAR),
   * un item se considera completo SOLO con su evidencia real — no con la nota
   * global del checklist. Esto evita que el trabajador pueda enviar sin nada
   * hecho solo con un comentario.
   *
   * Para los KPIs visuales (Dashboard, Auditoría, Checkstore, Estadísticas,
   * Ranking) se usa `esItemHecho(item, checklist)` que SÍ acepta la
   * justificación del checklist completo.
   */
  esItemCompleto(item: any): boolean {
    return tieneEvidencia(item);
  }

  /**
   * Devuelve un texto corto explicando QUÉ le falta a un item para considerarse completo.
   * Se usa en el confirm() al enviar el checklist para que el trabajador sepa exactamente
   * qué tiene que volver a revisar.
   */
  motivoIncompleto(item: any): string {
    if (item.requiresAntesDespues) {
      const falta: string[] = [];
      if (!item.photoAntes || item.photoAntes === 'subiendo...') falta.push('foto ANTES');
      if (!item.photoDespues || item.photoDespues === 'subiendo...') falta.push('foto DESPUÉS');
      if (falta.length) return 'falta ' + falta.join(' y ');
    }
    if (item.requiresVariasFotos && (!Array.isArray(item.photos) || item.photos.length === 0)) {
      return 'falta subir fotos';
    }
    if (item.requiresPhoto && (!item.photo || item.photo === 'subiendo...')) {
      return 'falta la foto';
    }
    if (!this.pideEvidencia(item) && !item.checked) return 'falta marcar como hecha';
    return 'incompleta';
  }

  actualizarEstado() {
    const actual = this.checklistSeleccionado(); if (!actual) return;
    // Completado = evidencia subida (tareas con foto) o toque manual (tareas sin foto).
    const completados = actual.items.filter((i: any) => this.esItemCompleto(i)).length;
    actual.calcCompletados = completados;
    actual.calcProgreso = Math.round((completados / actual.items.length) * 100) || 0;
    if (completados === 0) actual.status = 'pendiente';
    else if (completados === actual.items.length) actual.status = 'completo';
    else actual.status = 'en-progreso';
    this.guardarEnLaNube(actual);
  }

  /** ¿El checklist se está enviando después de la hora límite de alguna de sus tareas? */
  hayRetrasoEnChecklist(checklist: any): boolean {
    if (!checklist?.items?.length || !checklist.date) return false;
    return checklist.items.some((i: any) => this.entregadaTarde(i, checklist));
  }

  /**
   * Limpieza de "huérfanos": borra tareas pendientes asignadas a personas que ya
   * no existen en el sistema y saca esos nombres de las asignaciones de rutinas.
   * Resuelve los casos viejos (bajas hechas antes de la limpieza automática).
   *
   * ⚠ SIN BOTÓN DESDE EL 14/sep/2026. David pidió retirar «Limpiar bajas» de la
   * barra («este bórralo»), así que hoy no hay forma de llamar a esto desde la
   * interfaz. El método se conserva a propósito y no se borra: es una acción
   * DESTRUCTIVA y quitarle el código en el mismo paso que se le quita la entrada
   * dejaría sin nada que recuperar si mañana hace falta correrla una vez. Lo que
   * desapareció es el camino para dispararla sin querer, que era el problema.
   */
  async limpiarHuerfanas() {
    if (this.currentUser?.rol !== 'admin' && !esAdminGlobal(this.currentUser)) {
      Swal.fire({ icon: 'error', title: 'Solo administradores', confirmButtonColor: 'var(--action)' });
      return;
    }
    const usuarios = this.plantillaUsuarios || [];

    // 🔒 Guarda crítica: si la lista de usuarios aún no cargó, TODO nombre se
    // vería como "inexistente" y borraríamos TODAS las pendientes. Abortamos.
    if (usuarios.length === 0) {
      Swal.fire({ icon: 'warning', title: 'Espera un momento', text: 'La lista de personal todavía no termina de cargar. Vuelve a intentarlo en unos segundos.', confirmButtonColor: 'var(--action)' });
      return;
    }

    // Criterio TOLERANTE (existeEmpleadoEnUsuarios): igual que el robot, para no
    // borrar a personas reales cuya asignación quedó con el nombre corto/distinto.
    const existe = (nombre: string) => existeEmpleadoEnUsuarios(nombre, usuarios);

    // 1) Tareas pendientes (no enviadas, no eliminadas) de gente que ya no existe.
    const huerfanas = this.checklists().filter((c: any) =>
      c.assigned && c.enviado !== true && c.eliminado !== true && !existe(c.assigned));

    // 2) Asignaciones 'por personas' que conservan nombres inexistentes.
    // FERROCARRIL Etapa 4: asignaciones desde Postgres.
    let asigItems: any[] = [];
    try { asigItems = (await this.api.get('/api/asignaciones-rutinas'))?.items || []; }
    catch (e) { console.error('[limpiarHuerfanas] asignaciones', e); }
    const asigACambiar: { id: string; cambios: any }[] = [];
    for (const a of asigItems) {
      if (a.modoAsignacion !== 'porPersonas' || !Array.isArray(a.empleadosNombres)) continue;
      const restantes = a.empleadosNombres.filter((n: string) => existe(n));
      if (restantes.length === a.empleadosNombres.length) continue;
      const cambios: any = { empleadosNombres: restantes };
      if (restantes.length === 0) cambios.activa = false;
      asigACambiar.push({ id: a.id, cambios });
    }

    if (huerfanas.length === 0 && asigACambiar.length === 0) {
      Swal.fire({ icon: 'info', title: 'Nada que limpiar', text: 'No hay tareas ni asignaciones de personas dadas de baja.', confirmButtonColor: 'var(--action)' });
      return;
    }

    const r = await Swal.fire({
      title: '¿Limpiar pendientes de personas dadas de baja?',
      html: `Se eliminarán <strong>${huerfanas.length}</strong> tarea(s) pendiente(s) y se corregirán <strong>${asigACambiar.length}</strong> asignación(es) de rutina.`,
      icon: 'warning', showCancelButton: true, confirmButtonText: 'Sí, limpiar', cancelButtonText: 'Cancelar', confirmButtonColor: 'var(--bad-fg)'
    });
    if (!r.isConfirmed) return;

    let okT = 0, okA = 0;
    for (const c of huerfanas) {
      try {
        await setDoc(doc(this.firestore, 'checklists', String(c.id)), { eliminado: true }, { merge: true });
        await this.api.patchChecklist(String(c.id), { eliminado: true });
        okT++;
      }
      catch (e) { console.error('[limpiarHuerfanas] checklist', c.id, e); }
    }
    for (const a of asigACambiar) {
      try {
        await setDoc(doc(this.firestore, 'asignaciones_rutinas', a.id), a.cambios, { merge: true });
        await this.api.parchar('/api/asignaciones-rutinas', a.id, a.cambios); // FERROCARRIL Etapa 4
        okA++;
      }
      catch (e) { console.error('[limpiarHuerfanas] asignacion', a.id, e); }
    }
    Swal.fire({ icon: 'success', title: 'Limpieza lista', html: `Se eliminaron <strong>${okT}</strong> tarea(s) y se corrigieron <strong>${okA}</strong> asignación(es).`, confirmButtonColor: 'var(--action)' });
  }

  enviarChecklist() {
    const actual = this.checklistSeleccionado(); if (!actual) return;
    // 🔒 Defensa: solo el dueño del checklist puede enviarlo
    //
    // Los tres avisos de aquí abajo eran `alert()` del navegador hasta el
    // 18/sep/2026. Se cambiaron por el toast que la app ya tenía: el cuadro del
    // sistema no se puede redactar ni medir, y en un teléfono aparece con el
    // dominio encima, que es lo último que quieres en el momento en que alguien
    // intenta cerrar su turno.
    if (!this.esElDueno()) {
      this.mostrarToast('⚠️ Solo el responsable asignado puede enviar esta tarea.');
      return;
    }
    if (actual.enviado) {
      this.mostrarToast('⚠️ Esta tarea ya fue enviada.');
      return;
    }
    const fotosPendientes = actual.items.some((i: any) => i.photo === 'subiendo...' || i.photoAntes === 'subiendo...' || i.photoDespues === 'subiendo...');
    if (fotosPendientes) { this.mostrarToast('⚠️ Espera, una foto se está subiendo.'); return; }

    // ══════════════════════════════════════════════════════════════════════
    //  PUNTOS SIN PRUEBA → MOTIVO OBLIGATORIO (decisión de David, 18/sep/2026)
    // ══════════════════════════════════════════════════════════════════════
    // Aquí había un `confirm()` del navegador que listaba hasta 5 puntos en
    // texto plano y ofrecía «¿Enviar así de todos modos?». Tres problemas, y
    // el tercero es el que decidió el cambio:
    //   1. Es el cuadro gris del sistema, en el momento de la verdad de 154
    //      personas. No se puede redactar, ni estilar, ni medir.
    //   2. Truncaba a 5. Un checklist de apertura tiene 8 puntos.
    //   3. Se enviaba SIN saber por qué faltaba la prueba, así que el punto
    //      quedaba en `no_ejecutado` para todos por igual —da lo mismo que no
    //      hubiera qué fotografiar a que nadie lo hiciera—. La Fase 5 necesita
    //      esa distinción y no se puede reconstruir después.
    //
    // Se descartó bloquear el envío: son 377 puntos con foto obligatoria,
    // 62+ de ellos declaraciones donde NO HAY QUÉ FOTOGRAFIAR, así que un
    // botón muerto dejaría gente sin poder cerrar su turno.
    const incompletas = this.puntosSinPrueba(actual);
    if (incompletas.length > 0) {
      this.abrirModalSinPrueba(incompletas);
      return;
    }

    this.continuarEnvio(actual);
  }

  /**
   * El tramo final, común a los dos caminos (con y sin puntos sin prueba).
   *
   * Existe como método propio porque el modal de motivos tiene que poder
   * reanudar exactamente aquí. Inlinearlo en los dos sitios dejaría dos copias
   * del paso del justificante libres de discrepar.
   */
  private continuarEnvio(actual: any) {
    // ⏰ Si hay retraso, en vez de enviar directo abrimos el modal de justificante.
    if (this.hayRetrasoEnChecklist(actual)) {
      this.abrirModalJustificante();
      return;
    }
    this.realizarEnvioFinal(actual, null);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  📋 MODAL: ¿POR QUÉ NO HAY PRUEBA?
  // ══════════════════════════════════════════════════════════════════════════
  isModalSinPruebaOpen = false;
  /** Un renglón por punto sin prueba: el texto que lee, y lo que contesta. */
  sinPrueba: Array<{ item: any; texto: string; falta: string; codigo: string; nota: string }> = [];
  readonly MOTIVOS = MOTIVOS_SIN_PRUEBA;

  private abrirModalSinPrueba(incompletas: any[]) {
    this.sinPrueba = incompletas.map((item: any) => ({
      item,
      texto: this.limpiarEmojis(item.text || '(sin nombre)'),
      falta: this.motivoIncompleto(item),
      // Se arranca VACÍO y no con el primer motivo preseleccionado: un motivo
      // por omisión se envía solo, y entonces el dato que guardamos no sería la
      // respuesta de nadie. Prefiero que el botón esté apagado a que mienta.
      codigo: '',
      nota: '',
    }));
    this.isModalSinPruebaOpen = true;
  }

  cerrarModalSinPruebaYVolver() {
    this.isModalSinPruebaOpen = false;
    this.sinPrueba = [];
  }

  /** ¿Este renglón ya está contestado? La usa la plantilla para marcarlo. */
  renglonListo(r: { codigo: string; nota: string }): boolean {
    return motivoCompleto(r);
  }

  /** Cuántos faltan por contestar. Va en el botón, para no dejarlo mudo. */
  motivosPendientes(): number {
    return this.sinPrueba.filter((r) => !this.renglonListo(r)).length;
  }

  puedeConfirmarSinPrueba(): boolean {
    return this.sinPrueba.length > 0 && this.motivosPendientes() === 0;
  }

  /** ¿Este motivo exige que además escriba? Lo decide el catálogo, no la plantilla. */
  motivoPideNota(codigo: string): boolean {
    return !!this.MOTIVOS.find((m: MotivoSinPrueba) => m.codigo === codigo)?.pideNota;
  }

  confirmarSinPruebaYSeguir() {
    const actual = this.checklistSeleccionado(); if (!actual) return;
    // Se revalida aquí y no solo en el `[disabled]` del botón: esconder o
    // apagar un control es cosmética, y esta es la puerta por la que el dato
    // entra al checklist.
    if (!this.puedeConfirmarSinPrueba()) {
      this.mostrarToast('⚠️ Contesta el motivo de cada punto para poder enviar.');
      return;
    }

    const ahora = Date.now();
    const quien = this.currentUser?.nombre || '';
    for (const r of this.sinPrueba) {
      const sello = sellarMotivo({ codigo: r.codigo, nota: r.nota }, quien, ahora);
      // ⚠ SE ESCRIBE EN EL ITEM, NUNCA EN `notaEmpleado`. Ese campo lo lee
      // `tieneJustificacionChecklist()`, así que escribir ahí pasaría TODOS los
      // puntos del checklist de `no_ejecutado` a `justificado` —incluidos los
      // que nadie justificó— y con ellos a quién se le cuenta la falta (§4).
      // Hay una prueba que fija esto en `motivo-sin-prueba.util.spec.ts`.
      if (sello) r.item.motivoSinPrueba = sello;
    }

    this.isModalSinPruebaOpen = false;
    this.sinPrueba = [];
    this.continuarEnvio(actual);
  }

  // ============================================================================
  // ⏰ MODAL DE JUSTIFICANTE DE RETRASO
  // ============================================================================
  abrirModalJustificante() {
    this.justificanteCategoria = '';
    this.justificanteComentario = '';
    this.isModalJustificanteOpen = true;
  }
  cerrarModalJustificante() {
    this.isModalJustificanteOpen = false;
  }
  seleccionarCategoriaJustificante(c: string) {
    this.justificanteCategoria = c as any;
  }
  puedeConfirmarJustificante(): boolean {
    return !!this.justificanteCategoria && this.justificanteComentario.trim().length >= 5;
  }
  confirmarJustificanteYEnviar() {
    if (!this.puedeConfirmarJustificante()) {
      this.mostrarToast('⚠️ Elige una categoría y escribe un comentario de al menos 5 caracteres.');
      return;
    }
    const actual = this.checklistSeleccionado(); if (!actual) return;
    const motivo = {
      categoria: this.justificanteCategoria,
      comentario: this.justificanteComentario.trim(),
      reportadoPor: this.currentUser?.nombre || 'desconocido',
      timestamp: Date.now()
    };
    this.cerrarModalJustificante();
    this.realizarEnvioFinal(actual, motivo);
  }

  /** Envío real al cloud. Si `motivo` viene, marca el checklist como retraso justificado. */
  private async realizarEnvioFinal(actual: any, motivo: any | null) {
    if (this.enviando()) return; // evita doble envío por doble toque
    actual.enviado = true;
    const ahora = new Date();
    actual.horaEnvio = ahora.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    if (motivo) {
      actual.entregaConRetraso = true;
      actual.motivoRetraso = motivo;
    }
    // Mostramos "Enviando…" mientras sube. Con TOPE de 6s para no colgar la UI si
    // la red está muy mala: si no termina a tiempo, seguimos (guardarEnLaNube
    // sigue reintentando en segundo plano y Firestore sincroniza al reconectar).
    this.enviando.set(true);
    try {
      await Promise.race([
        this.guardarEnLaNube(actual),
        new Promise<void>(res => setTimeout(res, 6000))
      ]);
    } finally {
      this.enviando.set(false);
    }
    const txt = motivo
      ? ' ✅ ¡Enviado con justificante de retraso!'
      : ' ✅ ¡Checklist enviado correctamente!';
    this.mostrarToast(txt);
    this.volverALista();
  }

  toggleEmpleado(nombre: string) {
    const index = this.formAssigned.indexOf(nombre);
    if (index > -1) this.formAssigned.splice(index, 1);
    else this.formAssigned.push(nombre);
  }

  // 🧙 abrirModal() resetea el wizard al paso 1
  abrirModal() {
    this.isEditandoTarea = false;
    this.editandoChecklistId = null;
    this.formName = '';
    this.formAssigned = [];
    this.formStore = this.sucursalesDisponibles().length > 0 ? this.sucursalesDisponibles()[0] : '';
    this.formItems = [{
      text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false,
      permiteGaleria: false, permiteDocumentos: false, tiempoEstimado: 60,
      fechaInicio: '', horaInicio: '', fechaLimite: '', horaLimite: '',
      date: '', time: ''
    }];
    this.fasesTemporales = [];
    // Reset campos de mantenimiento
    this.formMantSucursalOrigen = '';
    this.formMantTipo = '';
    this.formMantUbicacion = '';
    this.formMantPrioridad = 'normal';
    this.formMantFoto = '';
    this.formMantFotoSubiendo = false;
    // Reset wizard
    this.wizardStep = 1;
    this.wizardTipoEvidencia = 'ninguna';
    this.terminoBusquedaEmpleadoWizard = '';
    // 📅 Reset preset de fecha (por defecto: hoy)
    this.presetFechaTarea = 'hoy';
    const offset = new Date().getTimezoneOffset() * 60000;
    this.formFechaTarea = new Date(Date.now() - offset).toISOString().split('T')[0];
    this.isModalOpen = true;
  }

  // ==========================================================================
  // TAREAS DE EQUIPO — wizard de creación
  // ==========================================================================
  abrirModalEquipo() {
    this.pasoEquipoWizard = 1;
    this.equipoFormName = '';
    this.equipoFormObjetivo = '';
    this.equipoFormStore = this.sucursalesDisponibles().length > 0 ? this.sucursalesDisponibles()[0] : '';
    this.equipoFormDate = this.hoyIsoStr;
    this.equipoFormIntegrantes = [];
    this.equipoFormJefe = '';
    this.equipoFormFases = [{ id: 'fase_' + Date.now(), nombre: 'Fase 1', items: [] }];
    this.equipoBusquedaIntegrante = '';
    this.isModalEquipoOpen = true;
  }
  cerrarModalEquipo() { this.isModalEquipoOpen = false; }

  /** Avance/retroceso del wizard de equipo. */
  puedeAvanzarEquipoWizard(): boolean {
    switch (this.pasoEquipoWizard) {
      case 1: return !!this.equipoFormName.trim() && !!this.equipoFormStore && !!this.equipoFormDate;
      case 2: return this.equipoFormIntegrantes.length >= 2;
      case 3: return !!this.equipoFormJefe && this.equipoFormIntegrantes.includes(this.equipoFormJefe);
      case 4: return this.equipoFormFases.length > 0 && this.equipoFormFases.every(f => f.nombre.trim().length > 0);
      default: return false;
    }
  }
  avanzarEquipoWizard() {
    if (!this.puedeAvanzarEquipoWizard()) return;
    if (this.pasoEquipoWizard < 4) this.pasoEquipoWizard = (this.pasoEquipoWizard + 1) as 1 | 2 | 3 | 4;
  }
  retrocederEquipoWizard() {
    if (this.pasoEquipoWizard > 1) this.pasoEquipoWizard = (this.pasoEquipoWizard - 1) as 1 | 2 | 3 | 4;
  }

  /** Toggle de integrantes en el paso 2 del wizard. */
  toggleIntegranteEquipoWizard(nombre: string) {
    const i = this.equipoFormIntegrantes.indexOf(nombre);
    if (i >= 0) {
      this.equipoFormIntegrantes.splice(i, 1);
      if (this.equipoFormJefe === nombre) this.equipoFormJefe = '';
    } else {
      this.equipoFormIntegrantes.push(nombre);
    }
  }

  /**
   * Empleados del paso 2 del wizard de Equipo: SOLO quienes pertenecen de verdad
   * a la sucursal elegida (su sucursal está literalmente en su perfil). No se
   * incluyen admins globales ni gente con 'General (Acceso Total)', para que el
   * equipo sea de esa sucursal y no salga medio directorio.
   */
  /** Texto del ámbito elegido en el wizard de equipo (para los hints). */
  get ambitoEquipoTexto(): string {
    if (this.equipoFormStore === this.OPCION_TODO_MEGA || this.equipoFormStore === this.OPCION_TODAS_SUCURSALES) {
      return this.equipoFormStore;
    }
    return 'la sucursal ' + this.equipoFormStore;
  }

  get empleadosParaEquipoWizard(): any[] {
    if (!this.equipoFormStore) return [];
    const sucsDe = (e: any): string[] =>
      (e.sucursales && e.sucursales.length) ? e.sucursales : (e.sucursal ? [e.sucursal] : []);
    let lista: any[];
    if (this.equipoFormStore === this.OPCION_TODO_MEGA) {
      // Todo Mega Dulces: cualquier persona del sistema.
      lista = this.empleados().slice();
    } else if (this.equipoFormStore === this.OPCION_TODAS_SUCURSALES) {
      // Todas las sucursales: personal de las tiendas físicas (o acceso total).
      const tiendas = new Set(this.sucursalesTiendaProyecto.map(s => normalizarNombre(s)));
      const comodin = normalizarNombre('General (Acceso Total)');
      lista = this.empleados().filter(e =>
        sucsDe(e).some((s: string) => { const n = normalizarNombre(s); return tiendas.has(n) || n === comodin; }));
    } else {
      const store = normalizarNombre(this.equipoFormStore);
      lista = this.empleados().filter(e =>
        sucsDe(e).some((s: string) => normalizarNombre(s) === store));
    }
    const t = this.equipoBusquedaIntegrante.trim().toLowerCase();
    if (t) lista = lista.filter(e => (e.nombre || '').toLowerCase().includes(t));
    return lista.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
  }

  /** Manejo de fases temporales en paso 4. */
  agregarFaseEquipoTemp() {
    const i = this.equipoFormFases.length + 1;
    this.equipoFormFases.push({ id: 'fase_' + Date.now() + '_' + i, nombre: `Fase ${i}`, items: [] });
  }
  eliminarFaseEquipoTemp(idx: number) {
    if (this.equipoFormFases.length === 1) return; // siempre al menos una
    this.equipoFormFases.splice(idx, 1);
  }
  agregarItemFaseEquipoTemp(faseIdx: number) {
    this.equipoFormFases[faseIdx].items.push({
      id: 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      asignado: this.equipoFormIntegrantes[0] || '',
      texto: '',
      objetivo: '',
      horaLimite: '',
      requiresPhoto: false,
      requiresAntesDespues: false
    });
  }

  /** Crea de un jalón una tarea (vacía) para CADA integrante en la fase. */
  agregarTareaPorIntegrante(faseIdx: number) {
    for (const nombre of this.equipoFormIntegrantes) {
      this.equipoFormFases[faseIdx].items.push({
        id: 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        asignado: nombre, texto: '', objetivo: '', horaLimite: '',
        requiresPhoto: false, requiresAntesDespues: false
      });
    }
  }
  eliminarItemFaseEquipoTemp(faseIdx: number, itemIdx: number) {
    this.equipoFormFases[faseIdx].items.splice(itemIdx, 1);
  }

  /** Guarda definitivamente la Tarea de Equipo en Firestore (colección tareas_equipo).
   *  La primera fase queda 'activa'; las siguientes 'pendiente'. */
  async guardarTareaEquipo() {
    if (!this.puedeAvanzarEquipoWizard()) {
      this.mostrarToast(' Faltan datos en el último paso.');
      return;
    }
    const id = 'eq_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const ahora = Date.now();
    const fases: FaseEquipo[] = this.equipoFormFases.map((f, idx) => ({
      id: f.id,
      nombre: f.nombre.trim(),
      orden: idx,
      estado: idx === 0 ? 'activa' : 'pendiente',
      items: f.items.filter(it => it.texto.trim().length > 0 && it.asignado).map(it => ({
        id: it.id,
        asignado: it.asignado,
        texto: it.texto.trim(),
        objetivo: it.objetivo?.trim() || undefined,
        horaLimite: it.horaLimite || undefined,
        requiresPhoto: !!it.requiresPhoto && !it.requiresAntesDespues,
        requiresAntesDespues: !!it.requiresAntesDespues,
        completada: false,
        subtareas: [],
        agregadaPor: this.currentUser?.nombre || 'admin',
        agregadaEn: ahora
      })),
      iniciadaEn: idx === 0 ? ahora : undefined
    }));
    const tarea: TareaEquipo = {
      id,
      name: this.equipoFormName.trim(),
      objetivo: this.equipoFormObjetivo.trim(),
      store: this.equipoFormStore,
      date: this.equipoFormDate,
      createdBy: this.currentUser?.nombre || 'admin',
      jefeEquipo: this.equipoFormJefe,
      integrantes: [...this.equipoFormIntegrantes],
      fases,
      cerrado: false,
      timestampCreacion: ahora,
      _tipo: 'equipo'
    };
    try {
      await setDoc(doc(this.firestore, 'tareas_equipo', id), tarea);
      await this.api.guardar('/api/tareas-equipo', { ...tarea, id: String(id) }); // FERROCARRIL Etapa 7
      this.mostrarToast(' Proyecto en equipo creado.');
      this.cerrarModalEquipo();
    } catch (e) {
      console.error('[guardarTareaEquipo]', e);
      this.mostrarToast(' Error al crear el proyecto.');
    }
  }

  // ==========================================================================
  // TAREAS DE EQUIPO — operaciones en vivo (jefe + integrantes)
  // ==========================================================================
  /** ¿El usuario actual puede monitorear/agregar tareas? (admin global, admin
   *  limitado con sucursal del proyecto, creador o jefe designado). */
  puedeMonitorearEquipo(t: TareaEquipo | null): boolean {
    if (!t) return false;
    const u = this.currentUser;
    if (esAdminGlobal(u)) return true;
    if (esAdminLimitado(u)) {
      const perms = sucursalesPermitidas(u);
      if (perms === null || perms.includes(t.store)) return true;  // null = comodin (acceso total)
    }
    if (mismoEmpleadoNombre(u?.nombre, t.createdBy)) return true;
    if (mismoEmpleadoNombre(u?.nombre, t.jefeEquipo)) return true;
    return false;
  }

  /** ¿El usuario actual puede ver/completar este item? (su asignado o jefe). */
  puedeOperarItemEquipo(t: TareaEquipo, item: ItemEquipo): boolean {
    const u = this.currentUser;
    if (mismoEmpleadoNombre(u?.nombre, item.asignado)) return true;
    return this.puedeMonitorearEquipo(t);
  }

  /** Items que el usuario actual debe ver dentro de una fase. */
  itemsVisiblesParaUsuario(t: TareaEquipo, fase: FaseEquipo): ItemEquipo[] {
    if (this.puedeMonitorearEquipo(t)) return fase.items;
    const mi = this.currentUser?.nombre;
    return fase.items.filter(i => mismoEmpleadoNombre(i.asignado, mi));
  }

  /** Progreso de una fase (0..100) basado en items completados. */
  progresoFase(fase: FaseEquipo): number {
    if (!fase.items || fase.items.length === 0) return 0;
    const ok = fase.items.filter(i => i.completada).length;
    return Math.round((ok / fase.items.length) * 100);
  }
  /** Progreso global del proyecto (promedio de fases). */
  progresoEquipo(t: TareaEquipo): number {
    if (!t.fases || t.fases.length === 0) return 0;
    const suma = t.fases.reduce((acc, f) => acc + this.progresoFase(f), 0);
    return Math.round(suma / t.fases.length);
  }

  /** Marca/desmarca un item como completado. */
  async toggleItemEquipoCompletado(t: TareaEquipo, faseId: string, itemId: string) {
    if (t.cerrado) return;
    const fresca = await this.obtenerTareaEquipoFresca(t.id);
    if (!fresca) return;
    const fase = fresca.fases.find(f => f.id === faseId);
    if (!fase || fase.estado !== 'activa') {
      this.mostrarToast(' Esta fase no está activa.');
      return;
    }
    const item = fase.items.find(i => i.id === itemId);
    if (!item) return;
    if (!this.puedeOperarItemEquipo(fresca, item)) return;
    item.completada = !item.completada;
    item.completadaEn = item.completada ? Date.now() : undefined;
    await setDoc(doc(this.firestore, 'tareas_equipo', t.id), { fases: fresca.fases }, { merge: true });
    await this.api.parchar('/api/tareas-equipo', t.id, { fases: fresca.fases }); // FERROCARRIL Etapa 7
  }

  /** Fotos de un item de equipo (junta la foto legacy `photo` con el arreglo `photos`). */
  fotosItemEquipo(item: any): { url: string; time?: string }[] {
    const arr = Array.isArray(item?.photos) ? [...item.photos] : [];
    if (item?.photo && item.photo !== 'subiendo...' && !arr.some(p => p.url === item.photo)) {
      arr.unshift({ url: item.photo, time: item.photoTime });
    }
    return arr;
  }

  /** Sube UNA o VARIAS fotos a un item de Tarea de Equipo (asignado o jefe). */
  async subirFotosItemEquipo(event: any, t: TareaEquipo, faseId: string, itemId: string) {
    const files: File[] = Array.from(event?.target?.files || []);
    if (!files.length) return;
    if (t.cerrado) { this.mostrarToast(' El proyecto está cerrado.'); event.target.value = ''; return; }

    this.mostrarToast(` Subiendo ${files.length} foto(s)...`);
    const urls: string[] = [];
    for (const f of files) {
      let file: File;
      try { file = await comprimirImagenSiAplica(f); } catch { file = f; }
      const res = await this.subirACloudinary(file);
      if (res.ok && res.url) urls.push(res.url);
    }
    if (!urls.length) {
      Swal.fire({ icon: 'warning', title: 'No se pudieron subir las fotos', text: 'Revisa tu conexión e intenta de nuevo.', confirmButtonColor: 'var(--action)' });
      event.target.value = '';
      return;
    }

    const fresca = await this.obtenerTareaEquipoFresca(t.id);
    if (!fresca) { event.target.value = ''; return; }
    const fase = fresca.fases.find(f => f.id === faseId);
    const item: any = fase?.items.find(i => i.id === itemId);
    if (!item) { event.target.value = ''; return; }
    if (!this.puedeOperarItemEquipo(fresca, item)) {
      this.mostrarToast(' No puedes subir fotos a esta tarea.');
      event.target.value = '';
      return;
    }

    if (!Array.isArray(item.photos)) item.photos = [];
    // Migra la foto legacy al arreglo para tener una sola fuente.
    if (item.photo && item.photo !== 'subiendo...' && !item.photos.some((p: any) => p.url === item.photo)) {
      item.photos.unshift({ url: item.photo, time: item.photoTime });
    }
    item.photo = '';
    const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    for (const u of urls) item.photos.push({ url: u, time });

    await setDoc(doc(this.firestore, 'tareas_equipo', t.id), { fases: fresca.fases }, { merge: true });
    await this.api.parchar('/api/tareas-equipo', t.id, { fases: fresca.fases }); // FERROCARRIL Etapa 7
    this.mostrarToast(` ✓ ${urls.length} foto(s) subida(s)`);
    event.target.value = '';
  }

  /** Quita una foto de un item de equipo. */
  async quitarFotoItemEquipo(t: TareaEquipo, faseId: string, itemId: string, url: string) {
    if (t.cerrado) return;
    const res = await Swal.fire({ title: 'Quitar foto', text: '¿Eliminar esta foto?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Sí, quitar', cancelButtonText: 'Cancelar', confirmButtonColor: 'var(--bad-fg)' });
    if (!res.isConfirmed) return;
    const fresca = await this.obtenerTareaEquipoFresca(t.id);
    if (!fresca) return;
    const fase = fresca.fases.find(f => f.id === faseId);
    const item: any = fase?.items.find(i => i.id === itemId);
    if (!item || !this.puedeOperarItemEquipo(fresca, item)) return;
    if (item.photo === url) item.photo = '';
    if (Array.isArray(item.photos)) item.photos = item.photos.filter((p: any) => p.url !== url);
    await setDoc(doc(this.firestore, 'tareas_equipo', t.id), { fases: fresca.fases }, { merge: true });
    await this.api.parchar('/api/tareas-equipo', t.id, { fases: fresca.fases }); // FERROCARRIL Etapa 7
    this.mostrarToast(' Foto eliminada');
  }

  /** Marca/desmarca una subtarea de un item. */
  async toggleSubtareaEquipo(t: TareaEquipo, faseId: string, itemId: string, subId: string) {
    if (t.cerrado) return;
    const fresca = await this.obtenerTareaEquipoFresca(t.id);
    if (!fresca) return;
    const fase = fresca.fases.find(f => f.id === faseId);
    if (!fase || fase.estado !== 'activa') return;
    const item = fase.items.find(i => i.id === itemId);
    if (!item) return;
    if (!this.puedeOperarItemEquipo(fresca, item)) return;
    const sub = item.subtareas.find(s => s.id === subId);
    if (!sub) return;
    sub.completada = !sub.completada;
    sub.completadaPor = sub.completada ? this.currentUser?.nombre : undefined;
    sub.completadaEn = sub.completada ? Date.now() : undefined;
    await setDoc(doc(this.firestore, 'tareas_equipo', t.id), { fases: fresca.fases }, { merge: true });
    await this.api.parchar('/api/tareas-equipo', t.id, { fases: fresca.fases }); // FERROCARRIL Etapa 7
  }

  /** Jefe agrega una tarea nueva en la fase activa, asignada a un integrante. */
  async agregarItemEnVivo(t: TareaEquipo, faseId: string) {
    if (!this.puedeMonitorearEquipo(t) || t.cerrado) return;
    if (!this.nuevoItemTexto.trim() || !this.nuevoItemAsignado) {
      this.mostrarToast(' Falta texto o asignado.');
      return;
    }
    const fresca = await this.obtenerTareaEquipoFresca(t.id);
    if (!fresca) return;
    const fase = fresca.fases.find(f => f.id === faseId);
    if (!fase || fase.estado !== 'activa') return;
    fase.items.push({
      id: 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      asignado: this.nuevoItemAsignado,
      texto: this.nuevoItemTexto.trim(),
      horaLimite: this.nuevoItemHoraLimite || undefined,
      requiresPhoto: this.nuevoItemRequiresPhoto,
      completada: false,
      subtareas: [],
      agregadaPor: this.currentUser?.nombre,
      agregadaEn: Date.now()
    });
    await setDoc(doc(this.firestore, 'tareas_equipo', t.id), { fases: fresca.fases }, { merge: true });
    await this.api.parchar('/api/tareas-equipo', t.id, { fases: fresca.fases }); // FERROCARRIL Etapa 7
    this.nuevoItemTexto = '';
    this.nuevoItemHoraLimite = '';
    this.nuevoItemRequiresPhoto = false;
    this.agregandoEnFaseId = null;
    this.mostrarToast(' Tarea agregada al equipo.');
  }

  /** ¿El usuario actual es integrante (o jefe) de este equipo? */
  esIntegranteEquipo(t: TareaEquipo | null): boolean {
    if (!t) return false;
    const mi = this.currentUser?.nombre;
    if (mismoEmpleadoNombre(t.jefeEquipo, mi)) return true;
    return (t.integrantes || []).some(n => mismoEmpleadoNombre(n, mi));
  }

  /** ¿Puede agregar una tarea PROPIA (auto-asignada) en la fase activa?
   *  Cualquier integrante puede; los monitores ya usan agregarItemEnVivo. */
  puedeAgregarTareaPropia(t: TareaEquipo | null): boolean {
    if (!t || t.cerrado) return false;
    return this.esIntegranteEquipo(t) || this.puedeMonitorearEquipo(t);
  }

  /** Integrante agrega una tarea suya (auto-asignada) en la fase activa. */
  async agregarTareaPropiaEnVivo(t: TareaEquipo, faseId: string) {
    if (!this.puedeAgregarTareaPropia(t) || t.cerrado) return;
    if (!this.nuevaTareaPropiaTexto.trim()) {
      this.mostrarToast(' Escribe la tarea que quieres agregar.');
      return;
    }
    const fresca = await this.obtenerTareaEquipoFresca(t.id);
    if (!fresca) return;
    const fase = fresca.fases.find(f => f.id === faseId);
    if (!fase || fase.estado !== 'activa') {
      this.mostrarToast(' Esta fase no está activa.');
      return;
    }
    fase.items.push({
      id: 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      asignado: this.currentUser?.nombre,
      texto: this.nuevaTareaPropiaTexto.trim(),
      horaLimite: this.nuevaTareaPropiaHora || undefined,
      requiresPhoto: false,
      completada: false,
      subtareas: [],
      agregadaPor: this.currentUser?.nombre,
      agregadaEn: Date.now()
    });
    await setDoc(doc(this.firestore, 'tareas_equipo', t.id), { fases: fresca.fases }, { merge: true });
    await this.api.parchar('/api/tareas-equipo', t.id, { fases: fresca.fases }); // FERROCARRIL Etapa 7
    this.nuevaTareaPropiaTexto = '';
    this.nuevaTareaPropiaHora = '';
    this.agregandoTareaPropiaFaseId = null;
    this.mostrarToast(' Tu tarea fue agregada.');
  }

  /** Jefe agrega una subtarea dentro de un item existente. */
  async agregarSubtareaEnVivo(t: TareaEquipo, faseId: string, itemId: string) {
    if (!this.puedeMonitorearEquipo(t) || t.cerrado) return;
    if (!this.nuevaSubtareaTexto.trim()) return;
    const fresca = await this.obtenerTareaEquipoFresca(t.id);
    if (!fresca) return;
    const fase = fresca.fases.find(f => f.id === faseId);
    const item = fase?.items.find(i => i.id === itemId);
    if (!fase || !item || fase.estado !== 'activa') return;
    const sub: SubtareaEquipo = {
      id: 'sub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
      texto: this.nuevaSubtareaTexto.trim(),
      completada: false
    };
    item.subtareas.push(sub);
    await setDoc(doc(this.firestore, 'tareas_equipo', t.id), { fases: fresca.fases }, { merge: true });
    await this.api.parchar('/api/tareas-equipo', t.id, { fases: fresca.fases }); // FERROCARRIL Etapa 7
    this.nuevaSubtareaTexto = '';
    this.agregandoSubtareaItemId = null;
  }

  /** Jefe cierra la fase activa. Abre automáticamente la siguiente. */
  async cerrarFaseEquipo(t: TareaEquipo, faseId: string) {
    if (!this.puedeMonitorearEquipo(t) || t.cerrado) return;
    const fresca = await this.obtenerTareaEquipoFresca(t.id);
    if (!fresca) return;
    const fase = fresca.fases.find(f => f.id === faseId);
    if (!fase || fase.estado !== 'activa') return;
    // Confirma que todos los items están completos antes de cerrar
    const incompletos = fase.items.filter(i => !i.completada);
    if (incompletos.length > 0) {
      const r = await Swal.fire({
        title: `Quedan ${incompletos.length} tarea(s) incompleta(s)`,
        text: '¿Cerrar la fase de todas formas? Las tareas incompletas quedarán como vencidas.',
        icon: 'warning', showCancelButton: true,
        confirmButtonText: 'Sí, cerrar fase', cancelButtonText: 'Cancelar',
        confirmButtonColor: 'var(--warn-fg)'
      });
      if (!r.isConfirmed) return;
    }
    fase.estado = 'completa';
    fase.cerradaEn = Date.now();
    fase.cerradaPor = this.currentUser?.nombre;
    // Abre la siguiente fase si existe
    const siguiente = fresca.fases.find(f => f.orden === fase.orden + 1);
    if (siguiente) {
      siguiente.estado = 'activa';
      siguiente.iniciadaEn = Date.now();
    }
    await setDoc(doc(this.firestore, 'tareas_equipo', t.id), { fases: fresca.fases }, { merge: true });
    await this.api.parchar('/api/tareas-equipo', t.id, { fases: fresca.fases }); // FERROCARRIL Etapa 7
    this.mostrarToast(siguiente ? ` Fase cerrada. Inicia: ${siguiente.nombre}` : ' Última fase cerrada.');
  }

  /** Jefe cierra el proyecto completo (solo si todas las fases están completas). */
  async cerrarProyectoEquipo(t: TareaEquipo) {
    if (!this.puedeMonitorearEquipo(t)) return;
    const fresca = await this.obtenerTareaEquipoFresca(t.id);
    if (!fresca) return;
    const incompletas = fresca.fases.filter(f => f.estado !== 'completa').length;
    if (incompletas > 0) {
      this.mostrarToast(' Aún hay fases sin cerrar.');
      return;
    }
    const r = await Swal.fire({
      title: '¿Cerrar el proyecto?',
      text: 'Quedará archivado y no aparecerá más en el listado.',
      icon: 'question', showCancelButton: true,
      confirmButtonText: 'Cerrar proyecto', cancelButtonText: 'Cancelar',
      confirmButtonColor: 'var(--action)'
    });
    if (!r.isConfirmed) return;
    const cierreEquipo = { cerrado: true, cerradoEn: Date.now() };
    await setDoc(doc(this.firestore, 'tareas_equipo', t.id), cierreEquipo, { merge: true });
    await this.api.parchar('/api/tareas-equipo', t.id, cierreEquipo); // FERROCARRIL Etapa 7
    this.volverDeEquipoDetalle();
  }

  /**
   * ¿Puede ELIMINAR el proyecto? Solo administradores, que es la misma política
   * que ya tenían las reglas para `tareas_equipo`. El creador y el jefe pueden
   * monitorear y cerrar el proyecto, pero borrarlo no.
   */
  puedeEliminarEquipo(t: TareaEquipo | null): boolean {
    if (!t) return false;
    const u = this.currentUser;
    if (esAdminGlobal(u)) return true;
    if (esAdminLimitado(u)) {
      const perms = sucursalesPermitidas(u);
      return perms === null || perms.includes(t.store);   // null = acceso total
    }
    return false;
  }

  /**
   * Elimina el proyecto de equipo.
   *
   * Es un borrado MARCADO, no físico: se guarda `eliminado` y desaparece de la
   * lista para todos, pero el registro sigue en la base y se puede devolver si
   * fue un error. Con el trabajo de siete personas adentro, un borrado
   * irreversible por un clic de más no vale la pena.
   */
  async eliminarProyectoEquipo(t: TareaEquipo) {
    if (!this.puedeEliminarEquipo(t)) return;
    const r = await Swal.fire({
      title: '¿Eliminar el proyecto?',
      html: `Se va a quitar <b>${t.name || 'este proyecto'}</b> de la lista, con todas sus fases y su avance.`,
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Sí, eliminar', cancelButtonText: 'Cancelar',
      confirmButtonColor: 'var(--bad-fg)'
    });
    if (!r.isConfirmed) return;

    const marca = {
      eliminado: true, eliminadoEn: Date.now(),
      eliminadoPor: this.currentUser?.nombre || ''
    };
    try {
      // Postgres es el bueno: si esto falla, no se borró nada y hay que decirlo.
      await this.api.parchar('/api/tareas-equipo', t.id, marca);
    } catch (e: any) {
      Swal.fire({
        icon: 'error', title: 'No se pudo eliminar',
        text: e?.message || 'Inténtalo de nuevo.', confirmButtonColor: 'var(--action)'
      });
      return;
    }
    // El respaldo de Firestore es opcional: que no tumbe la operación.
    try {
      await setDoc(doc(this.firestore, 'tareas_equipo', t.id), marca, { merge: true });
    } catch (e) {
      console.warn('[checklist] no se pudo marcar el borrado en el respaldo de Firestore', e);
    }

    this.tareasEquipo.set(this.tareasEquipo().filter(x => x.id !== t.id));
    this.volverDeEquipoDetalle();
    this.mostrarToast('Proyecto eliminado.');
  }

  /** Lee el doc fresco antes de mutar (evita race conditions con el snapshot). */
  private async obtenerTareaEquipoFresca(id: string): Promise<TareaEquipo | null> {
    // FERROCARRIL Etapa 7: lee la tarea fresca desde Postgres (antes getDoc Firestore).
    const resp = await this.api.get('/api/tareas-equipo?id=' + encodeURIComponent(String(id))).catch(() => null);
    return resp?.item ? ({ ...resp.item, id } as TareaEquipo) : null;
  }

  /** Navegación vista detalle equipo. */
  verDetalleEquipo(t: TareaEquipo) {
    this.tareaEquipoSeleccionada.set(t);
    this.vistaEquipo.set('detalle');
  }
  volverDeEquipoDetalle() {
    this.tareaEquipoSeleccionada.set(null);
    this.vistaEquipo.set('lista');
  }

  cerrarModal() { this.isModalOpen = false; }
  agregarItem() {
    this.formItems.push({
      text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false,
      permiteGaleria: false, permiteDocumentos: false, tiempoEstimado: 60,
      fechaInicio: '', horaInicio: '', fechaLimite: '', horaLimite: '',
      date: '', time: ''
    });
  }
  eliminarItem(index: number) { this.formItems.splice(index, 1); }
  trackByIndex(index: number, _obj: any): any { return index; }

  /** trackBy para los *ngFor de checklists. Usa el id firestore para no
   *  destruir/recrear las tarjetas cuando solo cambian campos internos. */
  trackByChecklist(_: number, c: any): any { return c?.id || c?._asignacionId || _; }

  abrirEditarChecklistActual() {
    const actual = this.checklistSeleccionado();
    if (!actual) return;
    this.cargarChecklistEnFormParaEditar(actual);
  }

  /**
   * Abre el modal de Tarea Única en modo edición desde una tarjeta del listado.
   * Solo admin (o el creador de la tarea) puede hacerlo.
   */
  editarTareaUnica(checklist: any, event: Event) {
    event.stopPropagation();
    const esAdmin = this.currentUser?.rol === 'admin';
    const esCreador = checklist.createdBy === this.currentUser?.nombre;
    if (!esAdmin && !esCreador) {
      Swal.fire({ icon: 'error', title: 'Sin permiso', text: 'Solo el creador o un administrador pueden editar.', confirmButtonColor: 'var(--action)' });
      return;
    }
    this.cargarChecklistEnFormParaEditar(checklist);
  }

  /** Carga un checklist en el formulario de Tarea Única para editarlo. */
  private cargarChecklistEnFormParaEditar(actual: any) {
    this.isEditandoTarea = true;
    this.editandoChecklistId = (actual.id ?? '').toString();
    this.formName = actual.name || '';
    this.formAssigned = actual.assigned ? [actual.assigned] : [];
    this.formStore = actual.store || '';
    this.formItems = actual.items ? JSON.parse(JSON.stringify(actual.items)) : [];
    this.fasesTemporales = actual.subtareas ? JSON.parse(JSON.stringify(actual.subtareas)) : [];
    // Preset de fecha: arranca en custom con la fecha actual del checklist.
    this.formFechaTarea = actual.date || this.hoyIsoStr;
    this.presetFechaTarea = 'custom';
    // Tipo de evidencia derivado del primer item para que el wizard lo refleje.
    const it = this.formItems[0];
    if (it?.requiresAntesDespues) this.wizardTipoEvidencia = 'antesDespues';
    else if (it?.requiresVariasFotos) this.wizardTipoEvidencia = 'variasFotos';
    else if (it?.requiresPhoto) this.wizardTipoEvidencia = 'foto';
    else this.wizardTipoEvidencia = 'ninguna';
    this.wizardStep = 1;
    this.terminoBusquedaEmpleadoWizard = '';
    this.isModalOpen = true;
  }

  async enviarAvisoPorCorreo(empleadoNombre: string, nombreTarea: string) {
    const empleado = this.empleados().find(emp => emp.nombre === empleadoNombre);
    const correoDestino = empleado?.correo || empleado?.email;
    if (!correoDestino) {
      this.mostrarToast(` ⚠️ No se pudo enviar correo a ${empleadoNombre}.`);
      return;
    }
    const nombreAsignador = this.currentUser?.nombre || 'Administración';
    const asunto = `NUEVA TAREA de ${nombreAsignador}: ${nombreTarea} - Mega Dulces Task`;
    // Igual que en el aviso de WhatsApp: la dirección se toma de donde corre la
    // app, no escrita a mano, para que el correo no mande gente a la URL vieja.
    const cuerpo = `Hola ${empleadoNombre},\n\n¡${nombreAsignador} te ha asignado una nueva tarea!\n\n 📌 Operación: ${nombreTarea}\n\nIngresa a ${window.location.origin}/\n\nSaludos,\n${nombreAsignador}.`;
    const googleScriptUrl = 'https://script.google.com/macros/s/AKfycbw3rrfQizd-jHzz0gBEF3Gj8fOEYOnJ-w4X1rY1GoKAzn7636mnEyDrd7gvSqvyLNH9sg/exec';
    const miCorreo = this.currentUser?.correo || 'gerencia@megadulces.com';
    try {
      await fetch(googleScriptUrl, {
        method: 'POST', mode: 'no-cors',
        body: JSON.stringify({ to: correoDestino, subject: asunto, body: cuerpo, replyTo: miCorreo })
      });
    } catch (error) { console.error(' ❌ Error enviando correo:', error); }
  }

  /**
   * Devuelve los nombres de empleados que tienen día de descanso en la fecha dada.
   * Consulta puntual a Firestore filtrada por semanaISO (1 documento por trabajador/semana).
   */
  private async verificarConflictosDescanso(empleadosNombres: string[], fechaStr: string): Promise<string[]> {
    if (!fechaStr) return [];
    try {
      // Forzamos hora 12:00 para evitar saltos de día por timezone
      const fecha = new Date(fechaStr + 'T12:00:00');
      const semana = obtenerSemanaISO(fecha);
      const nombreDia = obtenerNombreDia(fecha);

      // FERROCARRIL Etapa 6: descansos de la semana desde Postgres (antes getDocs).
      const respDesc = await this.api.get('/api/descansos-semanales?semanaISO=' + encodeURIComponent(semana));
      const docs: any[] = respDesc?.items || [];

      const conflictos: string[] = [];
      for (const nombre of empleadosNombres) {
        const emp = this.empleados().find((e: any) => e.nombre === nombre);
        if (!emp) continue;
        const uid = emp.uid || emp.id || emp.idFirestore;
        if (!uid) continue;
        const doc = docs.find(d => d.userId === uid);
        if (doc && doc.dias?.includes(nombreDia)) {
          conflictos.push(nombre);
        }
      }
      return conflictos;
    } catch (e) {
      console.error('Error verificando descansos:', e);
      return []; // En caso de error, no bloqueamos el guardado
    }
  }

  async guardarChecklistUnico() {
    if (!this.formName || this.formAssigned.length === 0) {
      alert('Faltan datos.');
      return;
    }

    const tareasValidas = this.formItems
      .filter(item => item.text.trim() !== '')
      .map((item, i) => ({
        id: item.id || (Date.now() + i),
        text: item.text,
        requiresPhoto: item.requiresPhoto,
        requiresAntesDespues: item.requiresAntesDespues,
        requiresVariasFotos: item.requiresVariasFotos || false,
        permiteGaleria: item.permiteGaleria || false,
        permiteDocumentos: item.permiteDocumentos || false,
        tiempoEstimado: item.requiresAntesDespues ? (item.tiempoEstimado || 30) : null,
        archivoInstruccion: item.archivoInstruccion || null,
        nombreArchivo: item.nombreArchivo || null,
        fechaInicio: item.fechaInicio || null,
        horaInicio:  item.horaInicio  || null,
        fechaLimite: item.fechaLimite || null,
        horaLimite:  item.horaLimite  || null,
        date: item.fechaLimite || item.date || null,
        time: item.horaLimite  || item.time || null,
        // 🔁 En edición preservamos lo que el trabajador ya haya hecho (evidencia,
        // checks). En creación normal item.* es undefined → quedan vacíos.
        checked: item.checked || false,
        // Los sellos de tiempo viajan con lo demas: si se caen aqui, al editar un
        // checklist ya trabajado se perderia la prueba de que se hizo a tiempo y
        // volveria a pedir justificante (ver entregadaTarde()).
        checkedEn: item.checkedEn || null,
        photo: item.photo || null,
        photoTime: item.photoTime || null,
        photoTimestamp: item.photoTimestamp || null,
        photoAntes: item.photoAntes || null,
        photoAntesTime: item.photoAntesTime || null,
        photoAntesTimestamp: item.photoAntesTimestamp || null,
        photoDespues: item.photoDespues || null,
        photoDespuesTime: item.photoDespuesTime || null,
        photoDespuesTimestamp: item.photoDespuesTimestamp || null,
        photos: item.photos || [],
        tipo: 'tarea'
      }));

    if (tareasValidas.length === 0) {
      alert('Agrega tareas.');
      return;
    }

    // 🔁 REASIGNACIÓN AUTOMÁTICA POR TURNO/DESCANSO (igual que las rutinas).
    // Antes: si alguien estaba fuera de turno se BLOQUEABA, y si descansaba se
    // ADVERTÍA. Ahora, si el asignado no está disponible para la fecha/hora de la
    // tarea, se reasigna al primer disponible de la misma sucursal. Precargamos
    // turnos (signal ya cargado) + descansos de la semana de la fecha.
    const offsetTz = new Date().getTimezoneOffset() * 60000;
    const fechaCheckStr = tareasValidas[0].date ||
      new Date(Date.now() - offsetTz).toISOString().split('T')[0];
    const fechaTarea = new Date(fechaCheckStr + 'T12:00:00');
    const horaTarea = tareasValidas[0].time || '23:59';
    let descansosSemana: any[] = [];
    try {
      const semana = obtenerSemanaISO(fechaTarea);
      const respDesc = await this.api.get('/api/descansos-semanales?semanaISO=' + encodeURIComponent(semana));
      descansosSemana = respDesc?.items || [];
    } catch (e) { console.error('[reasignacion] descansos', e); }
    const usuariosReasig = this.empleados();
    const nombreAUidReasig = mapaNombreAUid(usuariosReasig);
    const configTurnosReasig = this.configTurnos();
    const yaUsadosReasig = new Set<string>();
    const avisosReasig: string[] = [];
    const nombresFinales: string[] = [];

    const urlsWhatsApp: string[] = [];
    const offsetGlobal = new Date().getTimezoneOffset() * 60000;
    const hoyGlobal = new Date(Date.now() - offsetGlobal).toISOString().split('T')[0];

    // 🔧 Modo edición: sobreescribe el doc existente conservando id, timestamp
    // y createdBy. NO crea uno nuevo, NO itera por formAssigned (en edición se
    // edita un solo checklist a la vez).
    if (this.isEditandoTarea && this.editandoChecklistId) {
      const payload: any = {
        id: this.editandoChecklistId,
        name: this.formName,
        assigned: this.formAssigned[0],
        store: this.formStore,
        date: tareasValidas[0].date || hoyGlobal,
        time: tareasValidas[0].time || '23:59',
        items: JSON.parse(JSON.stringify(tareasValidas)),
        subtareas: JSON.parse(JSON.stringify(this.fasesTemporales))
      };
      await setDoc(doc(this.firestore, 'checklists', this.editandoChecklistId), payload, { merge: true });
      await this.api.patchChecklist(this.editandoChecklistId, payload);
      this.mostrarToast(' ✅ Tarea actualizada');
      this.cerrarModal();
      this.isEditandoTarea = false;
      this.editandoChecklistId = null;
      return;
    }

    let idxReasig = 0;
    for (const empleadoNombre of this.formAssigned) {
      const index = idxReasig++;
      const uniqueId = Date.now() + index;
      const hoy = hoyGlobal;

      // Reasigna al primer disponible de la sucursal si el elegido no puede
      // (fuera de turno o descansa) para la fecha/hora de la tarea.
      const resol = resolverAsignadoTarea({
        nombre: empleadoNombre, sucursal: this.formStore, fecha: fechaTarea, hora: horaTarea,
        usuarios: usuariosReasig, configTurnos: configTurnosReasig, descansosSemana,
        nombreAUid: nombreAUidReasig, yaUsados: yaUsadosReasig,
      });
      const asignadoFinal = resol.nombreFinal;
      nombresFinales.push(asignadoFinal);
      if (resol.reasignado) avisosReasig.push(`"${resol.original}" no estaba disponible (turno/descanso); la tarea pasó a "${asignadoFinal}".`);
      else if (resol.sinReemplazo) avisosReasig.push(`"${resol.original}" no está disponible y no hubo reemplazo en ${this.formStore}; quedó asignada a "${resol.original}".`);

      const checklistTareas: any = {
        id: uniqueId,
        timestampCreacion: Date.now(),
        name: this.formName,
        assigned: asignadoFinal,
        assignedUid: nombreAUidReasig.get(normalizarNombre(asignadoFinal)) || null,
        store: this.formStore,
        date: tareasValidas[0].date || hoy,
        time: tareasValidas[0].time || '23:59',
        status: 'pendiente',
        enviado: false,
        createdBy: this.currentUser?.nombre || 'Desconocido',
        notaEmpleado: '',
        items: JSON.parse(JSON.stringify(tareasValidas)),
        subtareas: JSON.parse(JSON.stringify(this.fasesTemporales))
      };

      // Orden de mantenimiento: solo se guarda si la tarea fue creada con store='MANTENIMIENTO'.
      // Asi el detalle del checklist puede mostrar la info adicional y filtros pueden buscar
      // por prioridad/tipo despues sin afectar a tareas normales.
      if (this.formStore === 'MANTENIMIENTO') {
        checklistTareas.mantenimiento = {
          sucursalOrigen: this.formMantSucursalOrigen,
          tipo: this.formMantTipo,
          ubicacion: (this.formMantUbicacion || '').trim(),
          prioridad: this.formMantPrioridad,
          fotoInicial: this.formMantFoto || null,
          reportadoPor: this.currentUser?.nombre || 'Desconocido'
        };
      }

      if (resol.reasignado) {
        checklistTareas.reasignadoTurno = true;
        checklistTareas.asignadoOriginal = resol.original;
      }
      this.guardarEnLaNube(checklistTareas);

      if (this.notificarPorWhatsApp) {
        const datosEmpleado = this.empleados().find(e => e.nombre === asignadoFinal);
        let telefono = datosEmpleado?.telefono || '';
        telefono = telefono.replace(/[\s\- \(\) ]/g, '');
        if (telefono.startsWith('+')) telefono = telefono.slice(1);
        if (telefono.length === 10) telefono = '52' + telefono;
        if (telefono) {
          // La dirección de la app NO va escrita a mano: se toma de donde está
          // corriendo. Así el enlace del WhatsApp siempre lleva al mismo lugar
          // desde donde se mandó, y el día que la app viva en otro dominio
          // (mdtask.megadulces.com.mx) no se queda mandando gente a la URL vieja.
          const urlApp = window.location.origin;
          const mensaje =
            `*Mega Dulces Task* 🍭\n\n` +
            `¡Hola *${this.limpiarEmojis(asignadoFinal)}*!\n` +
            `Se te ha asignado un nuevo checklist: *${this.limpiarEmojis(this.formName)}*\n\n` +
            ` 📅 Fecha: ${checklistTareas.date}\n` +
            ` ⏰ Hora Límite: ${this.formatearHora(checklistTareas.time)}\n\n` +
            ` 🔗 Entra aquí: ${urlApp}`;
          const url = `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`;
          urlsWhatsApp.push(url);
        }
      }

      if (this.notificarPorCorreo) {
        this.enviarAvisoPorCorreo(asignadoFinal, this.formName);
      }
    }

    urlsWhatsApp.forEach((url, i) => {
      setTimeout(() => { window.open(url, '_blank'); }, i * 800);
    });

    // Aviso push SOLO a trabajadores de Espacio TEC. Usa los nombres FINALES
    // (tras la posible reasignación por turno/descanso), no los originales.
    const nombresTec = nombresFinales.filter(n =>
      this.empleados().some((e: any) => e.grupoTec === true && mismoEmpleadoNombre(e.nombre, n)));
    if (nombresTec.length) {
      this.noti.enviar({
        titulo: 'Nueva tarea asignada',
        cuerpo: this.formName,
        url: '/tareas',
        nombres: nombresTec
      });
    }

    // Si hubo reasignaciones por turno/descanso, avisar al admin qué cambió.
    if (avisosReasig.length) {
      await Swal.fire({
        title: 'Tareas reasignadas por turno/descanso',
        html: `Se crearon las tareas. Algunas se reasignaron:` +
          `<ul style="text-align:left;margin:12px 0;padding-left:22px;font-size:13px">` +
          avisosReasig.map(a => `<li>${a}</li>`).join('') + `</ul>`,
        icon: 'info', confirmButtonColor: 'var(--action)'
      });
    } else {
      this.mostrarToast(' ✅ ¡Tareas creadas y avisos generados!');
    }
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
          ...itemOriginal, requiresPhoto: item.requiresPhoto, requiresAntesDespues: item.requiresAntesDespues,
          requiresVariasFotos: item.requiresVariasFotos || false, permiteGaleria: item.permiteGaleria || false,
          permiteDocumentos: item.permiteDocumentos || false, tiempoEstimado: item.tiempoEstimado,
          archivoInstruccion: item.archivoInstruccion || itemOriginal.archivoInstruccion || null,
          nombreArchivo: item.nombreArchivo || itemOriginal.nombreArchivo || null,
          fechaInicio: item.fechaInicio || itemOriginal.fechaInicio || null,
          horaInicio:  item.horaInicio  || itemOriginal.horaInicio  || null,
          fechaLimite: item.fechaLimite || itemOriginal.fechaLimite || null,
          horaLimite:  item.horaLimite  || itemOriginal.horaLimite  || null
        };
      }
      return {
        id: Date.now() + i, text: item.text, requiresPhoto: item.requiresPhoto,
        requiresVariasFotos: (item as any).requiresVariasFotos || false,
        permiteGaleria: (item as any).permiteGaleria || false,
        permiteDocumentos: (item as any).permiteDocumentos || false,
        tiempoEstimado: item.requiresAntesDespues ? (item.tiempoEstimado || 30) : null,
        archivoInstruccion: (item as any).archivoInstruccion || null,
        nombreArchivo: (item as any).nombreArchivo || null,
        fechaInicio: item.fechaInicio || null,
        horaInicio:  item.horaInicio  || null,
        fechaLimite: item.fechaLimite || null,
        horaLimite:  item.horaLimite  || null,
        date: item.fechaLimite || actual.date,
        time: item.horaLimite  || actual.time || '23:59',
        checked: false,
        photo: null, photoTime: null, photoAntes: null, photoAntesTime: null, photoAntesTimestamp: null, photoDespues: null, photoDespuesTime: null, tipo: 'tarea'
      };
    });
    if (tareasValidas.length === 0) { alert('Agrega tareas.'); return; }

    try {
      const cambiosEdit = {
        name: this.formName, assigned: this.formAssigned[0], store: this.formStore,
        items: tareasValidas,
        subtareas: this.fasesTemporales
      };
      await setDoc(doc(this.firestore, 'checklists', actual.id.toString()), cambiosEdit, { merge: true });
      await this.api.patchChecklist(actual.id.toString(), cambiosEdit);

      this.mostrarToast(' ✏️ ¡Tarea actualizada con éxito!');
      actual.name = this.formName; actual.assigned = this.formAssigned[0]; actual.store = this.formStore;
      actual.items = tareasValidas;
      actual.subtareas = this.fasesTemporales;
      this.cerrarModal();
    } catch (error) { alert('Error al actualizar la tarea.'); }
  }

  toggleEmpleadoRutina(nombre: string) {
    const index = this.formAssignedRutina.indexOf(nombre);
    if (index > -1) this.formAssignedRutina.splice(index, 1);
    else this.formAssignedRutina.push(nombre);
  }

  asignarATodoMiPersonal() {
    const todosMisEmpleados = this.empleados().map(emp => emp.nombre);
    this.formAssigned = [...todosMisEmpleados];
    this.mostrarToast(` 🚀 ¡Fuego! Asignado a todo el personal.`);
  }

  abrirModalRutinas() {
    this.isEditMode = false;
    this.formNameRutinaOriginal = '';
    this.formAssignedRutinaOriginal = '';
    this.formNameRutina = '';
    this.formAssignedRutina = [];
    this.formStoreRutina = this.sucursalesDisponibles().length > 0 ? this.sucursalesDisponibles()[0] : '';
    // 📅 fechaInicio por defecto = hoy
    const hoyStr = this.hoyIsoStr;
    this.formRutinas = [{
      text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false,
      permiteGaleria: false, permiteDocumentos: false, tiempoEstimado: 60,
      frecuencia: 'Diaria', fechaInicio: hoyStr, fechaFin: null,
      horaInicio: '', horaLimite: '',
      diaSemana: 'Lunes', diaMes: 1
    }];
    // 🧙 Reset wizard de rutinas
    this.wizardStepRutina = 1;
    this.wizardTipoEvidenciaRutina = 'ninguna';
    this.terminoBusquedaEmpleadoWizardRutina = '';
    this.isModalRutinasOpen = true;
  }

  cerrarModalRutinas() { this.isModalRutinasOpen = false; }

  /**
   * ¿Se está pintando el panel de responsables (el tablero por persona)?
   *
   * Sirve para no duplicar controles: cuando el panel está en pantalla, él trae
   * sus propios botones de alta con el diseño nuevo, así que los de la barra de
   * arriba se esconden. El trabajador nunca ve el panel, así que a él no se le
   * quita nada.
   */
  get mostrandoPanelResponsables(): boolean {
    // ⚠ `!verPorOrganigrama` FALTABA, y con una sola pantalla eso esconde los
    //   botones de crear a quien más los usa.
    //
    //   Este getter decía «el panel está en pantalla» sin mirar si lo que está
    //   es el ÁRBOL, que ocupa su sitio y tiene su propio `*ngIf` con
    //   `!verPorOrganigrama`. Mientras fueron dos pantallas no se notaba: en
    //   /checklist el árbol nunca salía —así que el getter acertaba— y en
    //   /tareas-manual los botones de alta ya estaban escondidos por el modo.
    //
    //   Con las dos listas unidas, una jefatura aterriza en «Pendientes del
    //   equipo», donde se pinta el árbol: el panel NO está, pero el getter
    //   decía que sí y se llevaba por delante «Tareas Únicas», «Bloque de
    //   Rutinas» y «Del manual». O sea, ninguna de las personas que crean
    //   tareas podía crear una. Lo destapó la prueba del catálogo al no
    //   encontrar su botón.
    return !this.verPorOrganigrama
      && this.vistaEquipo() === 'lista'
      && this.vistaHistorial() === 'pendientes'
      // Antes era `agruparPorPersona()`. Con tres modos, el panel manda en DOS
      // de ellos —por sucursal y por persona— y solo cede el sitio en 'plana'.
      && this.agrupacionLista() !== 'plana'
      && this.puedeFiltrarVista
      && this.vistaTareas === 'equipo';
  }

  // ── Puentes para el panel de responsables ─────────────────────────────────
  // El panel no conoce los modales de esta pantalla: solo avisa qué se pidió.
  // Aquí se traduce a los flujos de alta que ya existían.
  /** Abre el alta que corresponda al tipo pedido desde el panel. */
  altaDesdePanel(tipo: 'unica' | 'rutina' | 'equipo') {
    if (tipo === 'rutina') { this.abrirModalRutinas(); return; }
    if (tipo === 'equipo') { this.abrirModalEquipo(); return; }
    this.abrirModal();
  }

  /** editar/eliminarChecklist esperan un evento del DOM (hacen stopPropagation).
   *  El panel ya detuvo la propagación por su cuenta, así que le pasamos un
   *  evento inerte en vez de null, que reventaría en la primera línea. */
  private eventoInerte(): Event {
    return { stopPropagation() { }, preventDefault() { } } as unknown as Event;
  }

  editarDesdePanel(checklist: any) { this.editarChecklist(checklist, this.eventoInerte()); }
  eliminarDesdePanel(checklist: any) { this.eliminarChecklist(checklist, this.eventoInerte()); }

  agregarRutina() {
    this.formRutinas.push({
      text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false,
      permiteGaleria: false, permiteDocumentos: false, tiempoEstimado: 60,
      frecuencia: 'Diaria', fechaFin: null,
      horaInicio: '', horaLimite: '',
      diaSemana: 'Lunes', diaMes: 1
    });
  }

  eliminarRutina(index: number) { this.formRutinas.splice(index, 1); }

  async guardarBloqueRutinas() {
    if (!this.formNameRutina || this.formAssignedRutina.length === 0) { alert('Faltan datos.'); return; }
    const rutinasValidas = this.formRutinas.filter(rutina => rutina.text.trim() !== '').map((rutina, i) => ({
      id: Date.now() + 1000 + i,
    
      text: rutina.text,
      requiresPhoto: rutina.requiresPhoto,
      requiresAntesDespues: rutina.requiresAntesDespues || false,
      requiresVariasFotos: rutina.requiresVariasFotos || false,
      permiteGaleria: rutina.permiteGaleria || false,
      permiteDocumentos: rutina.permiteDocumentos || false,
      tiempoEstimado: rutina.requiresAntesDespues ? (rutina.tiempoEstimado || 30) : null,
      archivoInstruccion: rutina.archivoInstruccion || null,
      nombreArchivo: rutina.nombreArchivo || null,
      checked: false, photo: null, photoTime: null, photoAntes: null, photoAntesTime: null, photoAntesTimestamp: null, photoDespues: null, photoDespuesTime: null,
      tipo: 'rutina',
      frecuencia: rutina.frecuencia,
      fechaInicio: rutina.fechaInicio || null,
      fechaFin: rutina.fechaFin || null,
      horaInicio: rutina.horaInicio || null,
      horaLimite: rutina.horaLimite || null,
      diaSemana: rutina.diaSemana || 'Lunes',
      diaMes: rutina.diaMes || 1
    }));
    if (rutinasValidas.length === 0) { alert('Agrega rutinas.'); return; }
    if (this.isEditMode) {
      // 🔄 Edición libre: el admin pudo cambiar nombre, sucursal o asignados.
      // Borramos el molde VIEJO usando el nombre+assigned ORIGINAL (no el nuevo),
      // y también soft-delete los checklists ya generados del original para que
      // no queden duplicados con datos obsoletos.
      const nombreViejo = this.formNameRutinaOriginal || this.formNameRutina;
      const assignedViejo = this.formAssignedRutinaOriginal || this.formAssignedRutina[0];

      // FERROCARRIL Etapa 5: moldes desde Postgres + dual-write del borrado.
      const moldesRespRen = await this.api.get('/api/moldes-checklists');
      for (const mData of (moldesRespRen?.items || [])) {
        if (mData.name === nombreViejo && mData.assigned === assignedViejo) {
          await deleteDoc(doc(this.firestore, 'moldes_checklists', String(mData.id)));
          await this.api.borrar('/api/moldes-checklists', mData.id);
        }
      }
      const chkRespRename = await this.api.get('/api/checklists');
      const chkFilasRename: any[] = chkRespRename?.checklists || [];
      for (const cData of chkFilasRename) {
        if ((cData.name || '').startsWith(nombreViejo) && cData.assigned === assignedViejo && !cData.enviado) {
          await setDoc(doc(this.firestore, 'checklists', String(cData.id)), { eliminado: true }, { merge: true });
          await this.api.patchChecklist(String(cData.id), { eliminado: true });
        }
      }
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
        if (frecuenciaReal === 'Semanal' || frecuenciaReal === 'Catorcenal') diaSemanaReal = partesGrupo.length > 1 ? partesGrupo[1] : 'Lunes';
        else if (frecuenciaReal === 'Mensual' || frecuenciaReal === 'Trimestral') diaMesReal = partesGrupo.length > 1 ? parseInt(partesGrupo[1], 10) : 1;
        const nombreMoldeLimpio = this.formNameRutina.replace(/\s+/g, '_').toLowerCase();
        const empleadoLimpio = empleadoNombre.replace(/\s+/g, '_').toLowerCase();
        const moldeId = `molde_${nombreMoldeLimpio}_${empleadoLimpio}_${llaveGrupo}`;
        const nuevoMolde = {
          id: moldeId, name: this.formNameRutina, assigned: empleadoNombre, store: this.formStoreRutina,
          frecuencia: frecuenciaReal, diaSemana: diaSemanaReal, diaMes: diaMesReal, timestampCreacion: Date.now(),
          createdBy: this.currentUser?.nombre || 'Desconocido',
          items: JSON.parse(JSON.stringify(rutinasPorFrecuencia[llaveGrupo]))
        };
        setDoc(doc(this.firestore, 'moldes_checklists', moldeId), nuevoMolde);
        this.api.guardar('/api/moldes-checklists', nuevoMolde); // FERROCARRIL Etapa 5
      });
    });
    this.mostrarToast(this.isEditMode ? ' 🔄 ¡Bloque actualizado!' : ' 🔄 ¡Bloque guardado!');
    this.cerrarModalRutinas();
  }

  formatearHora(hora24: string): string {
    if (!hora24) return ''; const partes = hora24.split(':'); if (partes.length !== 2) return hora24;
    let horas = parseInt(partes[0], 10); const ampm = horas >= 12 ? 'PM' : 'AM';
    horas = horas % 12; horas = horas ? horas : 12;
    const horasStr = horas < 10 ? '0' + horas : horas.toString();
    return `${horasStr}:${partes[1]} ${ampm}`;
  }

  limpiarEmojis(texto: string): string {
    if (!texto) return '';
    return texto.replace(/([✀-➿]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDD10-\uDDFF])/g, '').trim();
  }

  esImagen(url: string): boolean {
    if (!url) return false;
    const urlLower = url.toLowerCase();
    if (urlLower.includes('/raw/upload/') || urlLower.match(/\.(pdf|xls|xlsx|doc|docx|csv|txt|zip|rar)$/)) return false;
    return true;
  }

  agregarFase() {
    if (!this.nuevaFaseTexto.trim()) return;
    this.fasesTemporales.push({ texto: this.nuevaFaseTexto, completada: false });
    this.nuevaFaseTexto = '';
  }

  eliminarFase(index: number) { this.fasesTemporales.splice(index, 1); }
  toggleFase(index: number) { this.fasesTemporales[index].completada = !this.fasesTemporales[index].completada; }
  toggleFaseEnPantallaDetalle(index: number, checklist: any) {
    if (!checklist.subtareas) return;
    checklist.subtareas[index].completada = !checklist.subtareas[index].completada;
    this.guardarEnLaNube(checklist);
  }

  agregarIntegranteEquipo() {
    if (!this.empleadoSeleccionadoEquipo) return;
    const existe = this.integrantesEquipo.find(i => i.nombre === this.empleadoSeleccionadoEquipo);
    if (existe) {
      this.mostrarToast('⚠️ Este empleado ya está en la lista.');
      return;
    }
    const empData = this.empleados().find(e => e.nombre === this.empleadoSeleccionadoEquipo);
    this.integrantesEquipo.push({
      nombre: this.empleadoSeleccionadoEquipo,
      departamento: empData?.sucursal || empData?.sucursales?.[0] || 'General',
      iniciales: this.empleadoSeleccionadoEquipo.substring(0, 2).toUpperCase(),
      fases: []
    });
    this.empleadoSeleccionadoEquipo = '';
    this.busquedaEmpleadoEquipo = '';
  }

  eliminarIntegranteEquipo(index: number) { this.integrantesEquipo.splice(index, 1); }

  get empleadosEquipoFiltrados() {
    if (!this.busquedaEmpleadoEquipo) return this.empleados();
    const termino = this.busquedaEmpleadoEquipo.toLowerCase();
    return this.empleados().filter((emp: any) => emp.nombre.toLowerCase().includes(termino));
  }

  seleccionarEmpleadoEquipo(emp: any) {
    this.empleadoSeleccionadoEquipo = emp.nombre;
    this.busquedaEmpleadoEquipo = emp.nombre;
    this.mostrarDropdownEquipo = false;
  }

  ocultarDropdownEquipo() {
    setTimeout(() => { this.mostrarDropdownEquipo = false; }, 200);
  }

  abrirActividadIntegrante(index: number) {
    this.integranteActualIndex = index;
    const integrante = this.integrantesEquipo[index];
    if (integrante.fases && integrante.fases.length > 0) {
      this.formItemsActividad = JSON.parse(JSON.stringify(integrante.fases));
    } else {
      this.formItemsActividad = [{ text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false, permiteGaleria: false, permiteDocumentos: false, fechaInicio: '', horaInicio: '', fechaLimite: '', horaLimite: '' }];
    }
    if (integrante.listaFases && integrante.listaFases.length > 0) {
      this.fasesTemporalesIntegrante = JSON.parse(JSON.stringify(integrante.listaFases));
    } else {
      this.fasesTemporalesIntegrante = [];
    }
    this.isModalActividadIntegranteOpen = true;
  }

  guardarActividadesIntegrante() {
    if (this.integranteActualIndex > -1) {
      this.integrantesEquipo[this.integranteActualIndex].fases = [...this.formItemsActividad];
      this.integrantesEquipo[this.integranteActualIndex].listaFases = [...this.fasesTemporalesIntegrante];
      this.mostrarToast('✅ Tareas asignadas');
      this.cerrarModalActividadIntegrante();
    }
  }

  cerrarModalActividadIntegrante() {
    this.isModalActividadIntegranteOpen = false;
    this.integranteActualIndex = -1;
  }

  agregarActividadIntegrante() {
    this.formItemsActividad.push({ text: '', requiresPhoto: false, requiresAntesDespues: false, requiresVariasFotos: false, permiteGaleria: false, permiteDocumentos: false, fechaInicio: '', horaInicio: '', fechaLimite: '', horaLimite: '' });
  }

  eliminarActividadIntegrante(index: number) {
    this.formItemsActividad.splice(index, 1);
  }

  agregarFaseIntegrante() {
    if (this.nuevaFaseIntegranteTexto.trim()) {
      this.fasesTemporalesIntegrante.push({ texto: this.nuevaFaseIntegranteTexto.trim(), completada: false });
      this.nuevaFaseIntegranteTexto = '';
    }
  }

  eliminarFaseIntegrante(index: number) {
    this.fasesTemporalesIntegrante.splice(index, 1);
  }
}