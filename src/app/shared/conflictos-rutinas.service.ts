import { Injectable, inject, signal, computed } from '@angular/core';
import { Firestore, collection, onSnapshot, doc } from '@angular/fire/firestore';

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
    this.unsub.push(onSnapshot(collection(this.firestore, 'asignaciones_rutinas'), s => {
      const a: AsignacionRutina[] = [];
      s.forEach(d => { const x = d.data() as any; if (x.activa !== false) a.push({ ...x, id: d.id }); });
      this.asignaciones.set(a);
    }));
    this.unsub.push(onSnapshot(collection(this.firestore, 'catalogo_rutinas'), s => {
      const a: RutinaMaestra[] = [];
      s.forEach(d => a.push({ ...(d.data() as any), id: d.id }));
      this.catalogo.set(a);
    }));
    this.unsub.push(onSnapshot(collection(this.firestore, 'descansos_semanales'), s => {
      const a: any[] = [];
      s.forEach(d => a.push({ ...(d.data() as any), id: d.id }));
      this.descansos.set(a);
    }));
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
