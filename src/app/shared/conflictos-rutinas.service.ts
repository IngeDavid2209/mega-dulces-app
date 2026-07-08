import { Injectable, inject, signal, computed } from '@angular/core';
import { Firestore, onSnapshot, doc } from '@angular/fire/firestore';

import { ApiService } from './api.service';
import { UsuariosService } from './usuarios.service';
import { analizarConflictos } from './conflictos-rutinas.util';
import { rangoDias } from './programacion.util';
import { ConfigTurnos } from './turnos.util';
import { AsignacionRutina } from './asignaciones.types';
import { RutinaMaestra } from './rutinas.types';

/**
 * Servicio compartido que mantiene el conteo de conflictos de rutinas
 * (próximos 7 días) para mostrarlo como badge en el menú. Refcontado: solo abre
 * los listeners mientras alguien lo usa (lo inicia el sidebar para admins).
 */
@Injectable({ providedIn: 'root' })
export class ConflictosRutinasService {
  private firestore = inject(Firestore);
  private api = inject(ApiService);
  private usuariosSvc = inject(UsuariosService);
  private refs = 0;
  private unsub: (() => void)[] = [];

  asignaciones = signal<AsignacionRutina[]>([]);
  catalogo = signal<RutinaMaestra[]>([]);
  descansos = signal<any[]>([]);
  configTurnos = signal<ConfigTurnos | null>(null);

  count = computed(() => analizarConflictos({
    asignaciones: this.asignaciones(),
    catalogo: this.catalogo(),
    usuarios: this.usuariosSvc.usuarios() || [],
    descansos: this.descansos(),
    configTurnos: this.configTurnos(),
    rango: rangoDias(new Date(), 7)
  }).length);

  iniciar() {
    this.refs++;
    if (this.refs > 1) return;
    this.usuariosSvc.iniciar();
    // FERROCARRIL: poll a Postgres (antes onSnapshot).
    const recargarAsignaciones = async () => {
      const resp = await this.api.get('/api/asignaciones-rutinas').catch((e: any) => { console.error('[conflictos-rutinas.service] poll asignaciones', e); return null; });
      if (!resp) return;
      const items: any[] = resp.items || [];
      const a: AsignacionRutina[] = [];
      items.forEach((x: any) => { if (x.activa !== false) a.push({ ...x, id: x.id }); });
      this.asignaciones.set(a);
    };
    recargarAsignaciones();
    const idAsignaciones = setInterval(recargarAsignaciones, 20000);
    this.unsub.push(() => clearInterval(idAsignaciones));

    // FERROCARRIL: poll a Postgres (antes onSnapshot).
    const recargarCatalogo = async () => {
      const resp = await this.api.get('/api/catalogo-rutinas').catch((e: any) => { console.error('[conflictos-rutinas.service] poll catalogo', e); return null; });
      if (!resp) return;
      const items: any[] = resp.items || [];
      const a: RutinaMaestra[] = [];
      items.forEach((x: any) => a.push({ ...x, id: x.id }));
      this.catalogo.set(a);
    };
    recargarCatalogo();
    const idCatalogo = setInterval(recargarCatalogo, 20000);
    this.unsub.push(() => clearInterval(idCatalogo));

    // FERROCARRIL: poll a Postgres (antes onSnapshot).
    const recargarDescansos = async () => {
      const resp = await this.api.get('/api/descansos-semanales').catch((e: any) => { console.error('[conflictos-rutinas.service] poll descansos', e); return null; });
      if (!resp) return;
      const items: any[] = resp.items || [];
      const a: any[] = [];
      items.forEach((x: any) => a.push({ ...x, id: x.id }));
      this.descansos.set(a);
    };
    recargarDescansos();
    const idDescansos = setInterval(recargarDescansos, 20000);
    this.unsub.push(() => clearInterval(idDescansos));

    this.unsub.push(onSnapshot(doc(this.firestore, 'config', 'turnos'), s => {
      this.configTurnos.set(s.exists() ? (s.data() as ConfigTurnos) : null);
    }));
  }

  detener() {
    this.refs = Math.max(0, this.refs - 1);
    if (this.refs === 0) {
      this.unsub.forEach(u => u());
      this.unsub = [];
      this.usuariosSvc.detener();
    }
  }
}
