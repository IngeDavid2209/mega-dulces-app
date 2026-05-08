import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Auth, updateEmail, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from '@angular/fire/auth';
import { Firestore, doc, updateDoc } from '@angular/fire/firestore';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-perfil',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './perfil.html',
  styleUrls: ['./perfil.css']
})
export class PerfilComponent implements OnInit {
  private auth = inject(Auth);
  private firestore = inject(Firestore);

  currentUser: any = null;
  
  // Variables para el formulario
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

  async actualizarMisDatos() {
    const user = this.auth.currentUser;
    if (!user) {
      Swal.fire('Error', 'No hay sesión activa con Firebase Auth.', 'error');
      return;
    }

    try {
      // 1. RE-AUTENTICACIÓN
      const { value: passActual } = await Swal.fire({
        title: 'Confirmación de Seguridad',
        text: 'Ingresa tu contraseña ACTUAL para aplicar los cambios:',
        input: 'password',
        confirmButtonColor: '#0F172A',
        showCancelButton: true,
        cancelButtonText: 'Cancelar'
      });

      if (!passActual) return;

      const credential = EmailAuthProvider.credential(user.email!, passActual);
      await reauthenticateWithCredential(user, credential);

      // 2. CAMBIO DE CORREO
      if (this.formCorreo !== user.email) {
        await updateEmail(user, this.formCorreo);
      }

      // 3. CAMBIO DE CONTRASEÑA
      if (this.formPassword && this.formPassword.length >= 6) {
        await updatePassword(user, this.formPassword);
      } else if (this.formPassword && this.formPassword.length < 6) {
        Swal.fire('Atención', 'La nueva contraseña debe tener al menos 6 caracteres.', 'warning');
        return;
      }

      // 4. CAMBIO DE DATOS EN FIRESTORE
      const userRef = doc(this.firestore, 'usuarios', user.uid);
      
      const payload: any = {
        correo: this.formCorreo,
        telefono: this.formTelefono
      };
      // Si escribieron nueva contraseña, la actualizamos en el texto de Firestore también
      if (this.formPassword) {
        payload.password = this.formPassword;
      }

      await updateDoc(userRef, payload);

      // Actualizamos la sesión local
      this.currentUser.correo = this.formCorreo;
      this.currentUser.telefono = this.formTelefono;
      if (this.formPassword) this.currentUser.password = this.formPassword;
      localStorage.setItem('md_sesion_actual', JSON.stringify(this.currentUser));

      Swal.fire('✅ ¡Éxito!', 'Tus datos de acceso han sido actualizados. Tus próximos inicios de sesión serán con estos nuevos datos.', 'success');
      this.formPassword = ''; // Limpiamos el campo de contraseña

    } catch (error: any) {
      console.error(error);
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        Swal.fire('❌ Error', 'La contraseña actual es incorrecta.', 'error');
      } else {
        Swal.fire('❌ Error', 'No se pudieron actualizar los datos: ' + error.message, 'error');
      }
    }
  }
}