import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth, signInWithEmailAndPassword } from '@angular/fire/auth';
import { Firestore, collection, getDocs, getDoc, doc, query, where } from '@angular/fire/firestore';
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
      const entrada = this.usuario.trim();

      // 1. Resolver el CORREO sin descargar toda la base de usuarios.
      //    - Si escribió un correo (contiene @), se usa directo.
      //    - Si escribió su usuario, se consulta SOLO su entrada en el índice
      //      público mínimo `indice_login/{usuario}` → { correo }.
      let correoParaFirebase = '';
      if (entrada.includes('@')) {
        correoParaFirebase = entrada;
      } else {
        const idxSnap = await getDoc(doc(this.firestore, 'indice_login', entrada.toLowerCase()));
        if (idxSnap.exists()) correoParaFirebase = (idxSnap.data() as any).correo || '';
      }

      if (!correoParaFirebase) {
        Swal.fire({
          icon: 'error',
          title: 'Usuario no encontrado',
          text: 'Revisa tu usuario, o intenta con tu correo completo.',
          confirmButtonColor: '#0F172A'
        });
        this.ingresando = false;
        return;
      }

      // 2. Autenticar con Firebase Auth (aquí se valida la contraseña real).
      const creds = await signInWithEmailAndPassword(this.auth, correoParaFirebase, this.password);

      // 3. Ya autenticados, leemos el perfil del usuario (rol/permisos).
      //    Primero por uid (docs nuevos). Fallback por correo (docs antiguos).
      let perfil: any = null;
      const porUid = await getDoc(doc(this.firestore, 'usuarios', creds.user.uid));
      if (porUid.exists()) {
        perfil = { uid: creds.user.uid, ...(porUid.data() as any) };
      } else {
        const q = query(collection(this.firestore, 'usuarios'), where('correo', '==', correoParaFirebase));
        const qs = await getDocs(q);
        qs.forEach(d => { if (!perfil) perfil = { uid: d.id, ...(d.data() as any) }; });
      }

      if (!perfil) {
        Swal.fire({
          icon: 'error',
          title: 'Perfil incompleto',
          text: 'Tu cuenta existe pero falta su perfil. Contacta a un administrador.',
          confirmButtonColor: '#0F172A'
        });
        this.ingresando = false;
        return;
      }

      localStorage.setItem('md_sesion_actual', JSON.stringify(perfil));
      this.usuario = '';
      this.password = '';
      this.router.navigate(['/home']);

    } catch (error: any) {
      console.error('Error de login:', error?.code || error);
      Swal.fire({
        icon: 'error',
        title: 'Acceso Denegado',
        text: 'Usuario o contraseña incorrectos. Intenta de nuevo.',
        confirmButtonColor: '#0F172A'
      });
    } finally {
      this.ingresando = false;
    }
  }
}