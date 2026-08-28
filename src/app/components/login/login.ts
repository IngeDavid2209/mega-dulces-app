import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth, signInWithEmailAndPassword } from '@angular/fire/auth';
import Swal from 'sweetalert2';
import { APP_BUILD_SELLO } from '../../shared/version';
import { NotificacionesService } from '../../services/notificaciones';
import { MANTENIMIENTO_ACTIVO, MANTENIMIENTO_TITULO } from '../../shared/mantenimiento.util';

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

  /**
   * 🚧 Aviso de mantenimiento en el propio login.
   *
   * El login queda abierto durante el mantenimiento porque es el único camino
   * para que entre la cuenta que sí puede trabajar. Pero dejarlo sin aviso hace
   * que la gente teclee su contraseña para topar con el cartel un segundo
   * después. Se les dice antes.
   */
  readonly enMantenimiento = MANTENIMIENTO_ACTIVO;
  readonly tituloMantenimiento = MANTENIMIENTO_TITULO;

  private auth = inject(Auth);
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

      // 1. Resolver el CORREO (FERROCARRIL: desde Postgres, endpoint PÚBLICO).
      //    - Si escribió un correo (contiene @), se usa directo.
      //    - Si escribió su usuario, se consulta /api/login-usuario (sin token,
      //      porque aún no hay sesión). Devuelve solo el correo.
      let correoParaFirebase = '';
      if (entrada.includes('@')) {
        correoParaFirebase = entrada;
      } else {
        try {
          const res = await fetch('/api/login-usuario?usuario=' + encodeURIComponent(entrada.toLowerCase()));
          const data = await res.json().catch(() => ({}));
          correoParaFirebase = (data && data.correo) || '';
        } catch (_) { /* sin red: el correo queda vacío y se avisa abajo */ }
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

      // 3. Ya autenticados, leemos el perfil (rol/permisos) desde Postgres
      //    (/api/usuarios?id=), con el idToken recién obtenido.
      let perfil: any = null;
      try {
        const tok = await creds.user.getIdToken();
        const res = await fetch('/api/usuarios?id=' + encodeURIComponent(creds.user.uid), {
          headers: { 'Authorization': 'Bearer ' + tok }
        });
        const data = await res.json().catch(() => ({}));
        if (data && data.usuario) perfil = { ...data.usuario, uid: creds.user.uid };
      } catch (_) { /* perfil queda null → se maneja abajo */ }

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

      // 🛡️ Pedir almacenamiento persistente en este gesto del usuario (el momento
      // más confiable para que el navegador lo conceda). Evita que el navegador
      // borre la sesión bajo presión de espacio y bote al usuario al login.
      try {
        if (navigator.storage?.persist) await navigator.storage.persist();
      } catch (_) { /* no soportado: se reintenta al abrir la app */ }

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