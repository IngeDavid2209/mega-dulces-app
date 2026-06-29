import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router'; 
import { Auth, updateEmail,verifyBeforeUpdateEmail, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from '@angular/fire/auth';
import { Firestore, doc, updateDoc, setDoc } from '@angular/fire/firestore';
import Swal from 'sweetalert2';
import { SidebarComponent } from '../../../shared/sidebar/sidebar';

@Component({
  selector: 'app-perfil',
  standalone: true,
  imports: [CommonModule, FormsModule,RouterModule, SidebarComponent],
  templateUrl: './perfil.html',
  styleUrls: ['./perfil.css']
})
export class PerfilComponent implements OnInit {
  private auth = inject(Auth);
  private firestore = inject(Firestore);

  isMenuOpen = false;
  currentUser: any = null;
  formCorreo = '';
  formPassword = '';
  formTelefono = '';
  subiendoFoto = false;

  ngOnInit() {
    // Cargamos los datos del usuario que está conectado
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) {
      this.currentUser = JSON.parse(sesion);
      this.formCorreo = this.currentUser.correo || '';
      this.formTelefono = this.currentUser.telefono || '';
      // La contraseña la dejamos en blanco por seguridad, que la escriban si quieren cambiarla
    }
  }

// Asegúrate de tener 'verifyBeforeUpdateEmail' importado en la parte de arriba:
// import { Auth, updatePassword, reauthenticateWithCredential, EmailAuthProvider, verifyBeforeUpdateEmail } from '@angular/fire/auth';

  private miUid(): string {
    return this.auth.currentUser?.uid || this.currentUser?.uid || this.currentUser?.id || '';
  }

  /** Redimensiona la imagen a una miniatura cuadrada (~256px) en JPEG para que
   *  pese poco y quepa sin problema en Firestore. Devuelve un data URL. */
  private redimensionar(file: File, max = 256): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const lado = Math.min(img.width, img.height);
          const sx = (img.width - lado) / 2;
          const sy = (img.height - lado) / 2;
          const canvas = document.createElement('canvas');
          canvas.width = max; canvas.height = max;
          const ctx = canvas.getContext('2d');
          if (!ctx) { reject('no-canvas'); return; }
          ctx.drawImage(img, sx, sy, lado, lado, 0, 0, max, max);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = reject;
        img.src = reader.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async onFotoSeleccionada(event: any) {
    const file: File = event?.target?.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      Swal.fire('Archivo no válido', 'Selecciona una imagen (JPG o PNG).', 'warning');
      return;
    }
    const uid = this.miUid();
    if (!uid) { Swal.fire('Error', 'No hay sesión activa.', 'error'); return; }

    this.subiendoFoto = true;
    try {
      const dataUrl = await this.redimensionar(file);
      await updateDoc(doc(this.firestore, 'usuarios', uid), { fotoPerfil: dataUrl });
      this.currentUser.fotoPerfil = dataUrl;
      localStorage.setItem('md_sesion_actual', JSON.stringify(this.currentUser));
      Swal.fire('✅ Listo', 'Tu foto de perfil se actualizó.', 'success');
    } catch (e: any) {
      console.error('[perfil] foto', e);
      Swal.fire('❌ Error', 'No se pudo guardar la foto. Intenta con otra imagen.', 'error');
    } finally {
      this.subiendoFoto = false;
      if (event?.target) event.target.value = '';
    }
  }

  async quitarFoto() {
    const uid = this.miUid();
    if (!uid) return;
    const r = await Swal.fire({ title: 'Quitar foto', text: '¿Quitar tu foto de perfil?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Sí, quitar', cancelButtonText: 'Cancelar', confirmButtonColor: '#DC2626' });
    if (!r.isConfirmed) return;
    try {
      await updateDoc(doc(this.firestore, 'usuarios', uid), { fotoPerfil: '' });
      this.currentUser.fotoPerfil = '';
      localStorage.setItem('md_sesion_actual', JSON.stringify(this.currentUser));
    } catch (e) { console.error('[perfil] quitarFoto', e); }
  }

  async actualizarMisDatos() {
    const correoActual = this.currentUser?.correo || '';
    const correoCambia = !!this.formCorreo && this.formCorreo !== correoActual;
    const passwordCambia = !!this.formPassword;
    const telefonoCambia = (this.formTelefono || '') !== (this.currentUser?.telefono || '');

    if (passwordCambia && this.formPassword.length < 6) {
      Swal.fire('Atención', 'La nueva contraseña debe tener al menos 6 caracteres.', 'warning');
      return;
    }

    // ── CASO SIMPLE: solo cambió el TELÉFONO ──────────────────────────────
    // El teléfono es un dato informativo en Firestore: NO requiere Firebase
    // Auth ni re-autenticación. Antes fallaba porque se exigía sesión de Auth
    // aunque solo se quisiera cambiar el teléfono.
    if (!correoCambia && !passwordCambia) {
      if (!telefonoCambia) {
        Swal.fire('Sin cambios', 'No modificaste ningún dato.', 'info');
        return;
      }
      const uid = this.miUid();
      if (!uid) { Swal.fire('Error', 'No se pudo identificar tu usuario.', 'error'); return; }
      try {
        await updateDoc(doc(this.firestore, 'usuarios', uid), { telefono: this.formTelefono });
        this.currentUser.telefono = this.formTelefono;
        localStorage.setItem('md_sesion_actual', JSON.stringify(this.currentUser));
        Swal.fire('✅ ¡Éxito!', 'Tu teléfono se actualizó correctamente.', 'success');
      } catch (e: any) {
        console.error('[perfil] telefono', e);
        Swal.fire('❌ Error', 'No se pudo guardar el teléfono. Intenta de nuevo.', 'error');
      }
      return;
    }

    // ── CASO CORREO / CONTRASEÑA: sí requiere Firebase Auth ───────────────
    const user = this.auth.currentUser;
    if (!user) {
      Swal.fire('Vuelve a iniciar sesión', 'Para cambiar tu correo o contraseña necesitas tu sesión activa. Cierra sesión, vuelve a entrar e intenta de nuevo. (El teléfono sí puedes cambiarlo sin esto.)', 'info');
      return;
    }

    try {
      // 1. RE-AUTENTICACIÓN (Obligatorio para que Firebase nos deje cambiar el correo)
      const { value: passActual } = await Swal.fire({
        title: 'Confirmación de Seguridad',
        text: 'Ingresa tu contraseña ACTUAL para autorizar estos cambios:',
        input: 'password',
        confirmButtonColor: '#0F172A',
        showCancelButton: true,
        cancelButtonText: 'Cancelar'
      });

      if (!passActual) return;

      const credential = EmailAuthProvider.credential(user.email!, passActual);
      await reauthenticateWithCredential(user, credential);

      let correoCambiado = false;

      // 2. CAMBIO DE CORREO (La magia sucede aquí)
      if (this.formCorreo && this.formCorreo !== user.email) {
        // Envia el link de confirmación al nuevo correo
        await verifyBeforeUpdateEmail(user, this.formCorreo);
        correoCambiado = true;
      }

      // 3. CAMBIO DE CONTRASEÑA
      if (this.formPassword && this.formPassword.length >= 6) {
        await updatePassword(user, this.formPassword);
      } else if (this.formPassword && this.formPassword.length < 6) {
        Swal.fire('Atención', 'La nueva contraseña debe tener al menos 6 caracteres.', 'warning');
        return;
      }

      // 4. CAMBIO DE DATOS EN TU TABLA DE FIRESTORE
      const userRef = doc(this.firestore, 'usuarios', user.uid);
      
      const payload: any = {
        correo: this.formCorreo,
        telefono: this.formTelefono
      };
      if (this.formPassword) {
        payload.password = this.formPassword;
      }

      await updateDoc(userRef, payload);

      // 4b. SINCRONIZAR EL ÍNDICE DE LOGIN (indice_login/{usuario} → { correo, uid }).
      // El login por NOMBRE DE USUARIO resuelve el correo desde este índice. Si
      // cambia el correo y no se actualiza aquí, el login por usuario se rompe.
      // Lo dejamos apuntando al correo nuevo para que el estado final sea correcto
      // una vez que el usuario confirme el enlace de verificación.
      if (correoCambiado && this.currentUser?.usuario) {
        try {
          await setDoc(doc(this.firestore, 'indice_login', String(this.currentUser.usuario).trim().toLowerCase()),
            { correo: this.formCorreo, uid: user.uid });
        } catch (e) { console.error('[perfil] indice_login', e); }
      }

      // Actualizamos la sesión en la memoria de la computadora
      this.currentUser.correo = this.formCorreo;
      this.currentUser.telefono = this.formTelefono;
      if (this.formPassword) this.currentUser.password = this.formPassword;
      localStorage.setItem('md_sesion_actual', JSON.stringify(this.currentUser));

      this.formPassword = ''; // Limpiamos la cajita de contraseña por seguridad

      // 5. AVISO AL USUARIO
      if (correoCambiado) {
        Swal.fire('¡Confirma tu nuevo correo!',
          `Enviamos un enlace a ${this.formCorreo}. Ábrelo y haz clic para confirmar el cambio.\n\n` +
          `IMPORTANTE: hasta que confirmes, sigue iniciando sesión con tu correo ANTERIOR. ` +
          `Una vez confirmado, usa el nuevo. Tus demás datos ya se guardaron.`,
          'info');
      } else {
        Swal.fire('✅ ¡Éxito!', 'Tus datos han sido actualizados correctamente.', 'success');
      }

    } catch (error: any) {
      console.error(error);
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        Swal.fire('❌ Error', 'La contraseña actual es incorrecta.', 'error');
      } else if (error.code === 'auth/requires-recent-login') {
        Swal.fire('❌ Error de Seguridad', 'Por favor cierra sesión y vuelve a entrar para poder cambiar tu correo.', 'error');
      } else {
        Swal.fire('❌ Error', 'Hubo un problema al actualizar: ' + error.message, 'error');
      }
    }
  }
}