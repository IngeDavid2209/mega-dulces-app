import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router'; 
import { Auth, updateEmail,verifyBeforeUpdateEmail, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from '@angular/fire/auth';
import { Firestore, doc, updateDoc } from '@angular/fire/firestore';
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

  async actualizarMisDatos() {
    const user = this.auth.currentUser;
    if (!user) {
      Swal.fire('Error', 'No hay sesión activa con Firebase Auth.', 'error');
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

      // Actualizamos la sesión en la memoria de la computadora
      this.currentUser.correo = this.formCorreo;
      this.currentUser.telefono = this.formTelefono;
      if (this.formPassword) this.currentUser.password = this.formPassword;
      localStorage.setItem('md_sesion_actual', JSON.stringify(this.currentUser));

      this.formPassword = ''; // Limpiamos la cajita de contraseña por seguridad

      // 5. AVISO AL USUARIO
      if (correoCambiado) {
        Swal.fire('¡Verifica tu correo!', `Hemos enviado un enlace a ${this.formCorreo}. Haz clic en él para confirmar tu nuevo correo. Tus demás datos se guardaron.`, 'info');
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