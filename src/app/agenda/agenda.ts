import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { Firestore, collection, addDoc, query, onSnapshot, doc, updateDoc, deleteDoc } from '@angular/fire/firestore';

@Component({
  selector: 'app-agenda',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './agenda.html',
  styleUrls: ['./agenda.css']
})
export class AgendaComponent implements OnInit {
  isMenuOpen = false;
  currentUser: any = null;
  nuevaTareaTexto: string = '';
  tareasPersonales: any[] = [];

  // Inyecciones
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private router = inject(Router);

ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) {
      this.currentUser = JSON.parse(sesion);
      
      // 🔥 NUESTRO CHISMOSO: Va a imprimir todo lo que tiene tu usuario
      console.log('🕵️‍♂️ DATOS DEL USUARIO:', this.currentUser); 
      
      this.cargarAgenda();
    } else {
      this.router.navigate(['/login']);
    }
  }

  toggleMenu() {
    this.isMenuOpen = !this.isMenuOpen;
  }

  async cerrarSesion() {
    try {
      await this.auth.signOut();
      localStorage.removeItem('md_sesion_actual');
      this.router.navigate(['/login']);
    } catch (error) {
      console.error('Error al cerrar sesión', error);
    }
  }

cargarAgenda() {
    // Buscamos el ID sin importar cómo se llame en tu localStorage
const userId = this.currentUser?.uid || this.currentUser?.id || this.currentUser?.idUsuario || this.currentUser?.correo;    
    if (!userId) {
      console.error('❌ No se encontró el ID del usuario en la sesión.');
      return;
    }

    console.log('📡 Conectando a la agenda del usuario:', userId);
    
    const agendaRef = collection(this.firestore, `usuarios/${userId}/agenda`);
    const q = query(agendaRef);
    
    onSnapshot(q, (snapshot) => {
      this.tareasPersonales = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })).sort((a: any, b: any) => b.fechaCreacion - a.fechaCreacion);
      
      console.log('✅ Tareas cargadas:', this.tareasPersonales);
    }, (error) => {
      console.error('❌ Error de Firebase al leer la agenda:', error);
    });
  }

  async agregarTarea() {
    if (!this.nuevaTareaTexto.trim()) return;

const userId = this.currentUser?.uid || this.currentUser?.id || this.currentUser?.idUsuario || this.currentUser?.correo;    if (!userId) {
      alert('Error de sesión: No detecto tu ID de usuario.');
      return;
    }

    const tarea = {
      texto: this.nuevaTareaTexto,
      completada: false,
      fechaCreacion: Date.now()
    };

    try {
      const colRef = collection(this.firestore, `usuarios/${userId}/agenda`);
      await addDoc(colRef, tarea);
      console.log('💾 Tarea guardada con éxito en Firebase.');
      this.nuevaTareaTexto = ''; // Limpiamos el input
    } catch (error) {
      console.error("❌ Error de permisos al guardar en Firebase:", error);
      alert('No se pudo guardar la tarea. Revisa la consola F12.');
    }
  }

  async toggleTarea(tarea: any) {
    try {
      const docRef = doc(this.firestore, `usuarios/${this.currentUser.uid}/agenda/${tarea.id}`);
      await updateDoc(docRef, { completada: !tarea.completada });
    } catch (error) {
      console.error("Error actualizando tarea", error);
    }
  }

  async eliminarTarea(id: string) {
    try {
      const docRef = doc(this.firestore, `usuarios/${this.currentUser.uid}/agenda/${id}`);
      await deleteDoc(docRef);
    } catch (error) {
      console.error("Error eliminando tarea", error);
    }
  }
}