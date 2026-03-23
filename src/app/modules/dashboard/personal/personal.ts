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
  formNombre = '';
  formUsuario = ''; 
  formCorreo = ''; 
  formPassword = '';
  formRol = 'trabajador'; 
  formCargo = 'Trabajador General'; 
  
  formPuedeCrearChecklists = false; 
  formPuedeVerCheckstore = false;
  formPuedeVerEstadisticas = false;
  formPuedeVerHistorial = false; 
  formPuedeAdministrarPersonal = false; // 🔥 NUEVO PERMISO

  sucursalesDisponibles = [
    'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
    'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro',
    'OFICINAS CORPORATIVAS', 'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD', 'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO'
  ];
  
  formSucursales: string[] = []; 

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
      const usuariosNube: any[] = [];
      snapshot.forEach((documento) => {
        usuariosNube.push(documento.data());
      });
      this.usuarios.set(usuariosNube);
    });
    this.destructoresRadares.push(radarPersonal);
  }

  getAdmins() { 
    let admins = this.usuarios().filter(u => u.rol === 'admin'); 
    if (this.terminoBusqueda.trim()) {
      const termino = this.terminoBusqueda.toLowerCase();
      admins = admins.filter(u => 
        u.nombre.toLowerCase().includes(termino) || 
        (u.cargo && u.cargo.toLowerCase().includes(termino))
      );
    }
    return admins;
  }

  getTrabajadores() { 
    let trabajadores = this.usuarios().filter(u => u.rol === 'trabajador');
    if (this.terminoBusqueda.trim()) {
      const termino = this.terminoBusqueda.toLowerCase();
      trabajadores = trabajadores.filter(u => 
        u.nombre.toLowerCase().includes(termino) || 
        (u.cargo && u.cargo.toLowerCase().includes(termino)) ||
        (u.sucursales && u.sucursales.join(' ').toLowerCase().includes(termino)) ||
        (u.sucursal && u.sucursal.toLowerCase().includes(termino))
      );
    }
    return trabajadores;
  }

  getTrabajadoresAgrupados() {
    const trabajadores = this.getTrabajadores();
    const gruposMap = new Map<string, any[]>();
    trabajadores.forEach(user => {
      let nombreGrupo = 'Sin Sucursal Asignada';
      if (user.sucursales && user.sucursales.length > 0) {
        nombreGrupo = user.sucursales.join(' y ');
      } else if (user.sucursal) {
        nombreGrupo = user.sucursal;
      }
      if (!gruposMap.has(nombreGrupo)) { gruposMap.set(nombreGrupo, []); }
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
    this.formNombre = ''; this.formUsuario = ''; this.formCorreo = ''; this.formPassword = '';
    this.formRol = 'trabajador'; this.formCargo = 'Trabajador General'; 
    this.formPuedeCrearChecklists = false; this.formPuedeVerCheckstore = false; 
    this.formPuedeVerEstadisticas = false; this.formPuedeVerHistorial = false; 
    this.formPuedeAdministrarPersonal = false;
    this.formSucursales = []; 
    this.isModalOpen = true;
  }

  editarUsuario(user: any) {
    if (this.currentUser?.rol !== 'admin' && !this.currentUser?.puedeAdministrarPersonal) return;
    this.usuarioEnEdicion = user; 
    this.formNombre = user.nombre;
    this.formUsuario = user.usuario;
    this.formCorreo = user.correo || '';
    this.formPassword = user.password || '';
    this.formRol = user.rol;
    this.formCargo = user.cargo || 'Trabajador General';
    this.formSucursales = user.sucursales ? [...user.sucursales] : [];
    this.formPuedeCrearChecklists = user.puedeCrearChecklists === true;
    this.formPuedeVerCheckstore = user.puedeVerCheckstore === true;
    this.formPuedeVerEstadisticas = user.puedeVerEstadisticas === true;
    this.formPuedeVerHistorial = user.puedeVerHistorial === true; 
    this.formPuedeAdministrarPersonal = user.puedeAdministrarPersonal === true;
    this.isModalOpen = true;
  }

  cerrarModal() { this.isModalOpen = false; this.usuarioEnEdicion = null; }

  toggleSucursal(sucursal: string) {
    const index = this.formSucursales.indexOf(sucursal);
    if (index > -1) { this.formSucursales.splice(index, 1); } 
    else { this.formSucursales.push(sucursal); }
  }

  async guardarUsuario() {
    if (this.currentUser?.rol !== 'admin' && !this.currentUser?.puedeAdministrarPersonal) return; 
    if (!this.formNombre || !this.formUsuario || !this.formCorreo || !this.formPassword) {
      alert('⚠️ Por favor completa todos los campos.'); return;
    }

    const payload = {
      nombre: this.formNombre, usuario: this.formUsuario, correo: this.formCorreo, password: this.formPassword,
      rol: this.formRol, cargo: this.formCargo,
      puedeCrearChecklists: this.formRol === 'admin' ? true : this.formPuedeCrearChecklists,
      puedeVerCheckstore: this.formRol === 'admin' ? true : this.formPuedeVerCheckstore,
      puedeVerEstadisticas: this.formRol === 'admin' ? true : this.formPuedeVerEstadisticas,
      puedeVerHistorial: this.formRol === 'admin' ? true : this.formPuedeVerHistorial,
      puedeAdministrarPersonal: this.formRol === 'admin' ? true : this.formPuedeAdministrarPersonal,
      sucursales: this.formRol === 'admin' ? ['General (Acceso Total)'] : this.formSucursales 
    };

    if (this.usuarioEnEdicion) {
      const docId = this.usuarioEnEdicion.uid || this.usuarioEnEdicion.usuario;
      await setDoc(doc(this.firestore, 'usuarios', docId), payload, { merge: true });
      alert('✅ ¡Usuario actualizado!');
      this.cerrarModal();
      return; 
    }

    try {
      const creds = await createUserWithEmailAndPassword(this.auth, this.formCorreo, this.formPassword);
      await setDoc(doc(this.firestore, 'usuarios', creds.user.uid), { ...payload, uid: creds.user.uid });
      alert('✅ ¡Usuario creado en la Nube!');
      this.cerrarModal();
    } catch (error: any) {
      alert('❌ Error: ' + error.message);
    }
  }

  async eliminarUsuario(userToDelete: any) {
    if (this.currentUser?.rol !== 'admin' && !this.currentUser?.puedeAdministrarPersonal) return;
    if (userToDelete.usuario === this.currentUser.usuario) { alert('🛡️ No puedes borrarte a ti mismo.'); return; }
    if (confirm(`⚠️ ¿Eliminar a ${userToDelete.nombre}?`)) {
      await deleteDoc(doc(this.firestore, 'usuarios', userToDelete.uid || userToDelete.usuario));
    }
  }

  // 🔥 NUEVA FUNCIÓN: Descargar usuarios en Excel (CSV) 🔥
  descargarExcel() {
    const listaUsuarios = this.usuarios();
    if (!listaUsuarios || listaUsuarios.length === 0) {
      alert('No hay usuarios para descargar.'); return;
    }

    let csv = 'Nombre,Usuario,Correo,Rol,Cargo,Sucursales,Crea Checklists,Ve Checkstore,Ve Estadisticas,Ve Historial,Administra Personal\n';

    listaUsuarios.forEach(u => {
      const sucs = `"${u.sucursales ? u.sucursales.join(' - ') : (u.sucursal || '')}"`;
      csv += `"${u.nombre}","${u.usuario}","${u.correo}","${u.rol}","${u.cargo}",${sucs},${u.puedeCrearChecklists?'Sí':'No'},${u.puedeVerCheckstore?'Sí':'No'},${u.puedeVerEstadisticas?'Sí':'No'},${u.puedeVerHistorial?'Sí':'No'},${u.puedeAdministrarPersonal?'Sí':'No'}\n`;
    });

    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', 'Plantilla_Personal_MegaDulces.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}