import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth, signInWithEmailAndPassword } from '@angular/fire/auth';
import Swal from 'sweetalert2';
import { APP_BUILD_SELLO } from '../../shared/version';
import { NotificacionesService } from '../../services/notificaciones';
import { hayTableroPara } from '../../services/home.guard';
import { MANTENIMIENTO_ACTIVO, MANTENIMIENTO_TITULO } from '../../shared/mantenimiento.util';
import { pareceCodigoDePlaza, normalizarCodigo } from '../../shared/codigo-plaza.util';
import { coberturaDelDia, Cobertura } from '../../shared/cobertura.util';

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

  // ── SEGUNDO PASO DEL ACCESO POR PLAZA ─────────────────────────────────────
  // Tras autenticar la plaza hay que saber QUIÉN entró. Va como paso dentro de
  // esta misma pantalla y no como ruta aparte: una ruta nueva necesitaría su
  // guard, y un guard mal puesto deja a gente fuera de la app — que es
  // exactamente el riesgo que este paso no puede correr.
  pasoPlaza: null | {
    token: string; codigo: string; fecha: string;
    plaza: any; coberturas: Cobertura[];
    sugerida: { uid: string; nombre: string } | null;
  } = null;
  /** Personas de la sucursal, para cuando quien entra NO es la sugerida. */
  personasPlaza: { id: string; nombre: string }[] = [];
  elegidoPlaza = '';

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

    // ── ¿ES UN CÓDIGO DE PLAZA? ─────────────────────────────────────────────
    // Se decide por la FORMA de lo tecleado, no por un interruptor que la
    // persona tenga que encontrar: «PH-ANA-1» no se parece a un usuario ni a un
    // correo. Si no casa, sigue el login de siempre y nadie pierde nada.
    if (pareceCodigoDePlaza(this.usuario)) {
      // Y si NO era un código de plaza, sigue por el login de siempre.
      //
      // `pareceCodigoDePlaza` mira la FORMA, y una forma puede coincidir por
      // accidente: un usuario llamado «ana-maria-2» casa con el patrón. Sin
      // esta caída, esa persona quedaría desviada a un login que no es el suyo
      // y NO PODRÍA ENTRAR NUNCA, sin entender por qué. Con ella, el desvío es
      // una optimización: si el código no existe, no se pierde nada.
      let manejado = false;
      try {
        manejado = await this.entrarPorPlaza();
      } finally {
        if (manejado) this.ingresando = false;
      }
      if (manejado) return;
    }

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

      // Un token de plaza olvidado en este navegador secuestraría TODAS las
      // peticiones de quien acaba de entrar con su cuenta. Se borra antes de
      // guardar la sesión nueva, no después.
      try { localStorage.removeItem('md_token'); } catch {}
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

      // ATERRIZAJE SEGUN LO QUE PUEDE VER, no fijo en /home.
      //
      // Mandar a todos a /home era correcto cuando /home tenia un tablero para
      // todo el mundo. Ya no: sus bloques estan gateados, asi que una
      // colaboradora aterrizaba en una pantalla con el titulo y nada mas.
      // El guard de la ruta la rebotaria igual, pero rebotar en el primer
      // segundo de sesion se ve como un error de la app. Mejor no mandarla.
      this.router.navigate([hayTableroPara(perfil) ? '/home' : '/tareas-manual']);

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

  // ══════════════════════════════════════════════════════════════════════════
  //  ACCESO POR PLAZA (parte B) — «PH-ANA-1» + PIN
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Paso 1: autenticar la PLAZA. Todavía no se sabe quién es la persona.
   *
   * Devuelve `true` si esto era de verdad un acceso de plaza (haya entrado o no)
   * y `false` cuando el código no existe — para que quien tecleó algo con forma
   * de código pero que es su usuario siga por el login de siempre.
   */
  private async entrarPorPlaza(): Promise<boolean> {
    try {
      const r = await conTope(
        fetch('/api/login-plaza', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ codigo: normalizarCodigo(this.usuario), pin: this.password.trim() }),
        }), 20000, 'validar el acceso de la plaza');
      const d = await conTope(r.json(), 10000, 'leer la respuesta');

      if (!r.ok) {
        // Código inexistente: NO era una plaza. Se devuelve el control al login
        // normal en silencio, sin asustar a nadie con un error que no aplica.
        if (d && d.campo === 'codigo') return false;
        // PIN equivocado: esto SÍ era una plaza. El mensaje del servidor
        // distingue los dos casos a propósito — el código va impreso en la
        // sucursal y no es un secreto, mientras que mandar a alguien a dudar de
        // su PIN cuando lo que tecleó mal fue el código le cuesta el turno.
        Swal.fire({ icon: 'error', title: 'No se pudo entrar',
          text: d?.error || 'Revisa el código y el PIN.',
          confirmButtonColor: 'var(--action)' });
        return true;
      }

      // Quién cubre hoy: con la MISMA función del pase de lista, que sabe que
      // la suplencia gana al titular. Si aquí se decidiera distinto, la foto
      // quedaría firmada por quien no fue.
      const cob = coberturaDelDia(d.coberturas || [], d.plaza.id, d.fecha);
      const sugerida = cob && cob.uid
        ? { uid: String(cob.uid), nombre: String((cob as any).nombre || '(sin nombre)') }
        : null;

      this.pasoPlaza = {
        token: d.token, codigo: d.codigo, fecha: d.fecha,
        plaza: d.plaza, coberturas: d.coberturas || [], sugerida,
      };

      // La lista para el caso «no soy yo». Se pide con el token de la plaza.
      try {
        const ru = await conTope(
          fetch('/api/usuarios', { headers: { Authorization: 'Bearer ' + d.token } }),
          15000, 'leer la lista de personas');
        const du = await conTope(ru.json(), 10000, 'leer la lista de personas');
        const lugar = String(d.plaza.lugar || '');
        this.personasPlaza = (du?.items || [])
          .filter((u: any) => u?.activo !== false &&
            (u?.datos?.sucursales || u?.sucursales || []).map((x: any) => String(x || '').trim()).includes(lugar))
          .map((u: any) => ({ id: String(u.id), nombre: String(u.nombre || u.usuario || '(sin nombre)') }))
          .sort((a: any, b: any) => a.nombre.localeCompare(b.nombre));
      } catch {
        // Sin lista no se puede elegir, pero SÍ se puede confirmar la sugerida.
        // Se deja vacía en vez de tumbar el acceso.
        this.personasPlaza = [];
      }
      return true;
    } catch (e: any) {
      // Un fallo de RED no prueba que el código no exista, así que NO se cae al
      // login normal: se dice lo que pasó. Caer aquí mandaría a la persona a
      // pelearse con una contraseña que no tiene.
      Swal.fire({ icon: 'error', title: 'No se pudo entrar',
        text: e?.message || 'Revisa tu conexión e intenta de nuevo.',
        confirmButtonColor: 'var(--action)' });
      return true;
    }
  }

  /** Paso 2: la persona confirma que es quien el pase de lista dice. */
  async confirmarSoyYo() {
    const p = this.pasoPlaza;
    if (!p || !p.sugerida) return;
    await this.abrirSesionDePlaza(p.sugerida.uid, p.sugerida.nombre, true);
  }

  /**
   * Paso 2 (el otro camino): NO es quien dice el pase de lista.
   *
   * Se registra una SUPLENCIA del día, para que la Encargada lo vea corregido
   * en vez de tener que adivinarlo, y la sesión queda marcada como identidad no
   * confirmada por ella. Nadie se queda sin trabajar por esto.
   */
  async confirmarSoyOtro() {
    const p = this.pasoPlaza;
    if (!p || !this.elegidoPlaza) return;
    const elegido = this.personasPlaza.find(x => x.id === this.elegidoPlaza);
    if (!elegido) return;

    try {
      const ahora = Date.now();
      await conTope(fetch('/api/coberturas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.token },
        body: JSON.stringify({
          id: p.plaza.id + '|suplencia|' + p.fecha + '|' + ahora,
          plazaId: p.plaza.id, uid: elegido.id, tipo: 'suplencia',
          desde: p.fecha, hasta: p.fecha,
          motivo: 'Se identificó al entrar (sin pase de lista previo)',
          creadaEn: ahora,
        }),
      }), 15000, 'registrar quién entró');
    } catch {
      // Si no se pudo registrar, la persona entra IGUAL: dejarla fuera por un
      // fallo de red sería peor que una cobertura que la Encargada corrige.
      // La sesión lo dice con `identidadConfirmada: false`.
    }
    await this.abrirSesionDePlaza(elegido.id, elegido.nombre, false);
  }

  /**
   * Deja la sesión lista y entra.
   *
   * La sesión lleva el UID y el NOMBRE de la PERSONA, no de la plaza: así todo
   * lo que ya existe -los checklists, la evidencia, los tableros- sigue
   * funcionando sin cambiar una línea, y cada foto conserva su nombre. La plaza
   * viaja aparte, en los campos `_plaza*`.
   */
  private async abrirSesionDePlaza(uid: string, nombre: string, confirmada: boolean) {
    const p = this.pasoPlaza!;
    const perfil: any = {
      uid, id: uid, nombre,
      usuario: p.codigo, correo: '',
      rol: 'trabajador',
      puestoId: p.plaza.puestoId,
      sucursales: [p.plaza.lugar],
      activo: true,
      _plazaId: p.plaza.id,
      _plazaCodigo: p.codigo,
      _plazaNumero: p.plaza.numero,
      // «Entró y la Encargada no había pasado lista» tiene que ser visible, o
      // se vuelve indistinguible de una cobertura registrada en forma (§5.2).
      _identidadConfirmada: confirmada,
    };
    try { localStorage.setItem('md_token', p.token); } catch {}
    try { localStorage.setItem('md_sesion_actual', JSON.stringify(perfil)); } catch {}
    this.pasoPlaza = null;
    this.router.navigate([hayTableroPara(perfil) ? '/home' : '/tareas-manual']);
  }

  /** Volver al login normal desde el segundo paso. */
  cancelarPlaza() {
    this.pasoPlaza = null;
    this.personasPlaza = [];
    this.elegidoPlaza = '';
    this.password = '';
  }
}