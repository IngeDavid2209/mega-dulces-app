import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth, signInWithEmailAndPassword } from '@angular/fire/auth';
import { Firestore, collection, getDocs, getDoc, doc, query, where } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';
import { APP_BUILD_SELLO } from '../../shared/version';
import { NotificacionesService } from '../../services/notificaciones';
import { environment } from '../../../environments/environment';
import { AuthApi } from '../../api/auth.api';
import { guardarTokenJwt } from '../../core/jwt.interceptor';

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
  ingresando = false; // evita doble clic en el boton

  /** Sello de versión del build (fecha + hora). Se muestra al pie del login. */
  readonly buildSello = APP_BUILD_SELLO;

  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private router = inject(Router);
  private notificaciones = inject(NotificacionesService);
  private authApi = inject(AuthApi);

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
      if (environment.useBackend) {
        await this.ingresarBackend();
      } else {
        await this.ingresarFirebase();
      }
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

  // -------------------------------------------------------------------------
  // Login contra el backend propio (Node + Express + Postgres).
  // El endpoint /api/auth/login ya acepta usuario o correo en el mismo campo.
  // -------------------------------------------------------------------------
  private async ingresarBackend(): Promise<void> {
    const entrada = this.usuario.trim();
    const res = await firstValueFrom(this.authApi.login({ usuario: entrada, password: this.password }));

    // Persistir token + perfil para que el interceptor y el resto de la app los usen.
    guardarTokenJwt(res.token);
    try { localStorage.setItem('md_sesion_actual', JSON.stringify(res.user)); } catch {}

    this.usuario = '';
    this.password = '';

    // Registrar el token FCM de este dispositivo (best-effort).
    // En modo backend igual lo registramos contra Firebase porque FCM no se migra;
    // mas adelante (sub-fase G) lo moveremos a un endpoint /api/notificaciones/tokens.
    const uidParaFCM = res.user.uidFirebase || res.user.id;
    this.notificaciones.solicitarPermisos(res.user.nombre, uidParaFCM).catch(() => {});

    this.router.navigate(['/home']);
  }

  // -------------------------------------------------------------------------
  // Login contra Firebase (flujo original). Resuelve correo via indice_login,
  // hace signInWithEmailAndPassword y lee perfil de Firestore.
  // Se mantiene intacto mientras useBackend=false para no romper la app.
  // -------------------------------------------------------------------------
  private async ingresarFirebase(): Promise<void> {
    const entrada = this.usuario.trim();

    let correoParaFirebase = '';
    if (entrada.includes('@')) {
      correoParaFirebase = entrada;
    } else {
      const idxSnap = await getDoc(doc(this.firestore, 'indice_login', entrada.toLowerCase()));
      if (idxSnap.exists()) correoParaFirebase = (idxSnap.data() as any).correo || '';

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
        } catch (_) { /* reglas estrictas activas */ }
      }
    }

    if (!correoParaFirebase) {
      Swal.fire({
        icon: 'error',
        title: 'Usuario no encontrado',
        text: 'Revisa tu usuario, o intenta con tu correo completo.',
        confirmButtonColor: '#0F172A'
      });
      return;
    }

    const creds = await signInWithEmailAndPassword(this.auth, correoParaFirebase, this.password);

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
      return;
    }

    localStorage.setItem('md_sesion_actual', JSON.stringify(perfil));
    this.usuario = '';
    this.password = '';

    this.notificaciones.solicitarPermisos(perfil.nombre, creds.user.uid).catch(() => {});
    this.router.navigate(['/home']);
  }
}
