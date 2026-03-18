import { Component, signal, OnInit, inject } from '@angular/core';
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
export class PersonalComponent implements OnInit {
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
  formPuedeVerHistorial = false; // 🔥 NUEVO PERMISO 🔥

  sucursalesDisponibles = [
    'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
    'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro',
    'OFICINAS CORPORATIVAS', 'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD', 'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO'
  ];
  
  formSucursales: string[] = []; 

  private auth = inject(Auth);
  private firestore = inject(Firestore); 
  private router = inject(Router); 

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) { this.currentUser = JSON.parse(sesion); }
    this.conectarConLaNube();
  }

  conectarConLaNube() {
    const guardadosLocales = localStorage.getItem('md_usuarios_viejos'); 
    const datosActuales = localStorage.getItem('md_usuarios');
    
    if (datosActuales) {
      const locales = JSON.parse(datosActuales);
      locales.forEach(async (u: any) => {
        const docId = u.uid || u.usuario; 
        await setDoc(doc(this.firestore, 'usuarios', docId), u, { merge: true });
      });
      localStorage.setItem('md_usuarios_viejos', datosActuales);
      localStorage.removeItem('md_usuarios');
    }

    const usuariosRef = collection(this.firestore, 'usuarios');
    onSnapshot(usuariosRef, (snapshot) => {
      const usuariosNube: any[] = [];
      snapshot.forEach((documento) => {
        usuariosNube.push(documento.data());
      });
      this.usuarios.set(usuariosNube);
      localStorage.setItem('md_usuarios_respaldo', JSON.stringify(usuariosNube));
    });
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

    const gruposArray = Array.from(gruposMap.keys()).map(key => {
      return { nombre: key, usuarios: gruposMap.get(key)! };
    });

    gruposArray.sort((a, b) => a.nombre.localeCompare(b.nombre));
    return gruposArray;
  }

  verHistorial(nombreEmpleado: string) {
    this.router.navigate(['/reportes'], { queryParams: { empleado: nombreEmpleado } });
  }

  abrirModal() {
    if (this.currentUser?.rol !== 'admin') { alert('⛔ Acceso denegado.'); return; }
    this.usuarioEnEdicion = null;
    this.formNombre = ''; this.formUsuario = ''; this.formCorreo = ''; this.formPassword = '';
    this.formRol = 'trabajador'; this.formCargo = 'Trabajador General'; 
    this.formPuedeCrearChecklists = false; this.formPuedeVerCheckstore = false; this.formPuedeVerEstadisticas = false;
    this.formPuedeVerHistorial = false; // 🔥 NUEVO PERMISO 🔥
    this.formSucursales = []; 
    this.isModalOpen = true;
  }

  editarUsuario(user: any) {
    if (this.currentUser?.rol !== 'admin') return;
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
    this.formPuedeVerHistorial = user.puedeVerHistorial === true; // 🔥 NUEVO PERMISO 🔥
    this.isModalOpen = true;
  }

  cerrarModal() { this.isModalOpen = false; this.usuarioEnEdicion = null; }

  toggleSucursal(sucursal: string) {
    const index = this.formSucursales.indexOf(sucursal);
    if (index > -1) { this.formSucursales.splice(index, 1); } 
    else { this.formSucursales.push(sucursal); }
  }

  async guardarUsuario() {
    if (this.currentUser?.rol !== 'admin') return; 
    if (!this.formNombre || !this.formUsuario || !this.formCorreo || !this.formPassword) {
      alert('⚠️ Por favor completa todos los campos principales.'); return;
    }
    if (this.formRol === 'trabajador' && this.formSucursales.length === 0) {
      alert('⚠️ Por favor selecciona al menos una sucursal.'); return;
    }

    if (this.usuarioEnEdicion) {
      const docId = this.usuarioEnEdicion.uid || this.usuarioEnEdicion.usuario;
      const userRef = doc(this.firestore, 'usuarios', docId);
      
      await setDoc(userRef, {
        nombre: this.formNombre, usuario: this.formUsuario, correo: this.formCorreo, password: this.formPassword,
        rol: this.formRol, cargo: this.formCargo,
        puedeCrearChecklists: this.formRol === 'admin' ? true : this.formPuedeCrearChecklists,
        puedeVerCheckstore: this.formRol === 'admin' ? true : this.formPuedeVerCheckstore,
        puedeVerEstadisticas: this.formRol === 'admin' ? true : this.formPuedeVerEstadisticas,
        puedeVerHistorial: this.formRol === 'admin' ? true : this.formPuedeVerHistorial, // 🔥 NUEVO PERMISO 🔥
        sucursales: this.formRol === 'admin' ? ['General (Acceso Total)'] : this.formSucursales 
      }, { merge: true });

      alert('✅ ¡Datos y permisos actualizados en la NUBE!');
      this.cerrarModal();
      return; 
    }

    if (this.formPassword.length < 6) {
      alert('⚠️ Firebase exige que la contraseña tenga mínimo 6 caracteres.'); return;
    }

    try {
      const credenciales = await createUserWithEmailAndPassword(this.auth, this.formCorreo, this.formPassword);
      
      const nuevoUsuario = {
        uid: credenciales.user.uid, 
        nombre: this.formNombre, usuario: this.formUsuario, correo: this.formCorreo, password: this.formPassword, 
        rol: this.formRol, cargo: this.formCargo, 
        puedeCrearChecklists: this.formRol === 'admin' ? true : this.formPuedeCrearChecklists,
        puedeVerCheckstore: this.formRol === 'admin' ? true : this.formPuedeVerCheckstore,
        puedeVerEstadisticas: this.formRol === 'admin' ? true : this.formPuedeVerEstadisticas,
        puedeVerHistorial: this.formRol === 'admin' ? true : this.formPuedeVerHistorial, // 🔥 NUEVO PERMISO 🔥
        sucursales: this.formRol === 'admin' ? ['General (Acceso Total)'] : this.formSucursales 
      };

      const userRef = doc(this.firestore, 'usuarios', credenciales.user.uid);
      await setDoc(userRef, nuevoUsuario);
      
      alert('✅ ¡Usuario guardado en la NUBE exitosamente!');
      this.cerrarModal();

    } catch (error: any) {
      alert('❌ Hubo un error en Firebase: ' + error.message);
    }
  }

  async eliminarUsuario(userToDelete: any) {
    if (this.currentUser?.rol !== 'admin') return;
    if (userToDelete.usuario === this.currentUser.usuario) { alert('🛡️ No puedes eliminar tu propia cuenta.'); return; }
    
    const confirmacion = confirm(`⚠️ ¿Estás totalmente seguro de eliminar a ${userToDelete.nombre} de la nube?`);
    if (confirmacion) {
      const docId = userToDelete.uid || userToDelete.usuario;
      const userRef = doc(this.firestore, 'usuarios', docId);
      await deleteDoc(userRef);
    }
  }
}