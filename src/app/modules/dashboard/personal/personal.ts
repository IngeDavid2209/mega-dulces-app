import { Component, signal, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Auth, createUserWithEmailAndPassword } from '@angular/fire/auth'; 
// 🔥 IMPORTAMOS FIRESTORE (LA NUBE) 🔥
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

  sucursalesDisponibles = [
    'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
    'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro'
  ];
  formSucursales: string[] = []; 

  private auth = inject(Auth);
  private firestore = inject(Firestore); // 🔥 INYECTAMOS LA BASE DE DATOS 🔥

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) { this.currentUser = JSON.parse(sesion); }
    this.conectarConLaNube();
  }

  conectarConLaNube() {
    // 1. MIGRACIÓN AUTOMÁTICA DE LOCAL A LA NUBE
    const guardadosLocales = localStorage.getItem('md_usuarios_viejos'); 
    const datosActuales = localStorage.getItem('md_usuarios');
    
    if (datosActuales) {
      const locales = JSON.parse(datosActuales);
      locales.forEach(async (u: any) => {
        const docId = u.uid || u.usuario; // Usamos el ID único
        await setDoc(doc(this.firestore, 'usuarios', docId), u, { merge: true });
      });
      // Renombramos el local viejo para que no lo vuelva a subir mil veces
      localStorage.setItem('md_usuarios_viejos', datosActuales);
      localStorage.removeItem('md_usuarios');
    }

    // 2. ESCUCHAR A LA NUBE EN TIEMPO REAL
    const usuariosRef = collection(this.firestore, 'usuarios');
    onSnapshot(usuariosRef, (snapshot) => {
      const usuariosNube: any[] = [];
      snapshot.forEach((documento) => {
        usuariosNube.push(documento.data());
      });
      this.usuarios.set(usuariosNube);
      
      // Guardamos un respaldo fresco en la compu por seguridad
      localStorage.setItem('md_usuarios_respaldo', JSON.stringify(usuariosNube));
    });
  }

  getAdmins() { return this.usuarios().filter(u => u.rol === 'admin'); }
  getTrabajadores() { return this.usuarios().filter(u => u.rol === 'trabajador'); }

  abrirModal() {
    if (this.currentUser?.rol !== 'admin') { alert('⛔ Acceso denegado.'); return; }
    this.usuarioEnEdicion = null;
    this.formNombre = ''; this.formUsuario = ''; this.formCorreo = ''; this.formPassword = '';
    this.formRol = 'trabajador'; this.formCargo = 'Trabajador General'; 
    this.formPuedeCrearChecklists = false; this.formPuedeVerCheckstore = false; this.formPuedeVerEstadisticas = false;
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

    // 🟢 MODO EDICIÓN (GUARDA DIRECTO EN FIRESTORE)
    if (this.usuarioEnEdicion) {
      const docId = this.usuarioEnEdicion.uid || this.usuarioEnEdicion.usuario;
      const userRef = doc(this.firestore, 'usuarios', docId);
      
      await setDoc(userRef, {
        nombre: this.formNombre, usuario: this.formUsuario, correo: this.formCorreo, password: this.formPassword,
        rol: this.formRol, cargo: this.formCargo,
        puedeCrearChecklists: this.formRol === 'admin' ? true : this.formPuedeCrearChecklists,
        puedeVerCheckstore: this.formRol === 'admin' ? true : this.formPuedeVerCheckstore,
        puedeVerEstadisticas: this.formRol === 'admin' ? true : this.formPuedeVerEstadisticas,
        sucursales: this.formRol === 'admin' ? ['General (Acceso Total)'] : this.formSucursales 
      }, { merge: true });

      alert('✅ ¡Datos y permisos actualizados en la NUBE!');
      this.cerrarModal();
      return; 
    }

    // 🔵 MODO CREACIÓN (GUARDA DIRECTO EN FIRESTORE)
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