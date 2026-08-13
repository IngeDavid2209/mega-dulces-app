import { Component, signal, computed, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import Swal from 'sweetalert2';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { ApiService } from '../../../shared/api.service';
import { UsuariosService } from '../../../shared/usuarios.service';

/**
 * MODULO PAGOS DE SERVICIOS — luz, agua, internet, gas, renta... por sucursal.
 *
 * Resuelve dos problemas de una vez:
 *   1) Los recibos se vencen porque nadie se acuerda. El bot de WhatsApp le
 *      recuerda al responsable unos dias antes, el dia del vencimiento y todos
 *      los dias mientras no llegue el comprobante.
 *   2) El comprobante se queda en el celular de quien fue a pagar. Ahora se
 *      manda por el mismo chat (foto o PDF) y queda guardado en el pago.
 *
 * Aqui NO se crean los pagos a mano: se da de alta el SERVICIO una vez (con su
 * dia limite y su periodicidad) y el backend genera solo el de cada periodo
 * (api/pagos-notificar.js). Esta pantalla es para verlos, corregirlos y
 * registrar los que se pagaron sin pasar por WhatsApp.
 *
 * Vistas:
 *   - Tablero:   semaforo por sucursal + lo que urge.
 *   - Pagos:     lista filtrable con su comprobante.
 *   - Servicios: alta/baja del catalogo (lo que dispara todo lo demas).
 */
type Vista = 'tablero' | 'pagos' | 'servicios';

const TIPOS = [
  { valor: 'luz', nombre: 'Luz' },
  { valor: 'agua', nombre: 'Agua' },
  { valor: 'internet', nombre: 'Internet' },
  { valor: 'gas', nombre: 'Gas' },
  { valor: 'telefono', nombre: 'Teléfono' },
  { valor: 'renta', nombre: 'Renta' },
  { valor: 'otro', nombre: 'Otro' },
];

@Component({
  selector: 'app-pagos-servicios',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
  templateUrl: './pagos-servicios.html',
  styleUrls: ['./pagos-servicios.css'],
})
export class PagosServiciosComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private usuariosSvc = inject(UsuariosService);

  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

  currentUser: any = null;
  vista = signal<Vista>('tablero');

  servicios = signal<any[]>([]);
  pagos = signal<any[]>([]);
  resumen = signal<any[]>([]);
  cargando = signal<boolean>(true);
  private timer: any = null;

  tipos = TIPOS;

  // Filtros de la vista de pagos.
  // Son SIGNALS a proposito: los lee un computed, y un computed no se entera de
  // los cambios de una propiedad normal. Si fueran campos sueltos, mover un
  // filtro no repintaria la tabla hasta el refresco de 30 s.
  filtroSucursal = signal('');
  filtroEstado = signal('');
  filtroTipo = signal('');

  // Formulario del catalogo de servicios
  modalServicio = false;
  guardando = false;
  form: any = this.formVacio();

  get esAdmin(): boolean { return this.currentUser?.rol === 'admin'; }

  // --- Derivados -------------------------------------------------------------

  /** Sucursales presentes en el catalogo (para los filtros). */
  sucursales = computed<string[]>(() => {
    const set = new Set<string>();
    for (const s of this.servicios()) {
      const d = s.sucursal || s.departamento;
      if (d) set.add(d);
    }
    return Array.from(set).sort();
  });

  /** Personal con teléfono: son los únicos que pueden recibir el recordatorio. */
  responsablesPosibles = computed<any[]>(() =>
    this.usuariosSvc.usuarios()
      .filter(u => u.activo !== false && String(u.telefono || '').replace(/\D/g, '').length >= 10)
      .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''))));

  // --- Buscador de responsable ---------------------------------------------
  // Son más de cien personas: una lista desplegable obliga a recorrerla a mano.
  // Aquí se escribe el nombre (o el teléfono) y la lista se va acortando.
  busquedaResponsable = signal('');
  listaResponsablesAbierta = false;

  /** Quita acentos y mayúsculas para que "estefania" encuentre a "Estefanía". */
  private normalizar(t: any): string {
    return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  responsablesFiltrados = computed<any[]>(() => {
    const q = this.normalizar(this.busquedaResponsable());
    const lista = this.responsablesPosibles();
    if (!q) return lista;
    // Se busca por nombre y por teléfono (solo dígitos), porque a veces se
    // acuerdan del número y no del nombre completo.
    const soloDigitos = q.replace(/\D/g, '');
    return lista.filter(u =>
      this.normalizar(u.nombre).includes(q) ||
      (soloDigitos.length >= 3 && String(u.telefono || '').replace(/\D/g, '').includes(soloDigitos)));
  });

  /**
   * Explica en palabras qué va a hacer el bot con lo que se acaba de capturar.
   *
   * Se arma en vivo porque "avisar 3 días antes" es ambiguo: no es UN aviso tres
   * días antes, es uno CADA DÍA de esos tres, más el día del vencimiento. Dicho
   * con los números que la persona ya escribió, no hay que adivinarlo.
   */
  explicacionAvisos(): string {
    const dia = Number(this.form.diaLimite);
    const antes = Number(this.form.diasAviso);
    const hora = String(this.form.horaAviso || '').trim();
    if (!Number.isFinite(dia) || dia < 1) return '';

    const aLas = hora ? ` a las ${hora}` : '';
    if (!Number.isFinite(antes) || antes <= 0) {
      return `Se le avisará el día ${dia}${aLas}, y después una vez al día mientras no llegue el comprobante.`;
    }

    // Los días de la cuenta regresiva. Si la cuenta se sale del mes no se
    // inventan números (no todos los meses tienen los mismos días): se dice en
    // palabras, que para explicar es igual de claro y no puede quedar mal.
    if (dia - antes < 1) {
      return `Se le avisará cada día durante los ${antes} días previos al ${dia}${aLas} `
        + '(los primeros caen en el mes anterior), y si no manda el comprobante '
        + 'se le sigue recordando a diario después del vencimiento.';
    }
    const dias: string[] = [];
    for (let i = antes; i >= 0; i--) dias.push(String(dia - i));
    const lista = dias.slice(0, -1).join(', ') + ' y ' + dias[dias.length - 1];
    return `Se le avisará los días ${lista}${aLas} (uno cada día), y si no manda el comprobante `
      + 'se le sigue recordando a diario después del vencimiento.';
  }

  /** Elegir a alguien de la lista (o `null` para dejar el servicio sin responsable). */
  elegirResponsable(u: any | null) {
    if (!u) {
      this.form.responsableUid = '';
      this.form.responsableNombre = '';
      this.form.responsableTelefono = '';
      this.busquedaResponsable.set('');
    } else {
      this.form.responsableUid = u.id || u.uid || '';
      this.form.responsableNombre = u.nombre || '';
      // El teléfono se guarda normalizado a 10 dígitos: en el directorio los hay
      // con lada 52, con espacios y con guiones, y el bot compara los últimos 10.
      this.form.responsableTelefono = String(u.telefono || '').replace(/\D/g, '').slice(-10);
      this.busquedaResponsable.set(u.nombre || '');
    }
    this.listaResponsablesAbierta = false;
  }

  /** Se cierra la lista al salir del campo; el `mousedown` de la opción ya corrió. */
  cerrarListaResponsables() {
    this.listaResponsablesAbierta = false;
    // Si quedó texto escrito que no corresponde a nadie elegido, se limpia para
    // no dejar en pantalla un nombre que en realidad no se guardó.
    if (!this.form.responsableUid) this.busquedaResponsable.set('');
    else this.busquedaResponsable.set(this.form.responsableNombre || '');
  }

  pagosFiltrados = computed(() => {
    const suc = this.filtroSucursal(), est = this.filtroEstado(), tipo = this.filtroTipo();
    return this.pagos().filter(p =>
      (!suc || p.sucursal === suc) &&
      (!est || p.estadoVisible === est) &&
      (!tipo || p.tipo === tipo));
  });

  /** Lo que urge: vencidos primero, luego lo que vence pronto. */
  urgentes = computed(() =>
    this.pagos()
      .filter(p => p.estadoVisible === 'vencido' || p.estadoVisible === 'por_vencer')
      .sort((a, b) => (a.diasFaltantes ?? 999) - (b.diasFaltantes ?? 999))
      .slice(0, 12));

  totalVencidos = computed(() => this.pagos().filter(p => p.estadoVisible === 'vencido').length);
  totalPorVencer = computed(() => this.pagos().filter(p => p.estadoVisible === 'por_vencer').length);
  totalPagados = computed(() => this.pagos().filter(p => p.estadoVisible === 'pagado').length);

  /** Servicios sin responsable o sin teléfono: el bot no les puede avisar. */
  serviciosMudos = computed(() =>
    this.servicios().filter(s => s.activo !== false && !s.responsableTelefono));

  /**
   * Pagos cuyo último recordatorio NO se pudo entregar.
   *
   * Es una distinción que importa: "ya le avisé y no ha pagado" y "no tengo
   * forma de avisarle" se ven igual en el tablero si no se dice. Mientras la
   * cuenta de WhatsApp no pueda escribir en frío, el aviso solo llega a quien
   * tenga conversación abierta con el bot.
   */
  sinAvisar = computed(() =>
    this.pagos().filter(p =>
      p.estadoVisible !== 'pagado' && p.estadoVisible !== 'cancelado' &&
      String(p.avisoMotivo || '').startsWith('fallo:')));

  /** Traduce el motivo técnico del fallo a algo que se entienda. */
  motivoAviso(p: any): string {
    const m = String(p?.avisoMotivo || '');
    if (m.startsWith('fallo:cuenta_bloqueada')) return 'La cuenta de WhatsApp no puede escribir en frío (falta método de pago en Meta).';
    if (m.startsWith('fallo:sin_plantilla_ni_ventana')) return 'No tiene conversación abierta con el bot y no hay plantilla aprobada.';
    if (m.startsWith('fallo:sin_telefono') || m === 'sin_telefono') return 'El responsable no tiene teléfono registrado.';
    if (m.startsWith('fallo:')) return 'No se pudo entregar el recordatorio (' + m.slice(6) + ').';
    return '';
  }

  // --- Ciclo de vida ---------------------------------------------------------

  async ngOnInit() {
    try { this.currentUser = JSON.parse(localStorage.getItem('md_sesion_actual') || 'null'); }
    catch { this.currentUser = null; }
    this.usuariosSvc.iniciar();
    await this.cargarTodo();
    // Refresco ligero: los comprobantes entran por WhatsApp, así que el tablero
    // tiene que moverse solo mientras alguien lo tiene abierto.
    this.timer = setInterval(() => this.cargarPagos(), 30000);
  }

  ngOnDestroy() {
    this.usuariosSvc.detener();
    if (this.timer) clearInterval(this.timer);
  }

  async cargarTodo() {
    this.cargando.set(true);
    await Promise.all([this.cargarServicios(), this.cargarPagos()]);
    this.cargando.set(false);
  }

  async cargarServicios() {
    try {
      const r = await this.api.get('/api/servicios');
      this.servicios.set(r.servicios || []);
    } catch (e: any) {
      console.error('[pagos] servicios:', e);
      this.avisoError(e, 'No pude cargar el catálogo de servicios.');
    }
  }

  async cargarPagos() {
    try {
      const r = await this.api.get('/api/pagos-servicios?resumen=1');
      this.pagos.set(r.pagos || []);
      this.resumen.set(r.resumen || []);
    } catch (e: any) {
      console.error('[pagos] pagos:', e);
      this.avisoError(e, 'No pude cargar los pagos.');
    }
  }

  /** Un solo lugar para explicar por qué falló algo (sin culpar al wifi de más). */
  private avisoError(e: any, encabezado: string) {
    const sinRed = e?.sinRed === true;
    Swal.fire({
      icon: sinRed ? 'warning' : 'error',
      title: sinRed ? 'Sin conexión' : 'Ups',
      text: sinRed
        ? `${encabezado} Revisa tu conexión e inténtalo de nuevo.`
        : `${encabezado} ${e?.message || ''}`.trim(),
    });
  }

  // --- Catalogo de servicios -------------------------------------------------

  formVacio() {
    return {
      id: '', sucursal: '', departamento: '', tipo: 'luz', proveedor: '', referencia: '',
      periodicidad: 'mensual', mesAncla: '', diaLimite: 15, diasAviso: 3,
      horaAviso: '09:00',
      montoEstimado: null as number | null,
      responsableUid: '', responsableNombre: '', responsableTelefono: '',
      activo: true, notas: '',
    };
  }

  abrirNuevoServicio() {
    this.form = this.formVacio();
    this.busquedaResponsable.set('');
    this.listaResponsablesAbierta = false;
    this.modalServicio = true;
  }

  editarServicio(s: any) {
    this.form = {
      id: s.id,
      sucursal: s.sucursal || '',
      departamento: s.departamento || '',
      tipo: s.tipo || 'luz',
      proveedor: s.proveedor || '',
      referencia: s.referencia || '',
      periodicidad: s.periodicidad || 'mensual',
      mesAncla: s.mesAncla || '',
      diaLimite: s.diaLimite ?? 15,
      diasAviso: s.diasAviso ?? 3,
      horaAviso: s.horaAviso || '09:00',
      montoEstimado: s.montoEstimado ?? null,
      responsableUid: s.responsableUid || '',
      responsableNombre: s.responsableNombre || '',
      responsableTelefono: s.responsableTelefono || '',
      activo: s.activo !== false,
      notas: s.notas || '',
    };
    // El buscador arranca mostrando a quien ya estaba puesto.
    this.busquedaResponsable.set(s.responsableNombre || '');
    this.listaResponsablesAbierta = false;
    this.modalServicio = true;
  }

  async guardarServicio() {
    if (this.guardando) return;

    // Validación en el navegador para dar el aviso pegado al campo. El servidor
    // vuelve a validar lo mismo (api/servicios.js): esto es comodidad, no
    // seguridad.
    if (!this.form.sucursal.trim() && !this.form.departamento.trim()) {
      Swal.fire({ icon: 'warning', title: 'Falta algo', text: 'Dinos de qué sucursal o departamento es el servicio.' });
      return;
    }
    const dia = Number(this.form.diaLimite);
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
      Swal.fire({ icon: 'warning', title: 'Día límite', text: 'El día debe ser un número del 1 al 31. Si el mes no tiene ese día, se cobra el último.' });
      return;
    }
    if (this.form.periodicidad === 'bimestral' && !/^\d{4}-\d{2}$/.test(this.form.mesAncla || '')) {
      Swal.fire({ icon: 'warning', title: 'Mes de referencia', text: 'En un servicio bimestral dinos un mes en el que sí toca pagar (AAAA-MM), para saber en cuáles caen los recibos.' });
      return;
    }
    if (!this.form.responsableTelefono) {
      const r = await Swal.fire({
        icon: 'warning', title: 'Sin responsable',
        text: 'Este servicio no tiene a quién avisarle por WhatsApp. Se puede guardar, pero nadie va a recibir el recordatorio.',
        showCancelButton: true, confirmButtonText: 'Guardar así', cancelButtonText: 'Volver',
      });
      if (!r.isConfirmed) return;
    }

    this.guardando = true;
    try {
      await this.api.post('/api/servicios', { ...this.form, id: this.form.id || undefined });
      this.modalServicio = false;
      await this.cargarTodo();
      Swal.fire({
        icon: 'success', title: 'Guardado',
        text: 'El servicio quedó registrado. Los recordatorios empiezan solos según su día límite.',
        timer: 2600, showConfirmButton: false,
      });
    } catch (e: any) {
      this.avisoError(e, 'No se pudo guardar el servicio.');
    } finally {
      this.guardando = false;
    }
  }

  async borrarServicio(s: any) {
    const r = await Swal.fire({
      icon: 'warning', title: '¿Dar de baja este servicio?',
      html: `Se dejará de recordar <b>${this.nombreServicio(s)}</b>.<br><br>`
        + 'Los pagos ya registrados y sus comprobantes se conservan; solo se cancelan los que seguían pendientes.',
      showCancelButton: true, confirmButtonText: 'Dar de baja', cancelButtonText: 'Cancelar',
      confirmButtonColor: '#DC2626',
    });
    if (!r.isConfirmed) return;
    try {
      await this.api.del('/api/servicios?id=' + encodeURIComponent(s.id));
      await this.cargarTodo();
    } catch (e: any) {
      this.avisoError(e, 'No se pudo dar de baja el servicio.');
    }
  }

  // --- Pagos -----------------------------------------------------------------

  /**
   * Registro manual de un pago (el que se hizo sin pasar por WhatsApp).
   * Pide el comprobante a fuerza: es justo el descuido que este módulo viene a
   * resolver, y el backend lo rechaza igual si llega sin él.
   */
  async registrarPago(p: any) {
    // El modal se monta fuera del componente, así que el CSS de esta pantalla no
    // le llega: los campos se estilan aquí para que se vean iguales entre sí y
    // para que el signo de pesos quede pegado al monto.
    const campo = 'width:100%;box-sizing:border-box;border:1px solid #E2E8F0;border-radius:9px;'
      + 'padding:10px 12px;font-size:15px;background:#fff;color:#0F172A';
    const etiqueta = 'display:block;text-align:left;font-size:12.5px;font-weight:600;color:#334155;margin:14px 0 5px';

    const { value: datos } = await Swal.fire({
      title: 'Registrar pago',
      html:
        `<p style="font-size:13px;color:#64748B;margin:0 0 4px">${this.nombreServicio(p)} — ${p.periodoTexto || ''}</p>`
        + `<label style="${etiqueta}">Monto pagado</label>`
        + '<div style="display:flex;align-items:center;gap:8px">'
        + '<span style="font-size:17px;font-weight:700;color:#475569">$</span>'
        + `<input id="sw-monto" type="number" step="0.01" min="0" placeholder="0.00" style="${campo}">`
        + '</div>'
        + `<label style="${etiqueta}">¿Cómo se pagó?</label>`
        + `<select id="sw-forma" style="${campo}">`
        + '<option value="">Selecciona una opción</option>'
        + '<option value="efectivo">Efectivo</option>'
        + '<option value="tarjeta">Tarjeta</option>'
        + '<option value="transferencia">Transferencia</option>'
        + '</select>'
        + `<label style="${etiqueta}">Liga del comprobante</label>`
        + `<input id="sw-url" placeholder="https://..." style="${campo}">`
        + '<p style="font-size:12px;color:#94A3B8;margin:10px 2px 0;text-align:left">'
        + 'Si el comprobante llega por WhatsApp se guarda solo. Aquí se pega la liga cuando ya está subido en otro lado.</p>',
      showCancelButton: true, confirmButtonText: 'Registrar', cancelButtonText: 'Cancelar',
      focusConfirm: false,
      preConfirm: () => {
        const monto = (document.getElementById('sw-monto') as HTMLInputElement)?.value;
        const formaPago = (document.getElementById('sw-forma') as HTMLSelectElement)?.value;
        const comprobanteUrl = (document.getElementById('sw-url') as HTMLInputElement)?.value?.trim();
        if (!comprobanteUrl) {
          Swal.showValidationMessage('Hace falta el comprobante para marcarlo como pagado.');
          return false;
        }
        return { monto: monto === '' ? null : Number(monto), formaPago: formaPago || null, comprobanteUrl };
      },
    });
    if (!datos) return;

    try {
      await this.api.post('/api/pagos-servicios', {
        id: p.id, estado: 'pagado',
        monto: datos.monto, formaPago: datos.formaPago,
        comprobanteUrl: datos.comprobanteUrl, comprobanteTipo: 'documento',
      });
      await this.cargarPagos();
    } catch (e: any) {
      this.avisoError(e, 'No se pudo registrar el pago.');
    }
  }

  /** Reabre un pago marcado por error (queda pendiente y el bot vuelve a avisar). */
  async reabrirPago(p: any) {
    const r = await Swal.fire({
      icon: 'question', title: '¿Marcar como pendiente?',
      text: 'El pago volverá a aparecer como no pagado y el bot retomará los recordatorios.',
      showCancelButton: true, confirmButtonText: 'Sí, reabrir', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;
    try {
      await this.api.post('/api/pagos-servicios', { id: p.id, estado: 'pendiente' });
      await this.cargarPagos();
    } catch (e: any) {
      this.avisoError(e, 'No se pudo reabrir el pago.');
    }
  }

  /**
   * "Avisar" — manda el recordatorio de ese pago en el momento.
   *
   * Si el bot no lo puede entregar (hoy es lo normal: la cuenta de WhatsApp no
   * puede iniciar conversación y solo llega a quien escribió en las últimas 24 h),
   * NO se queda en un "no se pudo": se ofrece abrir WhatsApp con el mensaje ya
   * escrito para mandarlo desde el teléfono de quien está usando la app. Eso
   * funciona siempre, porque no pasa por la API bloqueada.
   */
  avisando: string | null = null;
  async avisar(p: any) {
    if (this.avisando) return;
    this.avisando = p.id;
    let r: any = null;
    try {
      r = await this.api.post('/api/pagos-servicios', { id: p.id, accion: 'avisar' });
    } catch (e: any) {
      this.avisoError(e, 'No se pudo mandar el recordatorio.');
      this.avisando = null;
      return;
    }
    this.avisando = null;
    await this.cargarPagos();

    if (r?.ok) {
      Swal.fire({
        icon: 'success', title: 'Recordatorio enviado',
        text: `Le llegó a ${r.nombre || 'el responsable'} por WhatsApp.`,
        timer: 2600, showConfirmButton: false,
      });
      return;
    }

    // No salió: se explica por qué y se ofrece la salida manual.
    const motivos: Record<string, string> = {
      sin_telefono: 'Este servicio no tiene un responsable con teléfono.',
      ya_pagado: 'Ese pago ya está registrado como pagado.',
      no_existe: 'No encontré ese pago.',
      avisos_apagados: 'Los avisos automáticos están apagados en el servidor.',
      sin_base: 'No hay conexión con la base de datos.',
      fallo_envio: 'WhatsApp rechazó el mensaje.',
      cuenta_bloqueada: 'La cuenta de WhatsApp del negocio no puede iniciar conversaciones (falta el método de pago en Meta).',
      sin_plantilla_ni_ventana: 'Esa persona no le ha escrito al bot en las últimas 24 horas, y la cuenta no puede iniciar la conversación.',
    };
    const porQue = motivos[r?.motivo] || 'No se pudo entregar el mensaje.';
    const puedeManual = !!(r?.telefono && r?.texto);

    const res = await Swal.fire({
      icon: 'warning',
      title: 'El bot no pudo mandarlo',
      html: `<p style="font-size:13.5px;color:#334155;margin:0 0 12px">${porQue}</p>`
        + (puedeManual
          ? '<p style="font-size:13px;color:#64748B;margin:0 0 10px">Mándalo tú desde tu WhatsApp: el mensaje ya va escrito.</p>'
            + `<pre style="text-align:left;white-space:pre-wrap;font-family:inherit;font-size:12.5px;`
            + `background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:10px;color:#334155;margin:0">`
            + String(r.texto).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' } as any)[c])
            + '</pre>'
          : ''),
      showCancelButton: true,
      confirmButtonText: puedeManual ? 'Abrir WhatsApp' : 'Entendido',
      cancelButtonText: 'Cerrar',
      // Verde de WhatsApp, para que el botón se lea como lo que hace.
      confirmButtonColor: puedeManual ? '#128C7E' : '#0F172A',
      cancelButtonColor: '#64748B',
    });

    if (res.isConfirmed && puedeManual) {
      // wa.me abre el chat con el texto listo. No depende de la API de Meta.
      const tel = String(r.telefono).replace(/\D/g, '');
      const numero = tel.length === 10 ? '52' + tel : tel;
      window.open(`https://wa.me/${numero}?text=${encodeURIComponent(r.texto)}`, '_blank', 'noopener');
    }
  }

  verComprobante(p: any) {
    if (!p.comprobanteUrl) return;
    window.open(p.comprobanteUrl, '_blank', 'noopener');
  }

  // --- Presentacion ----------------------------------------------------------

  nombreServicio(s: any): string {
    const tipo = TIPOS.find(t => t.valor === s.tipo)?.nombre || 'Servicio';
    const donde = s.sucursal || s.departamento || '';
    return donde ? `${tipo} de ${donde}` : tipo;
  }

  nombreTipo(tipo: string): string {
    return TIPOS.find(t => t.valor === tipo)?.nombre || 'Servicio';
  }

  /** Texto del semáforo: "atrasado 3 días", "vence hoy", "en 5 días". */
  textoVencimiento(p: any): string {
    if (p.estadoVisible === 'pagado') return 'Pagado';
    if (p.estadoVisible === 'cancelado') return 'Cancelado';
    const d = p.diasFaltantes;
    if (d == null) return '';
    if (d < 0) return `Atrasado ${Math.abs(d)} día${Math.abs(d) === 1 ? '' : 's'}`;
    if (d === 0) return 'Vence hoy';
    return `En ${d} día${d === 1 ? '' : 's'}`;
  }

  etiquetaEstado(estado: string): string {
    switch (estado) {
      case 'pagado': return 'Pagado';
      case 'vencido': return 'Vencido';
      case 'por_vencer': return 'Por vencer';
      case 'cancelado': return 'Cancelado';
      default: return 'Pendiente';
    }
  }

  pesos(n: any): string {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return '$' + v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  fechaCorta(f: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(f || ''));
    if (!m) return String(f || '');
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return `${Number(m[3])} ${meses[Number(m[2]) - 1]} ${m[1]}`;
  }
}
