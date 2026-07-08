import { Component, signal, computed, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Firestore, writeBatch, doc, serverTimestamp } from '@angular/fire/firestore';
import Swal from 'sweetalert2';

import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { esAdminGlobal, sucursalesPermitidas } from '../../../shared/permisos.util';
import { tieneEvidencia } from '../../../shared/item-completado.util';
import { ApiService } from '../../../shared/api.service';

interface ItemConFotos {
  texto: string;
  asignado: string;
  fotos: string[];          // urls de Cloudinary (originales)
  completado: boolean;
}

interface ChecklistResumen {
  id: string;
  name: string;
  assigned: string;
  date: string;
  enviado: boolean;
  itemsConFotos: ItemConFotos[];
  totalItems: number;
  itemsHechos: number;
  fotosTotales: number;
  notaEmpleado?: string;             // comentario libre del colaborador
  entregaConRetraso?: boolean;
  motivoCategoria?: string;          // ej. "Falla de equipo"
  motivoComentario?: string;
}

interface TopEmpleado {
  nombre: string;
  hechas: number;
  totales: number;
  porcentaje: number;
}

interface SucursalAgrupada {
  sucursal: string;
  checklists: ChecklistResumen[];
  totalChecklists: number;
  totalTareas: number;
  totalHechas: number;
  totalFotos: number;
  porcentaje: number;
  topEmpleados: TopEmpleado[];        // top 3
  tendenciaDiaria: number[];          // % por día del mes (índice 0 = día 1)
}

@Component({
  selector: 'app-cierre-mensual',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SidebarComponent],
  templateUrl: './cierre-mensual.html',
  styleUrls: ['./cierre-mensual.css']
})
export class CierreMensualComponent implements OnInit, OnDestroy {
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }
  currentUser: any = null;

  /** Mes seleccionado en formato YYYY-MM. Default: mes actual. */
  mesSeleccionado = signal<string>(this.mesActualISO());

  /** Checklists del mes (ya filtrados por permisos del usuario). */
  private checklistsDelMes = signal<any[]>([]);
  cargando = signal<boolean>(false);
  generandoPDF = signal<boolean>(false);
  archivandoMes = signal<boolean>(false);
  archivarProgreso = signal<string>('');
  borrandoFotos = signal<boolean>(false);
  borrarFotosProgreso = signal<string>('');
  /** 'TODAS' o el nombre exacto de la sucursal a incluir en el PDF. */
  sucursalParaPDF = signal<string>('TODAS');
  /** Visibilidad del dropdown custom de alcance. */
  dropdownAlcanceAbierto = signal<boolean>(false);

  /** Etiqueta humana del alcance actual (para el botón). */
  alcanceEtiqueta = computed(() => {
    const sel = this.sucursalParaPDF();
    if (sel === 'TODAS') return 'Todas las sucursales';
    return sel;
  });

  /** Resumen "X checklists · Y fotos" del alcance actual. */
  alcanceResumen = computed(() => {
    const sel = this.sucursalParaPDF();
    if (sel === 'TODAS') {
      const t = this.totalesGlobales();
      return `${t.totalChecklists} checklists · ${t.totalFotos} fotos · ${this.agrupadoPorSucursal().length} sucursales`;
    }
    const s = this.agrupadoPorSucursal().find(x => x.sucursal === sel);
    if (!s) return '';
    return `${s.totalChecklists} checklists · ${s.totalFotos} fotos · ${s.porcentaje}% cumplimiento`;
  });

  toggleDropdownAlcance() {
    this.dropdownAlcanceAbierto.update(v => !v);
  }

  seleccionarAlcance(valor: string) {
    this.sucursalParaPDF.set(valor);
    this.dropdownAlcanceAbierto.set(false);
  }

  /** Texto humano del mes (Ej: "Junio 2026"). */
  mesEtiqueta = computed(() => {
    const [y, m] = this.mesSeleccionado().split('-').map(Number);
    if (!y || !m) return '';
    const d = new Date(y, m - 1, 1);
    return d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  });

  private firestore = inject(Firestore);
  private api = inject(ApiService); // FERROCARRIL Etapa 3: checklists desde Postgres

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) this.currentUser = JSON.parse(sesion);
    this.cargarMes();
  }
  ngOnDestroy() { /* no listener vivo, los datos se piden por mes */ }

  // ============================================================================
  // FECHAS
  // ============================================================================
  private mesActualISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  private primerDiaDelMes(yyyymm: string): string {
    return `${yyyymm}-01`;
  }
  private ultimoDiaDelMes(yyyymm: string): string {
    const [y, m] = yyyymm.split('-').map(Number);
    const ultimo = new Date(y, m, 0).getDate();
    return `${yyyymm}-${String(ultimo).padStart(2, '0')}`;
  }

  cambiarMes(event: any) {
    const valor = event?.target?.value;
    if (!valor) return;
    this.mesSeleccionado.set(valor);
    this.cargarMes();
  }
  mesAnterior() {
    const [y, m] = this.mesSeleccionado().split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    this.mesSeleccionado.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    this.cargarMes();
  }
  mesSiguiente() {
    const [y, m] = this.mesSeleccionado().split('-').map(Number);
    const d = new Date(y, m, 1);
    this.mesSeleccionado.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    this.cargarMes();
  }

  // ============================================================================
  // CARGA DESDE FIRESTORE (one-shot, no snapshot — es un reporte estático)
  // ============================================================================
  private async cargarMes() {
    this.cargando.set(true);
    try {
      const desde = this.primerDiaDelMes(this.mesSeleccionado());
      const hasta = this.ultimoDiaDelMes(this.mesSeleccionado());
      // FERROCARRIL Etapa 3: rango del mes desde Postgres (antes getDocs Firestore).
      const resp = await this.api.get('/api/checklists?desde=' + encodeURIComponent(desde) + '&hasta=' + encodeURIComponent(hasta));
      const filas: any[] = resp?.checklists || [];

      const permitidas = sucursalesPermitidas(this.currentUser);
      const arr: any[] = [];
      filas.forEach((data: any) => {
        if (data.eliminado === true) return;
        if (permitidas !== null && !permitidas.includes(data.store)) return;
        arr.push(data);
      });
      this.checklistsDelMes.set(arr);
    } catch (e) {
      console.error('[cierre-mensual]', e);
      Swal.fire({ icon: 'error', title: 'Error al cargar', text: 'No se pudo leer los checklists del mes.', confirmButtonColor: '#0F172A' });
    } finally {
      this.cargando.set(false);
    }
  }

  // ============================================================================
  // AGRUPACIÓN
  // ============================================================================
  /** Lista agrupada por sucursal, ordenada por % de cumplimiento descendente. */
  agrupadoPorSucursal = computed<SucursalAgrupada[]>(() => {
    const checklists = this.checklistsDelMes();
    const [year, monthIdx0] = this.mesSeleccionado().split('-').map(Number);
    const diasEnMes = new Date(year, monthIdx0, 0).getDate();

    const mapa = new Map<string, ChecklistResumen[]>();
    for (const c of checklists) {
      const store = c.store || 'Sin sucursal';
      const items: ItemConFotos[] = (c.items || []).map((it: any) => ({
        texto: it.text || '(sin texto)',
        asignado: c.assigned || '',
        fotos: this.extraerFotos(it),
        completado: tieneEvidencia(it)
      }));
      const totalItems = items.length;
      const itemsHechos = items.filter(i => i.completado).length;
      const fotosTotales = items.reduce((s, i) => s + i.fotos.length, 0);

      const resumen: ChecklistResumen = {
        id: c.id,
        name: c.name || '(sin nombre)',
        assigned: c.assigned || '',
        date: c.date || '',
        enviado: c.enviado === true,
        itemsConFotos: items,
        totalItems, itemsHechos, fotosTotales,
        notaEmpleado: c.notaEmpleado ? String(c.notaEmpleado).trim() : '',
        entregaConRetraso: c.entregaConRetraso === true,
        motivoCategoria: c.motivoRetraso?.categoria || '',
        motivoComentario: c.motivoRetraso?.comentario || ''
      };
      if (!mapa.has(store)) mapa.set(store, []);
      mapa.get(store)!.push(resumen);
    }

    const filas: SucursalAgrupada[] = [];
    for (const [sucursal, lista] of mapa) {
      const totalTareas = lista.reduce((s, c) => s + c.totalItems, 0);
      const totalHechas = lista.reduce((s, c) => s + c.itemsHechos, 0);
      const totalFotos = lista.reduce((s, c) => s + c.fotosTotales, 0);
      const porcentaje = totalTareas > 0 ? Math.round((totalHechas / totalTareas) * 100) : 0;
      // Ordena los checklists dentro de la sucursal por fecha y luego por nombre
      lista.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

      // Top 3 empleados de la sucursal según % de cumplimiento
      const empMap = new Map<string, { hechas: number; totales: number }>();
      for (const c of lista) {
        if (!c.assigned) continue;
        if (!empMap.has(c.assigned)) empMap.set(c.assigned, { hechas: 0, totales: 0 });
        const e = empMap.get(c.assigned)!;
        e.totales += c.totalItems;
        e.hechas += c.itemsHechos;
      }
      const topEmpleados: TopEmpleado[] = Array.from(empMap.entries())
        .map(([nombre, v]) => ({
          nombre,
          hechas: v.hechas,
          totales: v.totales,
          porcentaje: v.totales > 0 ? Math.round((v.hechas / v.totales) * 100) : 0
        }))
        .filter(e => e.totales > 0)
        .sort((a, b) => b.porcentaje - a.porcentaje || b.hechas - a.hechas || a.nombre.localeCompare(b.nombre))
        .slice(0, 3);

      // Tendencia diaria: % de cumplimiento de los checklists con fecha == ese día
      const tendenciaDiaria: number[] = new Array(diasEnMes).fill(0);
      const tareasPorDia: number[] = new Array(diasEnMes).fill(0);
      const hechasPorDia: number[] = new Array(diasEnMes).fill(0);
      for (const c of lista) {
        // c.date es YYYY-MM-DD
        const diaStr = c.date?.split('-')?.[2];
        const dia = parseInt(diaStr || '0', 10);
        if (!dia || dia < 1 || dia > diasEnMes) continue;
        tareasPorDia[dia - 1] += c.totalItems;
        hechasPorDia[dia - 1] += c.itemsHechos;
      }
      for (let i = 0; i < diasEnMes; i++) {
        tendenciaDiaria[i] = tareasPorDia[i] > 0
          ? Math.round((hechasPorDia[i] / tareasPorDia[i]) * 100)
          : 0;
      }

      filas.push({
        sucursal,
        checklists: lista,
        totalChecklists: lista.length,
        totalTareas, totalHechas, totalFotos,
        porcentaje,
        topEmpleados,
        tendenciaDiaria
      });
    }
    return filas.sort((a, b) => b.porcentaje - a.porcentaje || a.sucursal.localeCompare(b.sucursal));
  });

  /** Totales globales del mes (todas las sucursales). */
  totalesGlobales = computed(() => {
    const filas = this.agrupadoPorSucursal();
    const totalChecklists = filas.reduce((s, f) => s + f.totalChecklists, 0);
    const totalTareas = filas.reduce((s, f) => s + f.totalTareas, 0);
    const totalHechas = filas.reduce((s, f) => s + f.totalHechas, 0);
    const totalFotos = filas.reduce((s, f) => s + f.totalFotos, 0);
    const porcentaje = totalTareas > 0 ? Math.round((totalHechas / totalTareas) * 100) : 0;
    return { totalChecklists, totalTareas, totalHechas, totalFotos, porcentaje };
  });

  /** Extrae todas las URLs de fotos de un item (varias formas posibles). */
  private extraerFotos(item: any): string[] {
    const urls: string[] = [];
    if (item.photo && typeof item.photo === 'string' && item.photo !== 'subiendo...') urls.push(item.photo);
    if (item.photoAntes && item.photoAntes !== 'subiendo...') urls.push(item.photoAntes);
    if (item.photoDespues && item.photoDespues !== 'subiendo...') urls.push(item.photoDespues);
    if (Array.isArray(item.photos)) {
      for (const p of item.photos) {
        const u = (p && p.url) ? p.url : p;
        if (u && typeof u === 'string') urls.push(u);
      }
    }
    return urls;
  }

  // ============================================================================
  // GENERACIÓN DEL PDF (lazy-load jsPDF + autotable)
  // ============================================================================
  async generarPDF() {
    if (this.generandoPDF()) return;

    // Filtro de sucursal (TODAS o una específica)
    const filtroSuc = this.sucursalParaPDF();
    const todasSucursales = this.agrupadoPorSucursal();
    const sucursalesFiltradas = filtroSuc === 'TODAS'
      ? todasSucursales
      : todasSucursales.filter(s => s.sucursal === filtroSuc);

    if (sucursalesFiltradas.length === 0) {
      Swal.fire({ icon: 'info', title: 'Sin datos', text: 'No hay checklists para la selección actual.', confirmButtonColor: '#0F172A' });
      return;
    }

    // Recalcular totales para el subset elegido
    const totalChecklists = sucursalesFiltradas.reduce((a, f) => a + f.totalChecklists, 0);
    const totalTareas = sucursalesFiltradas.reduce((a, f) => a + f.totalTareas, 0);
    const totalHechas = sucursalesFiltradas.reduce((a, f) => a + f.totalHechas, 0);
    const totalFotos = sucursalesFiltradas.reduce((a, f) => a + f.totalFotos, 0);
    const porcentajeTot = totalTareas > 0 ? Math.round((totalHechas / totalTareas) * 100) : 0;
    const totales = { totalChecklists, totalTareas, totalHechas, totalFotos, porcentaje: porcentajeTot };

    if (totales.totalChecklists === 0) {
      Swal.fire({ icon: 'info', title: 'Sin datos', text: 'No hay checklists en el mes seleccionado.', confirmButtonColor: '#0F172A' });
      return;
    }
    if (totales.totalFotos > 200) {
      const r = await Swal.fire({
        title: 'Reporte grande',
        html: `Vas a generar un PDF con <strong>${totales.totalFotos}</strong> fotos. Puede tardar 1-3 minutos. ¿Continuar?`,
        icon: 'warning', showCancelButton: true,
        confirmButtonText: 'Sí, generar', cancelButtonText: 'Cancelar',
        confirmButtonColor: '#0F172A'
      });
      if (!r.isConfirmed) return;
    }

    this.generandoPDF.set(true);
    Swal.fire({
      title: 'Generando reporte...',
      html: '<p style="font-size:13px;color:#475569">Preparando el documento, no cierres la pestaña.</p><div id="cm-progreso" style="font-size:12px;color:#64748B;margin-top:8px"></div>',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      const { default: jsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');

      const doc = new jsPDF('p', 'mm', 'a4');
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const M = 18; // margen lateral generoso
      const sucursales = sucursalesFiltradas;
      const fechaGen = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });

      // Paleta corporativa unificada
      // Paleta corporativa Mega Dulces — Burdeos + rosáceo premium
      const C = {
        navy:  [131, 24, 67]  as [number, number, number],  // #831843 burdeos principal
        accent:[190, 24, 93]  as [number, number, number],  // #BE185D rosa antiguo
        ink:   [76, 5, 43]    as [number, number, number],  // burdeos muy oscuro para texto
        gray:  [136, 86, 110] as [number, number, number],  // rosa-gris para meta
        soft:  [180, 144, 162] as [number, number, number], // rosa-gris claro
        line:  [243, 218, 228] as [number, number, number], // rosa muy claro para líneas
        bg:    [253, 242, 248] as [number, number, number], // crema rosada para fondos
        gold:  [217, 119, 6]  as [number, number, number],  // dorado para acentos premium
        ok:    [16, 185, 129] as [number, number, number],
        warn:  [245, 158, 11] as [number, number, number],
        bad:   [239, 68, 68]  as [number, number, number]
      };

      // ----- PRE-CARGA DE FOTOS -----
      let totalFotosProcesadas = 0;
      const fotosCache = new Map<string, string[]>();
      const itemKey = (suc: string, chkId: string, idx: number) => `${suc}|${chkId}|${idx}`;
      for (const s of sucursales) {
        for (const c of s.checklists) {
          for (let i = 0; i < c.itemsConFotos.length; i++) {
            const it = c.itemsConFotos[i];
            if (it.fotos.length === 0) continue;
            const thumbs: string[] = [];
            for (const fotoUrl of it.fotos) {
              const data = await this.cargarComoBase64(this.convertirAThumbnail(fotoUrl));
              if (data) {
                thumbs.push(data);
                totalFotosProcesadas++;
                const elProgreso = document.getElementById('cm-progreso');
                if (elProgreso) elProgreso.textContent = `Procesando fotos: ${totalFotosProcesadas} de ${totales.totalFotos}`;
              }
            }
            if (thumbs.length > 0) fotosCache.set(itemKey(s.sucursal, c.id, i), thumbs);
          }
        }
      }

      // =====================================================================
      // PÁGINA 1 — PORTADA EDITORIAL (estilo magazine)
      // Foto grande arriba (60% de la página) + bloque blanco abajo con título.
      // Si no hay foto disponible, fondo navy sólido.
      // =====================================================================
      const fotoPortadaH = pageH * 0.60;
      const fotoPortada = this.escogerFotoDestacada(sucursales, fotosCache, itemKey);
      if (fotoPortada) {
        try {
          // Cubre con foto que abarca todo el ancho
          doc.addImage(fotoPortada, 'JPEG', 0, 0, pageW, fotoPortadaH);
          // Overlay sutil oscuro abajo para mejor legibilidad si quedara texto encima
          doc.setFillColor(15, 23, 42);
          doc.setGState(new (doc as any).GState({ opacity: 0.10 }));
          doc.rect(0, 0, pageW, fotoPortadaH, 'F');
          doc.setGState(new (doc as any).GState({ opacity: 1 }));
        } catch { /* fallback abajo */ }
      } else {
        // Fallback: bloque navy
        doc.setFillColor(...C.navy);
        doc.rect(0, 0, pageW, fotoPortadaH, 'F');
        // Patrón geométrico sutil
        doc.setDrawColor(255, 255, 255);
        doc.setLineWidth(0.2);
        doc.setGState(new (doc as any).GState({ opacity: 0.15 }));
        for (let i = 0; i < 20; i++) {
          doc.line(M + i * 8, fotoPortadaH - 30, M + i * 8 + 4, fotoPortadaH);
        }
        doc.setGState(new (doc as any).GState({ opacity: 1 }));
      }

      // Bloque crema rosado inferior (40% restante)
      doc.setFillColor(...C.bg);
      doc.rect(0, fotoPortadaH, pageW, pageH - fotoPortadaH, 'F');

      // Ornamento dorado superior: línea + diamante + línea (estilo premium)
      const ornY = fotoPortadaH + 14;
      doc.setDrawColor(...C.gold); doc.setLineWidth(0.4);
      doc.line(M, ornY, M + 20, ornY);
      doc.setFillColor(...C.gold);
      doc.circle(M + 24, ornY, 0.8, 'F');
      doc.line(M + 28, ornY, M + 48, ornY);

      // Kicker pequeño arriba del título — incluye sucursal si el reporte es de una sola
      const titY = fotoPortadaH + 26;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...C.accent);
      const kickerPortada = filtroSuc === 'TODAS'
        ? 'MEGA DULCES DE LOS ALTOS'
        : `MEGA DULCES · ${filtroSuc.toUpperCase()}`;
      doc.text(kickerPortada, M, titY, { charSpace: 1.4 });

      // Título grande a dos líneas: "INFORME / MENSUAL"
      doc.setTextColor(...C.navy);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(42);
      doc.text('INFORME', M, titY + 18, { charSpace: 0.5 });
      // "MENSUAL" en accent rosa antiguo con peso normal
      doc.setFont('helvetica', 'normal'); doc.setFontSize(42); doc.setTextColor(...C.accent);
      doc.text('MENSUAL', M, titY + 35, { charSpace: 0.5 });
      // Subrayado decorativo dorado debajo de "MENSUAL"
      doc.setDrawColor(...C.gold); doc.setLineWidth(1.2);
      doc.line(M, titY + 40, M + 36, titY + 40);
      doc.setLineWidth(0.4);
      doc.line(M, titY + 42, M + 18, titY + 42);

      // Pie con mes y preparado por
      const pieY = titY + 54;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.gray);
      const piePartes = [
        this.mesEtiqueta().toUpperCase(),
        `PREPARADO POR ${(this.currentUser?.nombre || 'Administración').toUpperCase()}`
      ];
      doc.text(piePartes.join('  //  '), M, pieY, { charSpace: 1 });

      // Mini watermark "MD" estilo monograma en esquina inferior derecha del bloque crema
      doc.setFont('helvetica', 'bold'); doc.setFontSize(48); doc.setTextColor(...C.line);
      doc.text('MD', pageW - M - 16, pageH - M, { align: 'right' });

      // =====================================================================
      // PÁGINA 2 — DESCRIPCIÓN (estilo editorial premium con drop cap)
      // =====================================================================
      doc.addPage();

      // Ornamento dorado lateral izquierdo
      doc.setDrawColor(...C.gold); doc.setLineWidth(0.4);
      doc.line(M, 36, M + 14, 36);
      doc.setFillColor(...C.gold);
      doc.circle(M + 18, 36, 0.8, 'F');

      // Kicker
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...C.accent);
      doc.text('SECCIÓN 01', M, 44, { charSpace: 1.5 });

      // Título grande con subrayado dorado
      doc.setFont('helvetica', 'bold'); doc.setFontSize(34); doc.setTextColor(...C.navy);
      doc.text('Descripción', M, 64);
      doc.setDrawColor(...C.gold); doc.setLineWidth(1);
      doc.line(M, 68, M + 30, 68);

      // Párrafo descriptivo con drop cap (primera letra grande)
      const lider = sucursales[0];
      const ambito = filtroSuc === 'TODAS'
        ? `${sucursales.length} sucursales`
        : `la sucursal ${filtroSuc}`;
      const lineaLider = (filtroSuc === 'TODAS' && lider)
        ? ` La sucursal con mejor desempeño fue ${lider.sucursal} con ${lider.porcentaje}% de cumplimiento.`
        : '';
      const desc = `Durante el mes de ${this.mesEtiqueta().toLowerCase()} se procesaron ${totales.totalChecklists} checklists operativos en ${ambito}, con un cumplimiento general del ${totales.porcentaje}%. Se validaron ${totales.totalHechas} de ${totales.totalTareas} tareas asignadas y se documentaron ${totales.totalFotos} evidencias fotográficas.${lineaLider}`;

      // Drop cap: primera letra grande en burdeos
      const primeraLetra = desc.charAt(0);
      const restoTexto = desc.slice(1);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(46); doc.setTextColor(...C.navy);
      doc.text(primeraLetra, M, 92);

      // Resto del párrafo, rodea el drop cap
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...C.ink);
      const dropCapWidth = 12;   // ancho que ocupa la letra grande
      const dropCapLines = 3;    // primeras N líneas se sangran
      // Primeras líneas con sangría
      const restoLineasCortas = doc.splitTextToSize(restoTexto, pageW - M * 2 - dropCapWidth - 2);
      const primerasLineas = restoLineasCortas.slice(0, dropCapLines);
      doc.text(primerasLineas, M + dropCapWidth + 2, 78, { lineHeightFactor: 1.45 });
      // Resto sin sangría
      let yPar = 78 + primerasLineas.length * 5;
      if (restoLineasCortas.length > dropCapLines) {
        // Re-medimos el resto con el ancho completo
        const textoResto = restoLineasCortas.slice(dropCapLines).join(' ');
        const restoFull = doc.splitTextToSize(textoResto, pageW - M * 2);
        doc.text(restoFull, M, yPar, { lineHeightFactor: 1.45 });
        yPar += restoFull.length * 5;
      }

      let yResumen = yPar + 14;
      doc.setDrawColor(...C.line); doc.setLineWidth(0.2);
      doc.line(M, yResumen, pageW - M, yResumen);
      yResumen += 12;

      // KPIs grandes en cuadrícula editorial 2x2 (con kicker numérico)
      const kpiW = (pageW - M * 2 - 12) / 2;
      const kpiH = 32;
      const kpis = [
        { num: `${totales.porcentaje}%`,  label: 'Cumplimiento general', kicker: '01',
          color: totales.porcentaje >= 80 ? C.ok : (totales.porcentaje >= 50 ? C.warn : C.bad) },
        { num: totales.totalChecklists.toString(), label: 'Checklists', kicker: '02', color: C.navy },
        { num: `${totales.totalHechas}/${totales.totalTareas}`, label: 'Tareas validadas', kicker: '03', color: C.navy },
        { num: totales.totalFotos.toString(), label: 'Fotografías', kicker: '04', color: C.navy }
      ];
      for (let i = 0; i < kpis.length; i++) {
        const k = kpis[i];
        const x = M + (i % 2) * (kpiW + 12);
        const y = yResumen + Math.floor(i / 2) * (kpiH + 6);
        // Kicker mini gris
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.soft);
        doc.text(k.kicker, x, y + 4, { charSpace: 1 });
        // Número grande
        doc.setTextColor(...k.color);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(32);
        doc.text(k.num, x, y + 18);
        // Línea fina debajo
        doc.setDrawColor(...C.line); doc.setLineWidth(0.2);
        doc.line(x, y + 22, x + kpiW, y + 22);
        // Etiqueta
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...C.gray);
        doc.text(k.label, x, y + 28);
      }
      yResumen += 2 * (kpiH + 6) + 14;

      // =====================================================================
      // SECCIÓN 02 — DESEMPEÑO POR SUCURSAL
      // =====================================================================
      if (yResumen > pageH - 60) {
        doc.addPage();
        this.dibujarHeaderPagina(doc, pageW, M, this.mesEtiqueta(), 'Desempeño', C);
        yResumen = 40;
      }
      // Kicker
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...C.gray);
      doc.text('SECCIÓN 02', M, yResumen, { charSpace: 1.5 });
      yResumen += 16;
      // Título
      doc.setFont('helvetica', 'bold'); doc.setFontSize(28); doc.setTextColor(...C.navy);
      doc.text('Desempeño', M, yResumen);
      doc.setDrawColor(...C.navy); doc.setLineWidth(0.6);
      doc.line(M, yResumen + 3, M + 22, yResumen + 3);
      yResumen += 14;

      // Lista visual con barras grandes y aire entre filas
      const maxLabelW = 60;
      const barX = M + maxLabelW + 4;
      const barTotalW = pageW - M - barX - 22;
      const rowH = 13;
      for (const s of sucursales) {
        if (yResumen + rowH > pageH - 20) {
          doc.addPage();
          this.dibujarHeaderPagina(doc, pageW, M, this.mesEtiqueta(), 'Desempeño', C);
          yResumen = 40;
        }
        // Nombre
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...C.ink);
        doc.text(s.sucursal.length > 32 ? s.sucursal.slice(0, 30) + '…' : s.sucursal, M, yResumen + 4);
        // Sub-meta
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.soft);
        doc.text(`${s.totalChecklists} chk  ·  ${s.totalHechas}/${s.totalTareas} tareas`, M, yResumen + 9);
        // Barra fondo
        doc.setFillColor(...C.line);
        doc.rect(barX, yResumen + 3, barTotalW, 3, 'F');
        // Barra fill
        const fillW = (s.porcentaje / 100) * barTotalW;
        const c = s.porcentaje >= 80 ? C.ok : (s.porcentaje >= 50 ? C.warn : C.bad);
        if (fillW > 0) {
          doc.setFillColor(...c);
          doc.rect(barX, yResumen + 3, Math.max(fillW, 1), 3, 'F');
        }
        // %
        doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...c);
        doc.text(`${s.porcentaje}%`, pageW - M, yResumen + 6, { align: 'right' });
        // Línea sutil divisoria
        doc.setDrawColor(...C.line); doc.setLineWidth(0.1);
        doc.line(M, yResumen + 13, pageW - M, yResumen + 13);
        yResumen += rowH + 1;
      }

      // =====================================================================
      // POR CADA SUCURSAL — portadilla editorial + páginas de detalle
      // =====================================================================
      let secNum = 3;
      for (const s of sucursales) {

        // ----- PORTADILLA EDITORIAL DE LA SUCURSAL -----
        // Foto de sucursal arriba (50%) + bloque blanco abajo con info.
        doc.addPage();
        const fotoSucH = pageH * 0.50;
        const fotoSuc = this.escogerFotoSucursal(s, fotosCache, itemKey);
        if (fotoSuc) {
          try {
            doc.addImage(fotoSuc, 'JPEG', 0, 0, pageW, fotoSucH);
            // Overlay sutil para mejor contraste de "kicker" si lo pusiéramos
            doc.setFillColor(15, 23, 42);
            doc.setGState(new (doc as any).GState({ opacity: 0.12 }));
            doc.rect(0, 0, pageW, fotoSucH, 'F');
            doc.setGState(new (doc as any).GState({ opacity: 1 }));
          } catch { /* fallback abajo */ }
        } else {
          doc.setFillColor(...C.navy);
          doc.rect(0, 0, pageW, fotoSucH, 'F');
        }

        // Bloque crema rosado inferior
        doc.setFillColor(...C.bg);
        doc.rect(0, fotoSucH, pageW, pageH - fotoSucH, 'F');

        // Ornamento dorado
        const ornSY = fotoSucH + 10;
        doc.setDrawColor(...C.gold); doc.setLineWidth(0.4);
        doc.line(M, ornSY, M + 16, ornSY);
        doc.setFillColor(...C.gold);
        doc.circle(M + 20, ornSY, 0.7, 'F');
        doc.line(M + 24, ornSY, M + 40, ornSY);

        // Kicker
        const kY = fotoSucH + 22;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...C.accent);
        doc.text(`SECCIÓN ${String(secNum).padStart(2, '0')}  //  SUCURSAL`, M, kY, { charSpace: 1.5 });
        secNum++;

        // Nombre de sucursal (grande). Si tiene más de 2 líneas trunca.
        doc.setTextColor(...C.navy); doc.setFont('helvetica', 'bold'); doc.setFontSize(30);
        let nameLines = doc.splitTextToSize(s.sucursal.toUpperCase(), pageW - M * 2 - 60);
        if (nameLines.length > 2) {
          const dos = nameLines.slice(0, 2);
          dos[1] = dos[1].replace(/\s+\S*$/, '') + '...';
          nameLines = dos;
        }
        doc.text(nameLines, M, kY + 12);

        // Porcentaje pull-quote — Y ajustada según número de líneas del título
        const pctYBase = nameLines.length === 1 ? kY + 18 : kY + 28;
        const pctColor = s.porcentaje >= 80 ? C.ok : (s.porcentaje >= 50 ? C.warn : C.bad);
        doc.setTextColor(...pctColor); doc.setFont('helvetica', 'bold'); doc.setFontSize(56);
        doc.text(`${s.porcentaje}%`, pageW - M, pctYBase, { align: 'right' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.gray);
        doc.text('CUMPLIMIENTO', pageW - M, pctYBase + 7, { align: 'right', charSpace: 1.2 });

        // Línea decorativa dorada bajo el título
        const lineaY = kY + 14 + nameLines.length * 11;
        doc.setDrawColor(...C.gold); doc.setLineWidth(1);
        doc.line(M, lineaY, M + 26, lineaY);
        doc.setLineWidth(0.4);
        doc.line(M, lineaY + 2, M + 14, lineaY + 2);

        // Mini descripción de la sucursal
        const descY = lineaY + 10;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...C.ink);
        const descSuc = `Durante ${this.mesEtiqueta().toLowerCase()} la sucursal ${s.sucursal} procesó ${s.totalChecklists} checklists con ${s.totalHechas} de ${s.totalTareas} tareas validadas y ${s.totalFotos} evidencias documentadas.`;
        const descSucLines = doc.splitTextToSize(descSuc, pageW - M * 2 - 4);
        doc.text(descSucLines, M, descY, { lineHeightFactor: 1.4 });

        // Sparkline más abajo
        const sparkY = descY + descSucLines.length * 5 + 10;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.gray);
        doc.text('TENDENCIA DIARIA', M, sparkY, { charSpace: 1.2 });
        this.dibujarSparklinePro(doc, s.tendenciaDiaria, M, sparkY + 3, pageW - M * 2, 14, C);

        // KPIs en línea (3 columnas)
        const kpiY2 = sparkY + 28;
        const kpisSec = [
          { num: s.totalChecklists.toString(), label: 'Checklists' },
          { num: `${s.totalHechas}/${s.totalTareas}`, label: 'Tareas validadas' },
          { num: s.totalFotos.toString(), label: 'Fotografías' }
        ];
        const kSecW = (pageW - M * 2) / kpisSec.length;
        for (let i = 0; i < kpisSec.length; i++) {
          const x = M + i * kSecW;
          doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.soft);
          doc.text(`0${i + 1}`, x, kpiY2, { charSpace: 1 });
          doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...C.navy);
          doc.text(kpisSec[i].num, x, kpiY2 + 11);
          doc.setDrawColor(...C.line); doc.setLineWidth(0.2);
          doc.line(x, kpiY2 + 15, x + kSecW - 6, kpiY2 + 15);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.gray);
          doc.text(kpisSec[i].label, x, kpiY2 + 20);
        }

        // Top 3 empleados (estilo editorial limpio)
        if (s.topEmpleados.length > 0) {
          const tY = kpiY2 + 32;
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.gray);
          doc.text('TOP 3 DEL MES', M, tY, { charSpace: 1.2 });
          doc.setDrawColor(...C.line); doc.setLineWidth(0.2);
          doc.line(M, tY + 2, pageW - M, tY + 2);
          let ty = tY + 9;
          for (let i = 0; i < Math.min(3, s.topEmpleados.length); i++) {
            const e = s.topEmpleados[i];
            doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...C.soft);
            doc.text(`0${i + 1}`, M, ty + 6);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...C.ink);
            doc.text(e.nombre, M + 12, ty + 3);
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.gray);
            doc.text(`${e.hechas} de ${e.totales} tareas`, M + 12, ty + 8);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...C.navy);
            doc.text(`${e.porcentaje}%`, pageW - M, ty + 6, { align: 'right' });
            ty += 12;
          }
        }

        // ----- PÁGINAS DE DETALLE DE LA SUCURSAL -----
        // Lista de checklists, uno por bloque, con sus tareas y fotos.
        // Estilo de "tarjeta limpia": cada item es un bloque, sin tabla apretada.
        doc.addPage();
        this.dibujarHeaderPagina(doc, pageW, M, this.mesEtiqueta(), 'Detalle · ' + s.sucursal, C);
        let y = 38;

        for (const c of s.checklists) {
          const altoEstimado = 22 + (c.itemsConFotos.length * 16);
          if (y + 40 > pageH - 20) {
            doc.addPage();
            this.dibujarHeaderPagina(doc, pageW, M, this.mesEtiqueta(), 'Detalle · ' + s.sucursal, C);
            y = 38;
          }

          // Encabezado del checklist
          doc.setFillColor(...C.bg);
          doc.rect(M, y, pageW - M * 2, 14, 'F');
          doc.setDrawColor(...C.navy); doc.setLineWidth(1);
          doc.line(M, y, M, y + 14);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...C.navy);
          doc.text(c.name.length > 70 ? c.name.slice(0, 68) + '…' : c.name, M + 3, y + 6);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.gray);
          doc.text(`${c.assigned}  ·  ${c.date}  ·  ${c.itemsHechos}/${c.totalItems} tareas hechas`, M + 3, y + 11);
          // Badge de estado a la derecha
          let badgeTxt = 'ENVIADO';
          let badgeColor = C.ok;
          if (!c.enviado) { badgeTxt = 'SIN ENVIAR'; badgeColor = C.soft; }
          else if (c.entregaConRetraso) { badgeTxt = 'RETRASO JUSTIFICADO'; badgeColor = C.warn; }
          doc.setFillColor(...badgeColor);
          const bw = doc.getStringUnitWidth(badgeTxt) * 7 / doc.internal.scaleFactor + 6;
          doc.roundedRect(pageW - M - bw, y + 3, bw, 8, 1.5, 1.5, 'F');
          doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(255, 255, 255);
          doc.text(badgeTxt, pageW - M - bw / 2, y + 8.5, { align: 'center' });
          y += 16;

          // Nota / motivo (si existe)
          if (c.notaEmpleado || c.entregaConRetraso) {
            const texto = [
              c.entregaConRetraso ? `Motivo del retraso: ${c.motivoCategoria || '—'} — ${c.motivoComentario || '(sin detalle)'}` : '',
              c.notaEmpleado ? `Comentario del colaborador: ${c.notaEmpleado}` : ''
            ].filter(Boolean).join('\n');
            const lines = doc.splitTextToSize(texto, pageW - M * 2 - 6);
            const h = lines.length * 4 + 4;
            if (y + h > pageH - 20) { doc.addPage(); this.dibujarHeaderPagina(doc, pageW, M, this.mesEtiqueta(), 'Detalle · ' + s.sucursal, C); y = 38; }
            doc.setFillColor(255, 251, 235);
            doc.setDrawColor(245, 158, 11); doc.setLineWidth(0.2);
            doc.roundedRect(M, y, pageW - M * 2, h, 1, 1, 'FD');
            doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(146, 64, 14);
            doc.text(lines, M + 3, y + 4);
            y += h + 3;
          }

          // Items del checklist con sus fotos
          for (let idx = 0; idx < c.itemsConFotos.length; idx++) {
            const it = c.itemsConFotos[idx];
            const fotos = fotosCache.get(itemKey(s.sucursal, c.id, idx)) || [];
            // alto del bloque: depende de cuántas fotos
            const fotosPorFila = 4;
            const filasFotos = fotos.length > 0 ? Math.ceil(fotos.length / fotosPorFila) : 0;
            const altoFila = filasFotos * 22; // 20mm alto + 2 separación
            const altoBloque = 10 + altoFila;

            if (y + altoBloque > pageH - 20) {
              doc.addPage();
              this.dibujarHeaderPagina(doc, pageW, M, this.mesEtiqueta(), 'Detalle · ' + s.sucursal, C);
              y = 38;
            }

            // Punto de estado a la izquierda
            doc.setFillColor(...(it.completado ? C.ok : C.soft));
            doc.circle(M + 2, y + 3, 1.4, 'F');
            // Texto del item
            doc.setFont('helvetica', it.completado ? 'normal' : 'normal'); doc.setFontSize(9.5); doc.setTextColor(...C.ink);
            const textoItem = doc.splitTextToSize(it.texto, pageW - M * 2 - 10);
            doc.text(textoItem, M + 7, y + 4);
            // Etiqueta lateral derecha del estado
            doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...(it.completado ? C.ok : C.soft));
            doc.text(it.completado ? 'HECHO' : 'PENDIENTE', pageW - M, y + 4, { align: 'right' });
            y += Math.max(7, textoItem.length * 4 + 3);

            // Fotos
            if (fotos.length > 0) {
              const fotoW = (pageW - M * 2 - (fotosPorFila - 1) * 3) / fotosPorFila;
              const fotoH = 20;
              let fx = M + 7;
              let fy = y;
              for (let i = 0; i < fotos.length; i++) {
                if (i > 0 && i % fotosPorFila === 0) { fx = M + 7; fy += fotoH + 2; }
                try {
                  // Marco blanco sutil
                  doc.setFillColor(255, 255, 255);
                  doc.setDrawColor(...C.line);
                  doc.setLineWidth(0.2);
                  doc.roundedRect(fx - 0.5, fy - 0.5, fotoW + 1, fotoH + 1, 0.5, 0.5, 'FD');
                  doc.addImage(fotos[i], 'JPEG', fx, fy, fotoW, fotoH);
                } catch { /* ignora */ }
                fx += fotoW + 3;
              }
              y = fy + fotoH + 3;
            }

            // Separador fino entre items
            doc.setDrawColor(...C.line); doc.setLineWidth(0.1);
            doc.line(M + 7, y, pageW - M, y);
            y += 2;
          }

          // Espacio entre checklists
          y += 6;
        }
      }

      // =====================================================================
      // FOOTERS — pie consistente en TODAS las páginas excepto portada
      // =====================================================================
      const totalPag = doc.getNumberOfPages();
      for (let i = 2; i <= totalPag; i++) {
        doc.setPage(i);
        doc.setDrawColor(...C.line); doc.setLineWidth(0.2);
        doc.line(M, pageH - 12, pageW - M, pageH - 12);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.soft);
        doc.text('MEGA DULCES · Cierre Mensual · ' + this.mesEtiqueta(), M, pageH - 7);
        doc.text(`${i} / ${totalPag}`, pageW - M, pageH - 7, { align: 'right' });
      }

      const sufijoSuc = filtroSuc === 'TODAS'
        ? ''
        : '_' + filtroSuc.replace(/[^a-zA-Z0-9]+/g, '-');
      const nombreArchivo = `Cierre_Mensual_${this.mesSeleccionado()}${sufijoSuc}.pdf`;
      doc.save(nombreArchivo);
      Swal.fire({
        icon: 'success', title: 'Reporte generado',
        html: `Se descargó <strong>${nombreArchivo}</strong> con <strong>${totalFotosProcesadas}</strong> fotos.`,
        confirmButtonColor: '#0F172A'
      });
    } catch (e: any) {
      console.error('[generarPDF]', e);
      Swal.fire({
        icon: 'error', title: 'No se pudo generar el PDF',
        html: `<p>Intenta recargar la página y vuelve a intentar.</p>
               <p style="font-size:11px;color:#64748B"><strong>Detalle:</strong> <code>${(e?.message || e || '').toString().slice(0, 240)}</code></p>`,
        confirmButtonColor: '#0F172A'
      });
    } finally {
      this.generandoPDF.set(false);
    }
  }

  /**
   * Escoge la primera foto disponible del mes para usarla como portada.
   * Recorre las sucursales y checklists hasta encontrar una. Si no hay
   * ninguna, retorna null (la portada usa un fallback navy).
   */
  private escogerFotoDestacada(
    sucursales: SucursalAgrupada[],
    cache: Map<string, string[]>,
    keyFn: (s: string, c: string, i: number) => string
  ): string | null {
    for (const s of sucursales) {
      for (const c of s.checklists) {
        for (let i = 0; i < c.itemsConFotos.length; i++) {
          const fotos = cache.get(keyFn(s.sucursal, c.id, i));
          if (fotos && fotos.length > 0) return fotos[0];
        }
      }
    }
    return null;
  }

  /**
   * Escoge una foto representativa para una sucursal específica.
   * Usa la primera foto disponible de cualquier checklist de esa sucursal.
   */
  private escogerFotoSucursal(
    sucursal: SucursalAgrupada,
    cache: Map<string, string[]>,
    keyFn: (s: string, c: string, i: number) => string
  ): string | null {
    for (const c of sucursal.checklists) {
      for (let i = 0; i < c.itemsConFotos.length; i++) {
        const fotos = cache.get(keyFn(sucursal.sucursal, c.id, i));
        if (fotos && fotos.length > 0) return fotos[0];
      }
    }
    return null;
  }

  /**
   * Header consistente de página interior (estilo libro): nombre del documento
   * a la izquierda, sección a la derecha, línea inferior fina.
   */
  private dibujarHeaderPagina(doc: any, pageW: number, M: number, mes: string, seccion: string, C: any): void {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.soft);
    doc.text(`MEGA DULCES  ·  Cierre Mensual  ·  ${mes}`, M, 14);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...C.gray);
    doc.text(seccion.toUpperCase(), pageW - M, 14, { align: 'right' });
    doc.setDrawColor(...C.line); doc.setLineWidth(0.2);
    doc.line(M, 18, pageW - M, 18);
  }

  /**
   * Sparkline profesional: línea limpia navy sobre fondo claro, gradiente
   * sutil bajo la línea (poligono relleno), etiquetas de inicio/fin del mes.
   * Sin puntos chillones; los días sin actividad bajan a 0%.
   */
  private dibujarSparklinePro(doc: any, valores: number[], x: number, y: number, ancho: number, alto: number, C: any): void {
    if (!valores || valores.length === 0) return;
    const n = valores.length;
    // Fondo plano gris muy claro
    doc.setFillColor(248, 250, 252);
    doc.rect(x, y, ancho, alto, 'F');
    // Líneas guía 50% y 100%
    doc.setDrawColor(...C.line); doc.setLineWidth(0.1);
    doc.line(x, y + alto / 2, x + ancho, y + alto / 2);
    doc.line(x, y, x + ancho, y);
    // Construye puntos
    const dx = ancho / Math.max(1, n - 1);
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const v = Math.max(0, Math.min(100, valores[i] || 0));
      pts.push({ x: x + i * dx, y: y + alto - (v / 100) * alto });
    }
    // Polígono relleno (área bajo la curva) — gris muy claro
    doc.setFillColor(219, 234, 254);
    const polyPath = pts.concat([{ x: x + ancho, y: y + alto }, { x: x, y: y + alto }]);
    doc.lines(
      polyPath.slice(1).map((p, i) => [p.x - polyPath[i].x, p.y - polyPath[i].y]),
      polyPath[0].x, polyPath[0].y,
      [1, 1], 'F'
    );
    // Línea sobre el polígono
    doc.setDrawColor(...C.navy); doc.setLineWidth(0.6);
    for (let i = 0; i < pts.length - 1; i++) {
      doc.line(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    }
    // Labels
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(...C.soft);
    doc.text(`día 1`, x, y + alto + 4);
    doc.text(`día ${n}`, x + ancho, y + alto + 4, { align: 'right' });
    doc.text(`100%`, x + ancho + 1, y + 2);
    doc.text(`0%`, x + ancho + 1, y + alto);
  }

  /**
   * Sparkline legacy — se mantiene por compatibilidad con eventuales callers.
   * (Versión más simple, no se usa en el PDF nuevo).
   */
  private dibujarSparkline(doc: any, valores: number[], x: number, y: number, ancho: number, alto: number): void {
    if (!valores || valores.length === 0) return;
    const n = valores.length;
    // Línea base sutil
    doc.setDrawColor(180, 195, 220);
    doc.setLineWidth(0.1);
    doc.line(x, y + alto, x + ancho, y + alto);
    // Etiqueta "Tendencia"
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(180, 195, 220);
    doc.text(`Tendencia diaria · ${n} días`, x, y - 1);
    // Puntos
    const dx = ancho / Math.max(1, n - 1);
    doc.setDrawColor(110, 231, 183); // verde claro
    doc.setLineWidth(0.4);
    let prevX: number | null = null; let prevY: number | null = null;
    for (let i = 0; i < n; i++) {
      const v = valores[i] || 0;
      const px = x + i * dx;
      const py = y + alto - (v / 100) * alto;
      if (prevX !== null && prevY !== null) doc.line(prevX, prevY, px, py);
      // Pequeño círculo en cada punto
      doc.setFillColor(110, 231, 183);
      doc.circle(px, py, 0.5, 'F');
      prevX = px; prevY = py;
    }
  }

  /** Convierte una URL de Cloudinary a su versión thumbnail 600px con compresión auto.
   *  Si no es URL de Cloudinary se regresa tal cual (intento normal). */
  private convertirAThumbnail(url: string): string {
    if (!url || !url.includes('/upload/')) return url;
    if (url.includes('/upload/w_') || url.includes('/upload/c_')) return url; // ya tiene transformación
    return url.replace('/upload/', '/upload/w_600,q_auto,f_jpg/');
  }

  /** Carga una imagen y la convierte a base64 para meterla en el PDF. */
  private cargarComoBase64(url: string): Promise<string | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || 600;
          canvas.height = img.naturalHeight || 400;
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(null); return; }
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/jpeg', 0.78));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  /** ¿El usuario actual puede ver esta pantalla? (admin global o limitado). */
  get puedeUsar(): boolean {
    return this.currentUser?.rol === 'admin';
  }
  esAdminGlobal = computed(() => esAdminGlobal(this.currentUser));

  // ============================================================================
  // ARCHIVAR MES
  // ============================================================================
  /** Cuántos checklists del mes aún NO están archivados. */
  noArchivadosCount = computed(() => {
    return this.checklistsDelMes().filter(c => c.archivado !== true).length;
  });

  /** Cuántos checklists del mes ya están archivados. */
  archivadosCount = computed(() => {
    return this.checklistsDelMes().filter(c => c.archivado === true).length;
  });

  /** True si todos los checklists del mes ya están archivados (no hay nada que archivar). */
  mesYaArchivado = computed(() => {
    const total = this.checklistsDelMes().length;
    return total > 0 && this.noArchivadosCount() === 0;
  });

  /**
   * Archiva todos los checklists del mes seleccionado.
   * Soft-archive: marca archivado:true, archivadoEn, archivadoPor, archivadoMes.
   * No borra fotos de Cloudinary (eso es la fase B).
   * Requiere admin global + escribir "ARCHIVAR" como confirmación.
   */
  async archivarMes(): Promise<void> {
    if (!this.esAdminGlobal()) return;
    if (this.archivandoMes()) return;

    const noArchivados = this.checklistsDelMes().filter(c => c.archivado !== true);
    if (noArchivados.length === 0) {
      await Swal.fire({
        icon: 'info',
        title: 'Nada por archivar',
        text: 'Todos los checklists de este mes ya están archivados.',
        confirmButtonColor: '#831843'
      });
      return;
    }

    const mes = this.mesEtiqueta();
    const total = noArchivados.length;

    // PASO 1: Aviso fuerte con resumen
    const paso1 = await Swal.fire({
      icon: 'warning',
      title: `Archivar ${mes}`,
      html: `
        <div style="text-align:left; font-size:14px; line-height:1.55;">
          <p style="margin:0 0 10px 0;"><strong>Vas a archivar ${total} checklist(s)</strong> del mes <strong>${mes}</strong>.</p>
          <p style="margin:0 0 10px 0;">Después de archivar:</p>
          <ul style="margin:0 0 12px 18px; padding:0;">
            <li>Desaparecerán de <strong>Auditoría visual</strong>, <strong>Dashboard</strong>, <strong>Calendario</strong>, <strong>Estadísticas</strong>, <strong>Ranking</strong> y <strong>Checkstore</strong>.</li>
            <li><strong>Seguirán visibles aquí en Cierre Mensual</strong> para poder regenerar el PDF cuando quieras.</li>
            <li>Las fotos de Cloudinary <strong>NO se borran todavía</strong> (eso es un paso aparte).</li>
          </ul>
          <p style="margin:0 0 8px 0; color:#831843;"><strong>Antes de continuar, asegúrate de tener descargado el PDF mensual.</strong></p>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Continuar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#831843',
      cancelButtonColor: '#64748b'
    });
    if (!paso1.isConfirmed) return;

    // PASO 2: Confirmación doble con input
    const paso2 = await Swal.fire({
      title: 'Confirmación final',
      html: `<div style="text-align:left; font-size:14px;">Escribe <strong>ARCHIVAR</strong> en mayúsculas para confirmar.</div>`,
      input: 'text',
      inputPlaceholder: 'ARCHIVAR',
      showCancelButton: true,
      confirmButtonText: 'Archivar mes',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#831843',
      cancelButtonColor: '#64748b',
      inputValidator: (val) => {
        if (val !== 'ARCHIVAR') return 'Debes escribir exactamente ARCHIVAR.';
        return null;
      }
    });
    if (!paso2.isConfirmed) return;

    // EJECUCIÓN: batch writes (Firestore tope 500 por batch)
    this.archivandoMes.set(true);
    this.archivarProgreso.set(`0 / ${total}`);
    const yyyymm = this.mesSeleccionado();
    const adminNombre = this.currentUser?.nombre || this.currentUser?.email || 'Administración';

    try {
      const CHUNK = 400;
      let hechos = 0;
      for (let i = 0; i < noArchivados.length; i += CHUNK) {
        const batch = writeBatch(this.firestore);
        const slice = noArchivados.slice(i, i + CHUNK);
        for (const c of slice) {
          const ref = doc(this.firestore, 'checklists', c.id);
          batch.set(ref, {
            archivado: true,
            archivadoEn: serverTimestamp(),
            archivadoPor: adminNombre,
            archivadoMes: yyyymm
          }, { merge: true });
        }
        await batch.commit();
        // FERROCARRIL Etapa 3: replica el archivado en Postgres (serverTimestamp -> epoch ms).
        for (const c of slice) {
          await this.api.patchChecklist(String(c.id), { archivado: true, archivadoEn: Date.now(), archivadoPor: adminNombre, archivadoMes: yyyymm });
        }
        hechos += slice.length;
        this.archivarProgreso.set(`${hechos} / ${total}`);
      }

      // Refrescar lista en memoria
      this.checklistsDelMes.update(arr => arr.map(c => ({
        ...c,
        archivado: true,
        archivadoMes: yyyymm,
        archivadoPor: adminNombre
      })));

      await Swal.fire({
        icon: 'success',
        title: 'Mes archivado',
        html: `Se archivaron <strong>${hechos}</strong> checklists de <strong>${mes}</strong>.<br><br>Ya no aparecerán en Auditoría ni Dashboard, pero podrás regenerar el PDF aquí cuando quieras.`,
        confirmButtonColor: '#831843'
      });
    } catch (e: any) {
      console.error('[archivarMes]', e);
      await Swal.fire({
        icon: 'error',
        title: 'Error al archivar',
        text: e?.message || 'No se pudo completar el archivado. Revisa la conexión e intenta de nuevo.',
        confirmButtonColor: '#831843'
      });
    } finally {
      this.archivandoMes.set(false);
      this.archivarProgreso.set('');
    }
  }

  // ============================================================================
  // BORRAR FOTOS DE CLOUDINARY (solo meses archivados)
  // ============================================================================
  /** Cuántos checklists del mes ya están archivados pero aún tienen fotos sin borrar. */
  archivadosConFotos = computed(() => {
    return this.checklistsDelMes().filter(c =>
      c.archivado === true && c.fotosBorradas !== true
    ).length;
  });

  /** Total de URLs de fotos a borrar en el mes (solo de checklists archivados sin limpiar). */
  fotosABorrarCount = computed(() => {
    let total = 0;
    for (const c of this.checklistsDelMes()) {
      if (c.archivado !== true) continue;
      if (c.fotosBorradas === true) continue;
      total += this.contarFotosDeChecklist(c);
    }
    return total;
  });

  /** Cuenta TODAS las URLs de fotos de un checklist (sin importar dónde estén). */
  private contarFotosDeChecklist(c: any): number {
    let n = 0;
    if (Array.isArray(c.items)) {
      for (const it of c.items) {
        n += this.extraerFotos(it).length;
      }
    }
    return n;
  }

  /** Extrae el public_id de Cloudinary a partir de una secure_url. Devuelve null si no parece de Cloudinary. */
  private publicIdDeUrl(url: string): string | null {
    if (!url || typeof url !== 'string') return null;
    if (!url.includes('cloudinary.com')) return null;
    const idx = url.indexOf('/upload/');
    if (idx < 0) return null;
    let rest = url.slice(idx + '/upload/'.length);
    // Quitar transformaciones (todo lo que esté antes del /v\d+/)
    const vIdx = rest.search(/v\d+\//);
    if (vIdx >= 0) {
      rest = rest.slice(vIdx);
      rest = rest.replace(/^v\d+\//, '');
    }
    // Quitar query string si la hay
    const qIdx = rest.indexOf('?');
    if (qIdx >= 0) rest = rest.slice(0, qIdx);
    // Quitar extensión
    rest = rest.replace(/\.[a-z0-9]{2,5}$/i, '');
    return rest || null;
  }

  /**
   * Borra DEFINITIVAMENTE de Cloudinary todas las fotos de los checklists archivados
   * del mes seleccionado (que aún no hayan sido borradas).
   * Pasa por el endpoint serverless /api/cloudinary-cleanup que firma con el api_secret.
   * Triple confirmación: aviso fuerte + escribir BORRAR FOTOS + confirmación de no retorno.
   */
  async borrarFotosCloudinary(): Promise<void> {
    if (!this.esAdminGlobal()) return;
    if (this.borrandoFotos()) return;

    const candidatos = this.checklistsDelMes().filter(c =>
      c.archivado === true && c.fotosBorradas !== true
    );
    if (candidatos.length === 0) {
      await Swal.fire({
        icon: 'info',
        title: 'Nada por borrar',
        text: 'No hay checklists archivados con fotos pendientes de limpiar en este mes.',
        confirmButtonColor: '#831843'
      });
      return;
    }

    // Recolectar todos los public_ids
    const tareas: { checklistId: string; publicIds: string[] }[] = [];
    let totalFotos = 0;
    for (const c of candidatos) {
      const ids: string[] = [];
      if (Array.isArray(c.items)) {
        for (const it of c.items) {
          for (const url of this.extraerFotos(it)) {
            const pid = this.publicIdDeUrl(url);
            if (pid) ids.push(pid);
          }
        }
      }
      if (ids.length > 0) {
        tareas.push({ checklistId: c.id, publicIds: ids });
        totalFotos += ids.length;
      }
    }

    if (totalFotos === 0) {
      await Swal.fire({
        icon: 'info',
        title: 'Sin fotos válidas',
        text: 'No se encontraron URLs de Cloudinary válidas en los checklists archivados.',
        confirmButtonColor: '#831843'
      });
      return;
    }

    const mes = this.mesEtiqueta();

    // PASO 1: Aviso fuerte
    const paso1 = await Swal.fire({
      icon: 'warning',
      title: `Borrar ${totalFotos} fotos de Cloudinary`,
      html: `
        <div style="text-align:left; font-size:14px; line-height:1.55;">
          <p style="margin:0 0 10px 0;">Vas a borrar <strong>${totalFotos} fotos</strong> de <strong>${tareas.length} checklists</strong> archivados de <strong>${mes}</strong>.</p>
          <p style="margin:0 0 10px 0; color:#B91C1C;"><strong>Esta acción es DEFINITIVA. Cloudinary no tiene papelera.</strong></p>
          <p style="margin:0 0 10px 0;">Después de borrar:</p>
          <ul style="margin:0 0 12px 18px; padding:0;">
            <li>Las fotos del PDF que ya descargaste <strong>siguen ahí</strong> (van embebidas dentro del PDF).</li>
            <li>Si regeneras el PDF de este mes, las fotos saldrán como <strong>huecos vacíos</strong>.</li>
            <li>Liberarás espacio en tu cuenta de Cloudinary.</li>
          </ul>
          <p style="margin:0; color:#831843;"><strong>¿Confirmas que ya tienes el PDF mensual descargado y respaldado?</strong></p>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Sí, tengo el PDF respaldado',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#B91C1C',
      cancelButtonColor: '#64748b'
    });
    if (!paso1.isConfirmed) return;

    // PASO 2: Input "BORRAR FOTOS"
    const paso2 = await Swal.fire({
      title: 'Confirmación final',
      html: `<div style="text-align:left; font-size:14px;">Escribe <strong>BORRAR FOTOS</strong> en mayúsculas para confirmar.</div>`,
      input: 'text',
      inputPlaceholder: 'BORRAR FOTOS',
      showCancelButton: true,
      confirmButtonText: 'Borrar definitivamente',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#B91C1C',
      cancelButtonColor: '#64748b',
      inputValidator: (val) => {
        if (val !== 'BORRAR FOTOS') return 'Debes escribir exactamente BORRAR FOTOS.';
        return null;
      }
    });
    if (!paso2.isConfirmed) return;

    // EJECUCIÓN: enviar en lotes de 100 al endpoint
    this.borrandoFotos.set(true);
    this.borrarFotosProgreso.set(`0 / ${totalFotos}`);

    try {
      // Aplanar todos los publicIds + mapeo inverso a checklist
      const todosLosIds: string[] = [];
      const idsPorChecklist: Map<string, Set<string>> = new Map();
      for (const t of tareas) {
        idsPorChecklist.set(t.checklistId, new Set(t.publicIds));
        for (const pid of t.publicIds) todosLosIds.push(pid);
      }

      const CHUNK = 100;
      const borradosOk = new Set<string>();
      const fallidos: string[] = [];

      for (let i = 0; i < todosLosIds.length; i += CHUNK) {
        const slice = todosLosIds.slice(i, i + CHUNK);
        const resp = await fetch('/api/cloudinary-cleanup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicIds: slice })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          throw new Error(data?.error || `Error HTTP ${resp.status} del endpoint cloudinary-cleanup.`);
        }
        const deleted = (data && data.deleted) || {};
        for (const pid of slice) {
          const estado = deleted[pid];
          if (estado === 'deleted' || estado === 'not_found') {
            borradosOk.add(pid);
          } else {
            fallidos.push(pid);
          }
        }
        this.borrarFotosProgreso.set(`${borradosOk.size + fallidos.length} / ${totalFotos}`);
      }

      // Marcar como fotosBorradas SOLO los checklists cuyos public_ids quedaron TODOS limpios
      const batch = writeBatch(this.firestore);
      let checklistsMarcados = 0;
      for (const t of tareas) {
        const todosOk = t.publicIds.every(pid => borradosOk.has(pid));
        if (todosOk) {
          const ref = doc(this.firestore, 'checklists', t.checklistId);
          batch.set(ref, {
            fotosBorradas: true,
            fotosBorradasEn: serverTimestamp(),
            fotosBorradasCount: t.publicIds.length
          }, { merge: true });
          checklistsMarcados++;
        }
      }
      if (checklistsMarcados > 0) await batch.commit();
      // FERROCARRIL Etapa 3: replica fotosBorradas en Postgres (serverTimestamp -> epoch ms).
      for (const t of tareas) {
        if (t.publicIds.every(pid => borradosOk.has(pid))) {
          await this.api.patchChecklist(String(t.checklistId), { fotosBorradas: true, fotosBorradasEn: Date.now(), fotosBorradasCount: t.publicIds.length });
        }
      }

      // Refrescar memoria local
      this.checklistsDelMes.update(arr => arr.map(c => {
        if (c.archivado !== true) return c;
        const tarea = tareas.find(t => t.checklistId === c.id);
        if (!tarea) return c;
        const todosOk = tarea.publicIds.every(pid => borradosOk.has(pid));
        if (todosOk) return { ...c, fotosBorradas: true };
        return c;
      }));

      if (fallidos.length === 0) {
        await Swal.fire({
          icon: 'success',
          title: 'Fotos borradas',
          html: `Se borraron <strong>${borradosOk.size}</strong> fotos de Cloudinary y se marcaron <strong>${checklistsMarcados}</strong> checklists como limpios.`,
          confirmButtonColor: '#831843'
        });
      } else {
        await Swal.fire({
          icon: 'warning',
          title: 'Borrado parcial',
          html: `Se borraron <strong>${borradosOk.size}</strong> fotos correctamente y <strong>${fallidos.length}</strong> fallaron. Los checklists cuyas fotos no se borraron completamente quedan marcados para reintentar después.`,
          confirmButtonColor: '#831843'
        });
      }
    } catch (e: any) {
      console.error('[borrarFotosCloudinary]', e);
      await Swal.fire({
        icon: 'error',
        title: 'Error al borrar fotos',
        html: `<p>${(e?.message || 'Error desconocido').toString().replace(/</g, '&lt;')}</p><p style="font-size:11px;color:#64748B">Revisa que las variables de entorno CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET estén configuradas en Vercel.</p>`,
        confirmButtonColor: '#831843'
      });
    } finally {
      this.borrandoFotos.set(false);
      this.borrarFotosProgreso.set('');
    }
  }
}
