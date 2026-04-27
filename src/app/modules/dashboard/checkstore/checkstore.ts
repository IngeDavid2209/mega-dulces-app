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
  areasTrabajo = signal<any[]>([]); // 🔥 AHORA EMPIEZA VACÍO PARA LLENARSE DESDE FIREBASE 🔥

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

  // Variables para guardar los datos puros de Firebase antes de la matemática
  areasDesdeFirebase: any[] = [];
  checklistsDesdeFirebase: any[] = [];

  private firestore = inject(Firestore);
  private destructoresRadares: (() => void)[] = [];

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) {
      this.currentUser = JSON.parse(sesion);
      this.determinarSucursalesPermitidas();
    }
    this.conectarRadaresNube(); // 🔥 AHORA CONECTA 2 RADARES EN VEZ DE 1 🔥
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
  }

  conectarRadaresNube() {
    // 🔥 RADAR 1: ESCANEA TUS ÁREAS DE TRABAJO DINÁMICAS (NUEVO) 🔥
    const areasRef = collection(this.firestore, 'areas'); // ⚠️ OJO: Cambia 'areas' si tu colección se llama diferente
    const radarAreas = onSnapshot(areasRef, (snapshot) => {
      const areasTemp: any[] = [];
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        // Asumimos que guardaste el nombre del área en 'nombre' o 'name'
        const nombreArea = data['nombre'] || data['name'] || 'Área Desconocida';
        areasTemp.push({
          name: nombreArea,
          location: 'Área Interna',
          color: '#D97706', // El naranja corporativo
          progress: 0, totalChecklists: 0, completedItems: 0, totalItems: 0
        });
      });
      
      this.areasDesdeFirebase = areasTemp;
      
      // Si es administrador, le damos permiso automático de ver todas las áreas nuevas
      if (this.currentUser?.rol === 'admin' || (this.currentUser?.sucursales && this.currentUser?.sucursales.includes('Todas las sucursales'))) {
         areasTemp.forEach(a => {
           if (!this.sucursalesPermitidas.includes(a.name)) {
             this.sucursalesPermitidas.push(a.name);
           }
         });
      }

      this.procesarMatematicas();
    });

    // 🔥 RADAR 2: ESCANEA LOS CHECKLISTS Y TAREAS (TU CÓDIGO ORIGINAL INTACTO) 🔥
    const checklistsRef = collection(this.firestore, 'checklists');
    const radarChecklists = onSnapshot(checklistsRef, (snapshot) => {
      const checklistsTemp: any[] = [];
      const ahora = Date.now();
      const limite24h = 24 * 60 * 60 * 1000;
      const offset = new Date().getTimezoneOffset() * 60000;
      const fechaHoyLocal = new Date(Date.now() - offset).toISOString().split('T')[0];

      snapshot.forEach(docSnap => {
        const c: any = docSnap.data();
        if (c.eliminado === true) return;
        const tiempoCreacion = typeof c.id === 'number' ? c.id : (c.timestampCreacion || ahora);

        if (c.date === fechaHoyLocal || (ahora - tiempoCreacion) <= limite24h) {
          checklistsTemp.push(c);
        }
      });

      // Escudo Anti-Clones
      const listasSinClones = new Map();
      checklistsTemp.forEach(c => {
        const marcados = c.items ? c.items.filter((i:any) => i.checked).length : 0;
        c.calcProgreso = c.items && c.items.length > 0 ? Math.round((marcados / c.items.length) * 100) : 0;
        const firma = `${c.name}_${c.assigned}_${c.store}_${c.date}`;
        
        if (!listasSinClones.has(firma)) {
          listasSinClones.set(firma, c);
        } else {
          const existente = listasSinClones.get(firma);
          if (c.calcProgreso > existente.calcProgreso) {
            listasSinClones.set(firma, c);
          }
        }
      });

      this.checklistsDesdeFirebase = Array.from(listasSinClones.values());
      this.procesarMatematicas();
    });

    this.destructoresRadares.push(radarAreas);
    this.destructoresRadares.push(radarChecklists);
  }

  // 🔥 EL CEREBRO MATEMÁTICO CENTRALIZADO 🔥
  procesarMatematicas() {
    const calcularDatos = (listaBase: any[], defaultColor: string) => {
      // Filtramos las que tiene permitidas ver el usuario
      const listaPermitida = listaBase.filter(item => this.sucursalesPermitidas.includes(item.name));
      
      return listaPermitida.map(sucursal => {
        const storeChecklists = this.checklistsDesdeFirebase.filter(c => c.store === sucursal.name);
        let totalItems = 0;
        let completedItems = 0;
        
        storeChecklists.forEach(c => {
          if (c.items && Array.isArray(c.items)) {
            c.items.forEach((item: any) => {
              totalItems++;
              if (item.checked === true) {
                completedItems++;
              }
            });
          }
        });

        const progress = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
        
        let finalColor = defaultColor;
        if(defaultColor === 'var(--red)') { 
           // Solo aplicamos el semáforo rojo/amarillo/verde a comerciales y admin
           if (progress >= 80) finalColor = 'var(--green)';
           else if (progress >= 50) finalColor = 'var(--gold)';
        } else {
           // Las tarjetas de áreas operativas se quedan siempre en su naranja corporativo
           finalColor = defaultColor; 
        }

        return {
          ...sucursal,
          totalChecklists: storeChecklists.length,
          completedItems,
          totalItems,
          progress,
          color: finalColor
        };
      });
    };

    // Actualizamos las 3 filas visuales
    this.comerciales.set(calcularDatos(this.sucursalesComerciales, 'var(--red)'));
    this.administrativas.set(calcularDatos(this.sucursalesAdministrativas, 'var(--red)'));
    this.areasTrabajo.set(calcularDatos(this.areasDesdeFirebase, '#D97706'));
  }
}