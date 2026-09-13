/**
 * 📋 PASE DE LISTA — quién ocupa cada plaza hoy
 *
 * Es la pieza que faltaba para que «entrar como Anaquelista 1» sea posible sin
 * perder el nombre de quien firma. El §4 lo dice así: «identidad (cobertura, no
 * nombre escrito)».
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  QUIÉN EDITA AQUÍ NO ES QUIEN EDITA LA PLANTILLA, Y ES DELIBERADO
 * ═══════════════════════════════════════════════════════════════════════════
 * La PLANTILLA la captura Dirección: cuántas plazas se autorizan es una
 * decisión de la empresa. El PASE DE LISTA lo hace la Encargada: quién cubre
 * hoy es una decisión de su turno, y pedirle a Dirección que la capture haría
 * que nadie la capturara nunca.
 *
 * Así que aquí edita quien sea jefatura **y tenga esa sucursal en su alcance**.
 * La lista de sucursales ya viene recortada por `sucursalesPermitidas()`, pero
 * la comprobación se repite antes de escribir: que una sucursal no salga en un
 * `<select>` es cosmética, no un permiso.
 *
 * ─── EL MANUAL YA AUTORIZA ESTE TRABAJO ───────────────────────────────────
 * No hace falta norma nueva: el punto 8 del Checklist de apertura del Encargado
 * dice «Tareas del día asignadas en Mega Dulces Task», y el punto 7 de su
 * operación, «Ausencias cubiertas». Esto es la pantalla de lo que el manual ya
 * le pide hacer.
 *
 * ─── LO QUE NO HACE ───────────────────────────────────────────────────────
 * No crea cuentas, no toca el login y no cambia cómo entra nadie. Eso es el
 * paso siguiente, y sin esta pantalla llena no se puede dar: una cuenta de
 * plaza sin cobertura registrada pierde el nombre de quien firmó, que es el
 * problema del correo compartido de las migraciones 051-053.
 */
import { Component, signal, computed, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../shared/api.service';
import { sucursalesElegibles } from '../../../shared/sucursales-elegibles.util';
import { conTope, mensajeDeFallo } from '../../../shared/con-tope.util';
import { SidebarComponent } from '../../../shared/sidebar/sidebar';
import { esAdminGlobal, sucursalesPermitidas } from '../../../shared/permisos.util';
import { esJefatura } from '../../../shared/alcance.util';
import { nombrePuesto } from '../../../shared/organigrama.catalogo';
import { resolverPuesto } from '../../../shared/puesto.util';
import {
  pasarLista, resumenDelDia, planDeAsignacion, nombrePlaza, plazaDeTemporada,
  Plaza, Cobertura, PlazaDelDia, ResumenDia,
} from '../../../shared/cobertura.util';

function hoyISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

@Component({
  selector: 'app-pase-lista',
  standalone: true,
  imports: [CommonModule, FormsModule, SidebarComponent],
  templateUrl: './pase-lista.html',
  styleUrls: ['./pase-lista.css'],
})
export class PaseListaComponent implements OnInit {
  private api = inject(ApiService);

  currentUser: any = null;

  /** El cajon del menu en movil. Lo monta esta pantalla desde que dejo
   *  de ser pestaña de /control. */
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }
  cargando = signal(true);
  error = signal<string | null>(null);
  guardando = signal(false);
  aviso = signal<string | null>(null);

  usuarios = signal<any[]>([]);
  plazas = signal<Plaza[]>([]);
  coberturas = signal<Cobertura[]>([]);
  sucursal = signal<string>('');
  fecha = signal<string>(hoyISO());

  /** Fila abierta para editar, por id de plaza. Solo una a la vez. */
  editando = signal<string | null>(null);
  elegido = signal<string>('');
  motivo = signal<string>('');

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    try { this.currentUser = sesion ? JSON.parse(sesion) : null; } catch { this.currentUser = null; }
    this.cargar();
  }

  private async cargar() {
    this.cargando.set(true);
    this.error.set(null);
    try {
      // Con tope y con el nombre del paso: ver la nota de plantilla.ts.
      const [us, pz, cb] = await Promise.all([
        conTope(this.api.get('/api/usuarios'), 20000, 'leer las personas'),
        conTope(this.api.get('/api/plazas'), 20000, 'leer las plazas'),
        conTope(this.api.get('/api/coberturas'), 20000, 'leer quién cubre cada plaza'),
      ]);
      this.usuarios.set(us?.items || us || []);
      this.plazas.set((pz?.items || pz || []) as Plaza[]);
      this.coberturas.set((cb?.items || cb || []) as Cobertura[]);
      const dispo = this.sucursales();
      if (dispo.length && !this.sucursal()) this.sucursal.set(dispo[0]);
    } catch (e: any) {
      this.error.set(mensajeDeFallo(e));
    } finally {
      this.cargando.set(false);
    }
  }

  /**
   * Las sucursales que se pueden elegir.
   *
   * La regla vive en `sucursales-elegibles.util.ts` y NO se copia aquí: estaba
   * escrita dos veces —esta pantalla y la otra— y el mismo bug del selector
   * vacío se arregló dos veces sin quedar arreglado.
   */
  sucursales = computed<string[]>(() =>
    sucursalesElegibles(this.currentUser, this.plazas(), this.usuarios()));

  /**
   * ¿Puede esta persona pasar lista en la sucursal elegida?
   *
   * Se comprueba con la MISMA función que recorta el selector, y se vuelve a
   * llamar antes de cada escritura: que una sucursal no aparezca en la lista no
   * impide que alguien llame al endpoint.
   */
  puedeAsignar = computed<boolean>(() => {
    const suc = this.sucursal();
    if (!suc) return false;
    if (esAdminGlobal(this.currentUser)) return true;
    if (!esJefatura(this.currentUser)) return false;
    const permitidas = sucursalesPermitidas(this.currentUser);
    return !permitidas || permitidas.map(s => s.trim()).includes(suc);
  });

  plazasDeLaSucursal = computed<Plaza[]>(() =>
    this.plazas().filter(p => p?.lugar === this.sucursal()));

  lista = computed<PlazaDelDia[]>(() =>
    pasarLista(this.plazasDeLaSucursal(), this.coberturas(), this.fecha()));

  resumen = computed<ResumenDia>(() => resumenDelDia(this.lista()));

  /** Las personas de esta sucursal, para el selector. */
  personas = computed(() => {
    const suc = this.sucursal();
    return this.usuarios()
      .filter(u => {
        if (u?.activo === false) return false;
        const suyas = (u?.datos?.sucursales || u?.sucursales || [])
          .map((s: any) => String(s || '').trim());
        return suyas.includes(suc);
      })
      .map(u => ({
        id: String(u.id),
        nombre: String(u.nombre || u.usuario || '(sin nombre)'),
        puesto: resolverPuesto(u).puestoId || '',
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  /** El nombre de quien cubre una plaza, para pintarlo. */
  nombreDe(uid: string | null): string {
    if (!uid) return '';
    const u = this.usuarios().find(x => String(x?.id) === String(uid));
    // Si la ficha ya no existe, se dice — no se deja el renglón vacío, que se
    // leería como «nadie» cuando en realidad es «no la encuentro».
    return u ? String(u.nombre || u.usuario || uid) : `(ficha ${uid} no encontrada)`;
  }

  etiquetaPlaza(p: Plaza): string {
    return nombrePlaza(nombrePuesto(p.puestoId) || p.puestoId, p.numero);
  }

  esTemporada(p: Plaza): boolean { return plazaDeTemporada(p); }

  abrir(plazaId: string) {
    this.editando.set(this.editando() === plazaId ? null : plazaId);
    this.elegido.set('');
    this.motivo.set('');
    this.aviso.set(null);
  }

  // ── Escrituras ───────────────────────────────────────────────────────────

  async asignar(plazaId: string, tipo: Cobertura['tipo']) {
    if (!this.puedeAsignar()) return;
    const uid = tipo === 'hueco' ? null : (this.elegido() || null);
    const plan = planDeAsignacion(plazaId, uid, tipo, this.fecha(), this.coberturas(),
      { motivo: this.motivo().trim() });

    // «No hice nada» se dice, no se calla. Un botón que no responde se lee como
    // que la app está rota.
    if (plan.sinCambios) { this.aviso.set(plan.sinCambios); return; }

    this.guardando.set(true);
    this.aviso.set(null);
    try {
      // Primero los cierres: si se creara antes la nueva, habría un instante con
      // dos coberturas abiertas y el índice único de la 056 rechazaría la
      // escritura. El orden no es estilo, es lo que hace que funcione.
      for (const c of plan.cerrar) {
        await this.api.parchar('/api/coberturas', c.id, { hasta: c.hasta });
      }
      for (const c of plan.crear) {
        await this.api.guardar('/api/coberturas', {
          id: c.id, plazaId: c.plazaId, uid: c.uid, tipo: c.tipo,
          desde: c.desde, hasta: c.hasta, motivo: c.motivo, creadaEn: c.creadaEn,
          creadaPor: this.currentUser?.nombre || this.currentUser?.usuario || '',
        });
      }
      this.editando.set(null);
      await this.cargar();
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudo guardar.');
    } finally { this.guardando.set(false); }
  }

  claseEstado(e: string): string { return 'pa-' + e; }

  textoEstado(p: PlazaDelDia): string {
    switch (p.estado) {
      case 'cubierta':    return 'titular';
      case 'suplencia':   return 'suplencia';
      case 'hueco':       return 'hueco' + (p.motivo ? ' · ' + p.motivo : '');
      case 'sin_asignar': return 'sin asignar';
    }
  }

  trackPlaza = (_: number, p: PlazaDelDia) => p.plaza.id;
}
