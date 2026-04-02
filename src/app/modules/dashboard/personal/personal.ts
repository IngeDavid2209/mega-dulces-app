import { Component, signal, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router'; 
import { Auth, createUserWithEmailAndPassword } from '@angular/fire/auth'; 
import { Firestore, collection, doc, setDoc, deleteDoc, onSnapshot } from '@angular/fire/firestore';

@Component({
  selector: 'app-personal',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
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
  isModalOpen = false;

  // Formulario
  formNombre = ''; formUsuario = ''; formCorreo = ''; formPassword = '';
  formRol = 'trabajador'; formCargo = 'Trabajador General'; 
  
  // 🔥 PERMISOS
  formPuedeCrearChecklists = false; 
  formPuedeCrearRutinas = false;       // 🔥 NUEVO: Rutinas
  formPuedeCrearTareasUnicas = false;  // 🔥 NUEVO: Tareas Únicas
  formPuedeVerCheckstore = false;
  formPuedeVerEstadisticas = false; 
  formPuedeVerHistorial = false; 
  formPuedeAdministrarPersonal = false;
  
  formSucursales: string[] = []; 

  sucursalesDisponibles = [
    'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
    'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro',
    'OFICINAS CORPORATIVAS', 'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD', 'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO'
  ];

  private auth = inject(Auth);
  private firestore = inject(Firestore); 
  private router = inject(Router); 
  private destructoresRadares: (() => void)[] = [];

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) { this.currentUser = JSON.parse(sesion); }
    this.conectarConLaNube();
  }

  ngOnDestroy() {
    this.destructoresRadares.forEach(apagarRadar => apagarRadar());
  }

  conectarConLaNube() {
    const usuariosRef = collection(this.firestore, 'usuarios');
    const radarPersonal = onSnapshot(usuariosRef, (snapshot) => {
      if (snapshot.metadata.hasPendingWrites) return; 

      const usuariosNube: any[] = [];
      snapshot.forEach((documento) => {
        usuariosNube.push(documento.data());
      });

      if (JSON.stringify(this.usuarios()) !== JSON.stringify(usuariosNube)) {
        this.usuarios.set(usuariosNube);
      }
    });
    this.destructoresRadares.push(radarPersonal);
  }

  getAdmins() { 
    return this.usuarios().filter(u => u.rol === 'admin' && 
      (u.nombre.toLowerCase().includes(this.terminoBusqueda.toLowerCase()) || 
       u.cargo?.toLowerCase().includes(this.terminoBusqueda.toLowerCase())));
  }

  getTrabajadores() { 
    return this.usuarios().filter(u => u.rol === 'trabajador' && 
      (u.nombre.toLowerCase().includes(this.terminoBusqueda.toLowerCase()) || 
       u.cargo?.toLowerCase().includes(this.terminoBusqueda.toLowerCase()) ||
       (u.sucursales && u.sucursales.join(' ').toLowerCase().includes(this.terminoBusqueda.toLowerCase()))));
  }

  getTrabajadoresAgrupados() {
    const trabajadores = this.getTrabajadores();
    const gruposMap = new Map<string, any[]>();
    trabajadores.forEach(user => {
      const nombreGrupo = user.sucursales?.length > 0 ? user.sucursales.join(' y ') : 'Sin Sucursal';
      if (!gruposMap.has(nombreGrupo)) gruposMap.set(nombreGrupo, []);
      gruposMap.get(nombreGrupo)!.push(user);
    });
    return Array.from(gruposMap.keys()).map(key => ({ nombre: key, usuarios: gruposMap.get(key)! }));
  }

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
    this.formRol = 'trabajador'; this.formCargo = 'Trabajador General'; 
    this.formPuedeCrearChecklists = false; 
    this.formPuedeCrearRutinas = false;      // 🔥 LIMPIAR
    this.formPuedeCrearTareasUnicas = false; // 🔥 LIMPIAR
    this.formPuedeVerCheckstore = false; 
    this.formPuedeVerEstadisticas = false; 
    this.formPuedeVerHistorial = false; 
    this.formPuedeAdministrarPersonal = false; 
    this.formSucursales = [];
  }

  editarUsuario(user: any) {
    if (this.currentUser?.rol !== 'admin' && !this.currentUser?.puedeAdministrarPersonal) return;
    this.usuarioEnEdicion = user; 
    this.formNombre = user.nombre; this.formUsuario = user.usuario;
    this.formCorreo = user.correo || ''; this.formPassword = user.password || '';
    this.formRol = user.rol; this.formCargo = user.cargo || 'Trabajador General';
    this.formSucursales = user.sucursales ? [...user.sucursales] : [];
    
    // 🔥 CARGAR PERMISOS
    this.formPuedeCrearChecklists = !!user.puedeCrearChecklists;
    this.formPuedeCrearRutinas = !!user.puedeCrearRutinas;
    this.formPuedeCrearTareasUnicas = !!user.puedeCrearTareasUnicas;
    this.formPuedeVerCheckstore = !!user.puedeVerCheckstore;
    this.formPuedeVerEstadisticas = !!user.puedeVerEstadisticas;
    this.formPuedeVerHistorial = !!user.puedeVerHistorial; 
    this.formPuedeAdministrarPersonal = !!user.puedeAdministrarPersonal;
    
    this.isModalOpen = true;
  }

  cerrarModal() { this.isModalOpen = false; this.usuarioEnEdicion = null; }

  toggleSucursal(sucursal: string) {
    const index = this.formSucursales.indexOf(sucursal);
    if (index > -1) this.formSucursales.splice(index, 1);
    else this.formSucursales.push(sucursal);
  }

  async guardarUsuario() {
    if (this.currentUser?.rol !== 'admin' && !this.currentUser?.puedeAdministrarPersonal) return; 
    
    // 🔥 FIX DE VALIDACIÓN: Si es edición, perdona si no tiene correo. Si es nuevo, sí obliga a ponerlo.
    if (!this.formNombre || !this.formUsuario || !this.formPassword) {
      alert('⚠️ Por favor completa el Nombre, Usuario y Contraseña.'); return;
    }
    
    if (!this.usuarioEnEdicion && !this.formCorreo) {
      alert('⚠️ Para crear un usuario nuevo el Correo Electrónico es obligatorio.'); return;
    }

    const payload = {
      nombre: this.formNombre, usuario: this.formUsuario, correo: this.formCorreo, password: this.formPassword,
      rol: this.formRol, cargo: this.formCargo,
      
      // 🔥 GUARDAR PERMISOS
      puedeCrearChecklists: this.formRol === 'admin' ? true : this.formPuedeCrearChecklists,
      puedeCrearRutinas: this.formRol === 'admin' ? true : this.formPuedeCrearRutinas,
      puedeCrearTareasUnicas: this.formRol === 'admin' ? true : this.formPuedeCrearTareasUnicas,
      puedeVerCheckstore: this.formRol === 'admin' ? true : this.formPuedeVerCheckstore,
      puedeVerEstadisticas: this.formRol === 'admin' ? true : this.formPuedeVerEstadisticas,
      puedeVerHistorial: this.formRol === 'admin' ? true : this.formPuedeVerHistorial,
      puedeAdministrarPersonal: this.formRol === 'admin' ? true : this.formPuedeAdministrarPersonal,
      sucursales: this.formRol === 'admin' ? ['General (Acceso Total)'] : this.formSucursales 
    };

    try {
      if (this.usuarioEnEdicion) {
        const docId = this.usuarioEnEdicion.uid || this.usuarioEnEdicion.usuario;
        await setDoc(doc(this.firestore, 'usuarios', docId), payload, { merge: true });
      } else {
        const creds = await createUserWithEmailAndPassword(this.auth, this.formCorreo, this.formPassword);
        await setDoc(doc(this.firestore, 'usuarios', creds.user.uid), { ...payload, uid: creds.user.uid });
      }
      this.cerrarModal();
      alert('✅ ¡Usuario guardado en la Nube!');
    } catch (error: any) {
      alert('❌ Error: ' + error.message);
    }
  }

  async eliminarUsuario(userToDelete: any) {
    if (this.currentUser?.rol !== 'admin' && !this.currentUser?.puedeAdministrarPersonal) return;
    if (userToDelete.usuario === this.currentUser.usuario) return;
    if (confirm(`⚠️ ¿Eliminar a ${userToDelete.nombre}?`)) {
      await deleteDoc(doc(this.firestore, 'usuarios', userToDelete.uid || userToDelete.usuario));
    }
  }

  descargarExcel() {
    const list = this.usuarios();
    if (list.length === 0) return;
    
    // 🔥 ACTUALIZAR EXCEL
    let csv = 'Nombre,Usuario,Correo,Rol,Cargo,Sucursales,Crea Check,Crea Rutinas,Crea Tareas,Ve Store,Ve Est,Ve Hist,Adm Pers\n';
    
    list.forEach(u => {
      const sucs = `"${u.sucursales ? u.sucursales.join(' - ') : ''}"`;
      csv += `"${u.nombre}","${u.usuario}","${u.correo}","${u.rol}","${u.cargo}",${sucs},${u.puedeCrearChecklists?'Sí':'No'},${u.puedeCrearRutinas?'Sí':'No'},${u.puedeCrearTareasUnicas?'Sí':'No'},${u.puedeVerCheckstore?'Sí':'No'},${u.puedeVerEstadisticas?'Sí':'No'},${u.puedeVerHistorial?'Sí':'No'},${u.puedeAdministrarPersonal?'Sí':'No'}\n`;
    });
    
    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'Personal_MegaDulces.csv';
    link.click();
  }
}