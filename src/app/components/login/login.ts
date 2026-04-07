import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth, signInWithEmailAndPassword } from '@angular/fire/auth';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html', 
  styleUrls: ['./login.css']   
})
export class LoginComponent {
  usuario = '';
  password = '';
  rolSeleccionado = signal('admin');

  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private router = inject(Router);

  seleccionarRol(rol: string) {
    this.rolSeleccionado.set(rol);
  }

 async ingresar() {
    if (!this.usuario || !this.password) {
      Swal.fire({
        icon: 'warning',
        title: 'Campos Vacíos',
        text: 'Por favor, ingresa tu usuario y contraseña.',
        confirmButtonColor: '#0F172A'
      });
      return;
    }

    // 🛡️ PARACAÍDAS DE SEGURIDAD PARA EL ADMIN PRINCIPAL 🛡️
    if (this.usuario === 'admin' && this.password === '123456' && this.rolSeleccionado() === 'admin') {
      const adminSeguridad = { 
        nombre: 'Administrador Supremo', usuario: 'admin', rol: 'admin',
        puedeCrearChecklists: true, puedeCrearRutinas: true, puedeCrearTareasUnicas: true,
        puedeVerCheckstore: true, puedeVerEstadisticas: true, puedeVerHistorial: true, puedeAdministrarPersonal: true
      };
      localStorage.setItem('md_sesion_actual', JSON.stringify(adminSeguridad));
      this.router.navigate(['/home']);
      return;
    }

    try {
      const usuariosRef = collection(this.firestore, 'usuarios');
      const snapshot = await getDocs(usuariosRef);
      let usuarioEncontrado: any = null;

      snapshot.forEach(doc => {
        const data = doc.data();
        if ((data['usuario'] === this.usuario || data['correo'] === this.usuario) && data['rol'] === this.rolSeleccionado()) {
          usuarioEncontrado = data;
        }
      });

      if (!usuarioEncontrado) {
        Swal.fire({
          icon: 'error',
          title: 'Acceso Denegado',
          text: 'Datos incorrectos. Verifica tu usuario, contraseña o el rol seleccionado.',
          confirmButtonColor: '#0F172A'
        });
        return;
      }

      const correoParaFirebase = usuarioEncontrado.correo;
      await signInWithEmailAndPassword(this.auth, correoParaFirebase, this.password);

      localStorage.setItem('md_sesion_actual', JSON.stringify(usuarioEncontrado));
      this.router.navigate(['/home']);

    } catch (error: any) {
      console.error("Error de Firebase:", error);
      Swal.fire({
        icon: 'error',
        title: 'Contraseña Incorrecta',
        text: 'Intenta de nuevo.',
        confirmButtonColor: '#0F172A'
      });
    }
  }
}