import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth, signInWithEmailAndPassword } from '@angular/fire/auth';
import Swal from 'sweetalert2';
import { APP_BUILD_SELLO } from '../../shared/version';
import { NotificacionesService } from '../../services/notificaciones';
import { MANTENIMIENTO_ACTIVO, MANTENIMIENTO_TITULO } from '../../shared/mantenimiento.util';

/**
 * ⏱️ CADA PASO DEL LOGIN CON TOPE DE TIEMPO, Y CON NOMBRE
 *
 * El 1/sep/2026 el botón se quedó en "VERIFICANDO..." y costó horas saber
 * dónde. El flujo tenía CINCO `await` sin tope —dos `fetch`, dos llamadas a
 * Firebase y `navigator.storage.persist()`— y un `finally` que apaga el
 * spinner. Con el `finally` presente, un spinner eterno significa que un
 * `await` NUNCA VUELVE: no hay error que atrapar, no hay nada en la consola, y
 * desde fuera «no me deja entrar» se ve idéntico esté la contraseña mal, la red
 * bloqueada o el perfil incompleto.
 *
 * Con tope, el síntoma deja de ser un misterio y pasa a ser una frase: la
 * pantalla dice EN QUÉ PASO se agotó el tiempo. Eso vale más que el tope.
 *
 * No sustituye a un mensaje de error: sustituye al SILENCIO.
 */
function conTope<T>(promesa: Promise<T>, ms: number, paso: string): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    const reloj = setTimeout(() => rechazar(new Error('TIEMPO_AGOTADO:' + paso)), ms);
    promesa.then(
      (v) => { clearTimeout(reloj); resolver(v); },
      (e) => { clearTimeout(reloj); rechazar(e); },
    );
  });
}

/** ¿Este error es un tope de tiempo? Devuelve el paso, o null. */
function pasoAgotado(e: any): string | null {
  const m = /^TIEMPO_AGOTADO:(.+)$/.exec(String(e?.message || ''));
  return m ? m[1] : null;
}

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
        confirmButtonColor: 'var(--action)'
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
          const res = await conTope(
            fetch('/api/login-usuario?usuario=' + encodeURIComponent(entrada.toLowerCase())),
            15000, 'buscar tu usuario');
          const data = await conTope(res.json(), 10000, 'leer la respuesta').catch(() => ({}));
          correoParaFirebase = (data && data.correo) || '';
        } catch (e) {
          // Un TOPE no se traga. Si se tragara, la pantalla diría "Usuario no
          // encontrado" cuando el problema es la red, y se buscaría el error en
          // el lugar equivocado. Los demás fallos sí: sin red el correo queda
          // vacío y se avisa abajo.
          if (pasoAgotado(e)) throw e;
        }
      }

      if (!correoParaFirebase) {
        Swal.fire({
          icon: 'error',
          title: 'Usuario no encontrado',
          text: 'Revisa tu usuario, o intenta con tu correo completo.',
          confirmButtonColor: 'var(--action)'
        });
        this.ingresando = false;
        return;
      }

      // 2. Autenticar con Firebase Auth (aquí se valida la contraseña real).
      // Firebase Auth vive en identitytoolkit.googleapis.com, un dominio
      // DISTINTO al de la app: una red que deja pasar railway.app y bloquea
      // googleapis.com deja este await colgado para siempre. Pasa en redes de
      // sucursal, y sin tope es indistinguible de una contraseña mala.
      const creds = await conTope(
        signInWithEmailAndPassword(this.auth, correoParaFirebase, this.password),
        20000, 'validar tu contraseña');

      // 3. Ya autenticados, leemos el perfil (rol/permisos) desde Postgres
      //    (/api/usuarios?id=), con el idToken recién obtenido.
      let perfil: any = null;
      try {
        const tok = await conTope(creds.user.getIdToken(), 15000, 'obtener tu credencial');
        const res = await conTope(
          fetch('/api/usuarios?id=' + encodeURIComponent(creds.user.uid), {
            headers: { 'Authorization': 'Bearer ' + tok }
          }), 15000, 'leer tu perfil');
        const data = await conTope(res.json(), 10000, 'leer tu perfil').catch(() => ({}));
        if (data && data.usuario) perfil = { ...data.usuario, uid: creds.user.uid };
      } catch (e) {
        // Igual que arriba: un tope no se traga. Decir "Perfil incompleto"
        // cuando lo que hubo fue una espera sin respuesta manda a revisar la
        // base en vez de la red.
        if (pasoAgotado(e)) throw e;
        /* cualquier otro fallo: perfil queda null → se maneja abajo */
      }

      if (!perfil) {
        Swal.fire({
          icon: 'error',
          title: 'Perfil incompleto',
          text: 'Tu cuenta existe pero falta su perfil. Contacta a un administrador.',
          confirmButtonColor: 'var(--action)'
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
      // ⚠️ SIN `await`, Y ÉSTE ERA EL CUELGUE MÁS CRUEL DE LOS CINCO.
      //
      // Está DESPUÉS de guardar `md_sesion_actual`, así que si se colgaba aquí
      // la sesión ya estaba guardada: la persona quedaba autenticada, mirando
      // "VERIFICANDO..." para siempre, y con recargar entraba. O sea que el
      // login había funcionado y la pantalla decía lo contrario.
      //
      // Pedir almacenamiento persistente es una MEJORA, no un requisito para
      // entrar. Nada que sea opcional merece bloquear el acceso de nadie.
      try {
        if (navigator.storage?.persist) {
          navigator.storage.persist().catch(() => { /* no soportado: se reintenta al abrir */ });
        }
      } catch (_) { /* ni siquiera existe la API */ }

      // 🔔 Registrar el token FCM de este dispositivo (sin bloquear el login si
      // el usuario rechaza permisos o el navegador no soporta push).
      this.notificaciones.solicitarPermisos(perfil.nombre, creds.user.uid).catch(() => {});

      this.router.navigate(['/home']);

    } catch (error: any) {
      const paso = pasoAgotado(error);
      if (paso) {
        // Este mensaje existe para que nadie vuelva a pasar horas adivinando:
        // nombra el paso y separa "no respondió" de "está mal escrita".
        console.error('[login] tiempo agotado en: ' + paso, error);
        Swal.fire({
          icon: 'warning',
          title: 'No hubo respuesta',
          text: 'Se agotó el tiempo al ' + paso + '. No es tu contraseña: algo no está ' +
                'respondiendo. Revisa tu conexión e intenta de nuevo; si sigue igual, avisa ' +
                'a Sistemas que falló al ' + paso + '.',
          confirmButtonColor: 'var(--action)'
        });
      } else {
        console.error('Error de login:', error?.code || error);
        Swal.fire({
          icon: 'error',
          title: 'Acceso Denegado',
          text: 'Usuario o contraseña incorrectos. Intenta de nuevo.',
          confirmButtonColor: 'var(--action)'
        });
      }
    } finally {
      this.ingresando = false;
    }
  }
}