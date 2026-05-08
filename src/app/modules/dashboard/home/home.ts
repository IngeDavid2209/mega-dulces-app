import { Component, signal, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router'; 
import { Firestore, collection, onSnapshot } from '@angular/fire/firestore'; 
import { NotificacionesService } from '../../../services/notificaciones';
import { Messaging, getToken } from '@angular/fire/messaging';
import { doc, updateDoc } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';


@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterModule], 
  templateUrl: './home.html', 
  styleUrls: ['./home.css']
})
export class HomeComponent implements OnInit, OnDestroy {
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }
  currentUser: any = null; 
  
  totalChecklists = signal(0);
  sucursalesTotales = signal(17);
  enProgreso = signal(0);
  pendientes = signal(0);
  progresoGlobal = signal(0);
  
  // 🔥 NUEVO: SEÑAL PARA LAS ÁREAS DEL TRABAJADOR 🔥
  misAreasDetalle = signal<any[]>([]);

  
  // Tus herramientas inyectadas
  private firestore = inject(Firestore); 
  private notificacionesService = inject(NotificacionesService);
  private messaging = inject(Messaging); // 🔥 NUEVO: Para las notificaciones Push
  private auth = inject(Auth);           // 🔥 NUEVO: Para saber quién es el usuario

  // Tus variables
  private destructoresRadares: (() => void)[] = [];

 ngOnInit() {
    // 1. Recuperamos la sesión del usuario (tu código original)
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) {
      this.currentUser = JSON.parse(sesion);
      
      if (this.currentUser && this.currentUser.nombre) {
        // Ejecutamos tu servicio de permisos anterior
        this.notificacionesService.solicitarPermisos(this.currentUser.nombre);
        
        // 🔥 NUEVO: Activamos las Notificaciones Push de Firebase
        // Lo ideal es hacerlo aquí adentro para asegurar que ya sabemos quién es el usuario
        this.activarNotificacionesPush();
      }
    }

    // 2. Conectamos el radar (tu código original)
    this.conectarRadarNube();
  }

  ngOnDestroy() {
    this.destructoresRadares.forEach(apagarRadar => apagarRadar());
  }

  async activarNotificacionesPush() {
    try {
      const user = this.auth.currentUser;
      if (!user) return; // Si no hay usuario logueado, nos salimos

      // 1. Le pedimos permiso al navegador/celular
      const permission = await Notification.requestPermission();
      
      if (permission === 'granted') {
        console.log('✅ Permiso de notificaciones concedido por el usuario.');
        
        // 2. Generamos el Token usando tu llave pública de Firebase
        const token = await getToken(this.messaging, {
          vapidKey: 'BltRm5eYik-A2jdDOiS3nukAh41n47mYwdpfw9L_IRFUZ2L6OSEDNAo_XiYIimZFXT3Bn6-QJ4BYZoimvjlKigY'
        });

        if (token) {
          console.log('📱 Token FCM generado:', token);
          
          // 3. Guardamos este token en la base de datos del usuario
          const userRef = doc(this.firestore, `usuarios/${user.uid}`);
          await updateDoc(userRef, { 
            fcmToken: token 
          });
          
        } else {
          console.log('No se pudo generar el token. Revisa tu Service Worker.');
        }
      } else {
        console.log('❌ El usuario bloqueó las notificaciones.');
      }
    } catch (error) {
      console.error('Error al configurar notificaciones push:', error);
    }
  }

  // 🔥 RELOJ BIOLÓGICO: PARA MOSTRAR AL TRABAJADOR SI SU ÁREA ESTÁ ACTIVA 🔥
  estaAreaBloqueada(area: any): boolean {
    if (!area) return false;
    const hoy = new Date();
    
    // Si es área recurrente de todos los días
    if (area.esRecurrente && area.horaEntrada && area.horaSalida) {
      const horaActual = hoy.getHours() * 60 + hoy.getMinutes();
      const [hE, mE] = area.horaEntrada.split(':').map(Number);
      const minEntrada = hE * 60 + mE;
      const [hS, mS] = area.horaSalida.split(':').map(Number);
      const minSalida = hS * 60 + mS;

      if (minEntrada < minSalida) {
        return horaActual < minEntrada || horaActual >= minSalida;
      } else {
        return horaActual >= minSalida && horaActual < minEntrada;
      }
    }

    // Si es área de un solo día
    if (!area.fechaAsignada) return false;
    let horaLimite = "23:59:59"; 
    
    if (area.horaSalida) {
      horaLimite = area.horaSalida + ":00";
    } else if (area.turnoAsignado) {
      if (area.turnoAsignado === 'Mañana') horaLimite = "12:00:00";
      else if (area.turnoAsignado === 'Tarde') horaLimite = "18:00:00";
      else if (area.turnoAsignado === 'Noche') horaLimite = "23:59:59";
    }
    
    const fechaHoraLimite = new Date(`${area.fechaAsignada}T${horaLimite}`);
    return fechaHoraLimite < hoy; 
  }

  conectarRadarNube() {
    const checklistsRef = collection(this.firestore, 'checklists');
    const radarChecklists = onSnapshot(checklistsRef, (snapshot) => {
      const listasCrudas: any[] = [];
      const offset = new Date().getTimezoneOffset() * 60000;
      const fechaHoyLocal = new Date(Date.now() - offset).toISOString().split('T')[0];
      const limite24h = 24 * 60 * 60 * 1000;
      const ahora = Date.now();
      
      snapshot.forEach(docSnap => {
        const c: any = docSnap.data();
        if (c.eliminado === true) return;
        const tiempoCreacion = typeof c.id === 'number' ? c.id : (c.timestampCreacion || ahora);
        if (c.date === fechaHoyLocal || (ahora - tiempoCreacion) <= limite24h) {
          listasCrudas.push(c);
        }
      });
      
      const listasSinClones = new Map();
      listasCrudas.forEach(c => {
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

      const misListas = (this.currentUser?.rol === 'trabajador')
        ? Array.from(listasSinClones.values()).filter(c => c.assigned === this.currentUser.nombre)
        : Array.from(listasSinClones.values());

      let totalItems = 0;
      let itemsCompletados = 0;
      misListas.forEach(c => {
        if (c.items && Array.isArray(c.items)) {
          c.items.forEach((item: any) => {
            totalItems++;
            if (item.checked) itemsCompletados++;
          });
        }
      });
      
      const globalPct = totalItems > 0 ? Math.round((itemsCompletados / totalItems) * 100) : 0;
      this.progresoGlobal.set(globalPct); 

      const listasActivas = misListas.filter(c => c.enviado !== true);
      this.totalChecklists.set(listasActivas.length);
      
      const tareasEnProgreso = listasActivas.filter(c => {
        const stat = (c.status || '').toLowerCase();
        return stat === 'en-progreso' || stat === 'completo';
      }).length;

      this.enProgreso.set(tareasEnProgreso);
      this.pendientes.set(listasActivas.filter(c => (c.status || 'pendiente').toLowerCase() === 'pendiente').length);
    });

    this.destructoresRadares.push(radarChecklists);

    // 🔥 NUEVO RADAR: JALA LAS ÁREAS DEL TRABAJADOR Y LAS MUESTRA EN SU INICIO 🔥
    const areasRef = collection(this.firestore, 'areas_operativas');
    const radarAreas = onSnapshot(areasRef, (snapshot) => {
      const areasNube: any[] = [];
      snapshot.forEach(docSnap => areasNube.push({ ...docSnap.data(), id: docSnap.id }));

      if (this.currentUser?.rol === 'trabajador') {
        const misNombresAreas = this.currentUser.areas || [];
        // Filtra para traerse solo las áreas a las que Felipe pertenece
        const misAreasFull = areasNube.filter(a => misNombresAreas.includes(a.nombre));
        this.misAreasDetalle.set(misAreasFull);
      }
    });
    
    this.destructoresRadares.push(radarAreas);
  }
}