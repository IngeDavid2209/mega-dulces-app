import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth, signInWithEmailAndPassword } from '@angular/fire/auth';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';
import Swal from 'sweetalert2';
import { APP_BUILD_SELLO } from '../../shared/version';

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
  ingresando = false; // Variable para evitar doble clic en el botón

  /** Sello de versión del build (fecha + hora). Se muestra al pie del login. */
  readonly buildSello = APP_BUILD_SELLO;

  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private router = inject(Router);

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

    this.ingresando = true;

    try {
      // 1. Buscamos al usuario en la base de datos sin importar su rol
      const usuariosRef = collection(this.firestore, 'usuarios');
      const snapshot = await getDocs(usuariosRef);
      let usuarioEncontrado: any = null;

      snapshot.forEach(doc => {
        const data = doc.data();
        if (data['usuario'] === this.usuario || data['correo'] === this.usuario) {
          usuarioEncontrado = { uid: doc.id, ...data }; // 👈 agrega uid: doc.id
        }
      });

      // Si no existe en la base de datos...
      if (!usuarioEncontrado) {
        Swal.fire({
          icon: 'error',
          title: 'Usuario no encontrado',
          text: 'No existe ningún colaborador o administrador con ese nombre de usuario.',
          confirmButtonColor: '#0F172A'
        });
        this.ingresando = false;
        return;
      }

      // 2. Si lo encontramos, extraemos su correo real y procedemos a loguear con Firebase Auth
      const correoParaFirebase = usuarioEncontrado.correo;

      // Intentamos iniciar sesión con la contraseña que puso
      await signInWithEmailAndPassword(this.auth, correoParaFirebase, this.password);

      // 3. Si la contraseña fue correcta, Firebase nos deja pasar. 
      // Guardamos la sesión (el rol se guarda aquí automáticamente)
      localStorage.setItem('md_sesion_actual', JSON.stringify(usuarioEncontrado));

      // Limpiamos los campos y redirigimos
      this.usuario = '';
      this.password = '';
      this.router.navigate(['/home']);

    } catch (error: any) {
      console.error("Error de Firebase:", error);
      Swal.fire({
        icon: 'error',
        title: 'Acceso Denegado',
        text: 'La contraseña es incorrecta. Intenta de nuevo.',
        confirmButtonColor: '#0F172A'
      });
    } finally {
      this.ingresando = false;
    }
  }
}