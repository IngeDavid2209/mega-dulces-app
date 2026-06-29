import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth, signInWithEmailAndPassword } from '@angular/fire/auth';
import { Firestore, collection, getDocs, getDoc, doc, setDoc, query, where } from '@angular/fire/firestore';
import Swal from 'sweetalert2';
import { APP_BUILD_SELLO } from '../../shared/version';
import { NotificacionesService } from '../../services/notificaciones';

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
  private notificaciones = inject(NotificacionesService);

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

        // 🛟 Fallback de compatibilidad: si el índice aún no está poblado,
        // resolvemos el correo buscando en la colección usuarios (como antes).
        // Funciona mientras las reglas lo permitan; una vez poblado el índice y
        // activadas las reglas estrictas, esta rama deja de usarse.
        if (!correoParaFirebase) {
          try {
            const qs = await getDocs(collection(this.firestore, 'usuarios'));
            qs.forEach(d => {
              if (correoParaFirebase) return;
              const u = d.data() as any;
              const usr = (u.usuario || '').toLowerCase();
              if (usr === entrada.toLowerCase() || (u.correo || '').toLowerCase() === entrada.toLowerCase()) {
                correoParaFirebase = u.correo || '';
              }
            });
          } catch (_) { /* reglas estrictas activas: usar el índice */ }
        }
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

      // 🛟 Auto-reparar el índice de login: lo dejamos apuntando al correo REAL
      // de Firebase Auth. Si alguien cambió su correo (perfil) y no terminó la
      // verificación, o el índice quedó desincronizado, esto lo corrige solo en
      // el siguiente inicio de sesión, sin romper el login por nombre de usuario.
      if (perfil?.usuario && creds.user.email) {
        try {
          await setDoc(doc(this.firestore, 'indice_login', String(perfil.usuario).trim().toLowerCase()),
            { correo: creds.user.email, uid: creds.user.uid });
        } catch (_) { /* no bloquear el login si falla el índice */ }
      }

      localStorage.setItem('md_sesion_actual', JSON.stringify(perfil));
      this.usuario = '';
      this.password = '';

      // 🔔 Registrar el token FCM de este dispositivo (sin bloquear el login si
      // el usuario rechaza permisos o el navegador no soporta push).
      this.notificaciones.solicitarPermisos(perfil.nombre, creds.user.uid).catch(() => {});

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