import { Component, signal, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router'; 
import { Firestore, collection, onSnapshot } from '@angular/fire/firestore';

@Component({
  selector: 'app-checkstore',
  standalone: true,
  imports: [CommonModule, RouterModule], 
  templateUrl: './checkstore.html', 
  styleUrls: ['./checkstore.css'] 
})
export class CheckstoreComponent implements OnInit, OnDestroy {
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

  currentUser: any = null;
  sucursalesPermitidas: string[] = [];
  
  comerciales = signal<any[]>([]);
  administrativas = signal<any[]>([]);

  sucursalesComerciales = [
    { name: 'Canindo', location: 'Sucursal Canindo', icon: '🏪' },
    { name: 'La Piedad Abastos', location: 'Mercado de Abastos', icon: '🛍️' },
    { name: '8 Esquinas', location: 'Zona 8 Esquinas', icon: '🏬' },
    { name: 'Padre Hidalgo', location: 'Av. Padre Hidalgo', icon: '🏢' },
    { name: 'Morelia Madero', location: 'Av. Madero', icon: '🏛️' },
    { name: 'Morelia Abastos', location: 'Mercado de Abastos', icon: '🛒' },
    { name: 'Yurécuaro', location: 'Sucursal Yurécuaro', icon: '🏪' },
    { name: 'Zamora Centro', location: 'Centro, Zamora', icon: '🏙️' }
  ];

  sucursalesAdministrativas = [
    { name: 'OFICINAS CORPORATIVAS', location: 'Dirección General', icon: '💼' },
    { name: 'CAJA GENERAL', location: 'Finanzas y Valores', icon: '💰' },
    { name: 'COMPRAS', location: 'Proveedores e Insumos', icon: '📦' },
    { name: 'CONTABILIDAD', location: 'Gestión Fiscal', icon: '📈' },
    { name: 'FINANZAS', location: 'Estrategia y Capital', icon: '🏦' },
    { name: 'SISTEMAS', location: 'Soporte y TI', icon: '💻' },
    { name: 'RH', location: 'Recursos Humanos', icon: '👥' },
    { name: 'MKT', location: 'Mercadotecnia y Publicidad', icon: '📢' },
    { name: 'MANTENIMIENTO', location: 'Soporte de Infraestructura', icon: '🛠️' }
  ];

  private firestore = inject(Firestore);
  private destructoresRadares: (() => void)[] = [];

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) {
      this.currentUser = JSON.parse(sesion);
      this.determinarSucursalesPermitidas();
    }
    this.conectarRadarNube(); 
  }

  ngOnDestroy() {
    this.destructoresRadares.forEach(apagarRadar => apagarRadar());
  }

  determinarSucursalesPermitidas() {
    if (!this.currentUser) return;

    if (this.currentUser.rol === 'admin' || (this.currentUser.sucursales && this.currentUser.sucursales.includes('Todas las sucursales'))) {
      this.sucursalesPermitidas = [
        ...this.sucursalesComerciales.map(s => s.name),
        ...this.sucursalesAdministrativas.map(s => s.name)
      ];
    } else {
      this.sucursalesPermitidas = this.currentUser.sucursales || [this.currentUser.sucursal || ''];
    }

    const comercialesFiltradas = this.sucursalesComerciales.filter(s => this.sucursalesPermitidas.includes(s.name));
    const administrativasFiltradas = this.sucursalesAdministrativas.filter(s => this.sucursalesPermitidas.includes(s.name));

    this.comerciales.set(comercialesFiltradas.map(s => ({...s, progress: 0, color: 'var(--red)', totalChecklists: 0, completedItems: 0, totalItems: 0})));
    this.administrativas.set(administrativasFiltradas.map(s => ({...s, progress: 0, color: 'var(--red)', totalChecklists: 0, completedItems: 0, totalItems: 0})));
  }

  conectarRadarNube() {
    const checklistsRef = collection(this.firestore, 'checklists');

    const radarChecklists = onSnapshot(checklistsRef, (snapshot) => {
      const checklists: any[] = [];
      const ahora = Date.now();
      const limite24h = 24 * 60 * 60 * 1000;
      
      const offset = new Date().getTimezoneOffset() * 60000;
      const fechaHoyLocal = new Date(Date.now() - offset).toISOString().split('T')[0];

      snapshot.forEach(docSnap => {
        const c: any = docSnap.data();

        // 🔥 ESCUDO 1: Ignorar los checklists zombies eliminados
        if (c.eliminado === true) return;

        // 🔥 ESCUDO 2: Corrección Matemática anti-NaN
        const tiempoCreacion = typeof c.id === 'number' ? c.id : (c.timestampCreacion || ahora);
        
        if (c.date === fechaHoyLocal || (ahora - tiempoCreacion) <= limite24h) {
          checklists.push(c);
        }
      });

      const calcularDatos = (listaBase: any[]) => {
        const listaPermitida = listaBase.filter(sucursal => this.sucursalesPermitidas.includes(sucursal.name));

        return listaPermitida.map(sucursal => {
          const storeChecklists = checklists.filter(c => c.store === sucursal.name);
          let totalItems = 0;
          let completedItems = 0;

          storeChecklists.forEach(c => {
            if (c.items && Array.isArray(c.items)) {
              c.items.forEach((item: any) => {
                totalItems++;
                const completo = item.checked && (!item.requiresPhoto || (item.photo !== null && item.photo !== ''));
                if (completo) {
                  completedItems++;
                }
              });
            }
          });

          const progress = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
          let color = 'var(--red)'; 
          if (progress >= 80) color = 'var(--green)'; 
          else if (progress >= 50) color = 'var(--gold)'; 

          return {
            ...sucursal,
            totalChecklists: storeChecklists.length,
            completedItems,
            totalItems,
            progress,
            color
          };
        });
      };

      this.comerciales.set(calcularDatos(this.sucursalesComerciales));
      this.administrativas.set(calcularDatos(this.sucursalesAdministrativas));
    });
    
    this.destructoresRadares.push(radarChecklists);
  }
}