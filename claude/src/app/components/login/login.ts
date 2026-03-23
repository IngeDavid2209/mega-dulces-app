import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
// 🔥 IMPORTAMOS FIREBASE AUTH Y LA NUBE 🔥
import { Auth, signInWithEmailAndPassword } from '@angular/fire/auth';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html', 
  styleUrls: ['./login.css']   
})
export class LoginComponent {
  // 🔥 AHORA SÍ, USAMOS LOS NOMBRES EXACTOS DE TU HTML 🔥
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
      alert('⚠️ Por favor, ingresa tu usuario y contraseña.');
      return;
    }

    // 🛡️ PARACAÍDAS DE SEGURIDAD PARA EL ADMIN PRINCIPAL 🛡️
    // Esto garantiza que el dueño siempre pueda entrar, aunque la base de datos falle
    if (this.usuario === 'admin' && this.password === '123' && this.rolSeleccionado() === 'admin') {
      const adminSeguridad = { 
        nombre: 'Administrador', 
        usuario: 'admin', 
        rol: 'admin',
        puedeCrearChecklists: true,
        puedeVerCheckstore: true,
        puedeVerEstadisticas: true
      };
      localStorage.setItem('md_sesion_actual', JSON.stringify(adminSeguridad));
      this.router.navigate(['/home']);
      return;
    }

    try {
      // 1. 🔥 BUSCAR EL USUARIO EN LA NUBE PARA OBTENER SU CORREO REAL 🔥
      const usuariosRef = collection(this.firestore, 'usuarios');
      const snapshot = await getDocs(usuariosRef);
      let usuarioEncontrado: any = null;

      snapshot.forEach(doc => {
        const data = doc.data();
        // Revisamos si lo que escribió coincide con el "Usuario Corto" o con el "Correo"
        if ((data['usuario'] === this.usuario || data['correo'] === this.usuario) && data['rol'] === this.rolSeleccionado()) {
          usuarioEncontrado = data;
        }
      });

      // Si no encontró a nadie en la base de datos con ese rol y usuario
      if (!usuarioEncontrado) {
        alert('❌ Datos incorrectos. Verifica tu usuario, contraseña o el rol seleccionado.');
        return;
      }

      // 2. 🔥 INICIAR SESIÓN CON FIREBASE USANDO EL CORREO 🔥
      const correoParaFirebase = usuarioEncontrado.correo;
      await signInWithEmailAndPassword(this.auth, correoParaFirebase, this.password);

      // 3. 🔥 GUARDAMOS LOS PERMISOS EN LA SESIÓN Y LO DEJAMOS ENTRAR 🔥
      localStorage.setItem('md_sesion_actual', JSON.stringify(usuarioEncontrado));
      this.router.navigate(['/home']);

    } catch (error: any) {
      console.error("Error de Firebase:", error);
      alert('❌ Contraseña incorrecta. Intenta de nuevo.');
    }
  }
}