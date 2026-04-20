import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth, signInWithEmailAndPassword } from '@angular/fire/auth';
// 🔥 Agregamos doc y setDoc aquí:
import { Firestore, collection, getDocs, doc, setDoc } from '@angular/fire/firestore';
import Swal from 'sweetalert2';

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
  ingresando = false; 

  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private router = inject(Router);

  async ingresar() {
    if (!this.usuario || !this.password) {
      Swal.fire({ icon: 'warning', title: 'Campos Vacíos', text: 'Por favor, ingresa tu usuario y contraseña.', confirmButtonColor: '#0F172A' });
      return;
    }
    this.ingresando = true;

    if (this.usuario === 'admin' && this.password === '123456') {
      const adminSeguridad = {
        nombre: 'Administrador Supremo', usuario: 'admin', rol: 'admin',
        puedeCrearChecklists: true, puedeCrearRutinas: true, puedeCrearTareasUnicas: true,
        puedeVerCheckstore: true, puedeVerEstadisticas: true, puedeVerHistorial: true, puedeAdministrarPersonal: true
      };
      localStorage.setItem('md_sesion_actual', JSON.stringify(adminSeguridad));
      this.router.navigate(['/home']);
      this.ingresando = false;
      return;
    }

    try {
      const usuariosRef = collection(this.firestore, 'usuarios');
      const snapshot = await getDocs(usuariosRef);
      let usuarioEncontrado: any = null;
      let userId = ''; // 🔥 Capturamos el ID del documento para actualizarlo

      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        if (data['usuario'] === this.usuario || data['correo'] === this.usuario) {
          usuarioEncontrado = data;
          userId = docSnap.id;
        }
      });

      if (!usuarioEncontrado) {
        Swal.fire({ icon: 'error', title: 'Usuario no encontrado', text: 'No existe ningún colaborador o administrador con ese nombre de usuario.', confirmButtonColor: '#0F172A' });
        this.ingresando = false; return;
      }

      const correoParaFirebase = usuarioEncontrado.correo;
      await signInWithEmailAndPassword(this.auth, correoParaFirebase, this.password);

      // =======================================================
      // 🔥 LÓGICA DE CHECK-IN (MONITOR DE OPERACIONES) 🔥
      // =======================================================
      const ahora = new Date();
      const horaEntrada = ahora.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

      // Guardamos la hora en Firebase de forma silenciosa
      await setDoc(doc(this.firestore, 'usuarios', userId), { 
        ultimoAcceso: ahora.toISOString(),
        horaEntrada: horaEntrada
      }, { merge: true });

      // Actualizamos el usuario para el localStorage local
      usuarioEncontrado.ultimoAcceso = ahora.toISOString();
      usuarioEncontrado.horaEntrada = horaEntrada;
      // =======================================================

      localStorage.setItem('md_sesion_actual', JSON.stringify(usuarioEncontrado));
      
      this.usuario = '';
      this.password = '';
      this.router.navigate(['/home']);
    } catch (error: any) {
      console.error("Error de Firebase:", error);
      Swal.fire({ icon: 'error', title: 'Acceso Denegado', text: 'La contraseña es incorrecta. Intenta de nuevo.', confirmButtonColor: '#0F172A' });
    } finally {
      this.ingresando = false;
    }
  }
}