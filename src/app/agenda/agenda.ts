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
    if (!this.currentUser?.uid) return;
    
    // Apuntamos a la subcolección "agenda" dentro del documento del usuario actual
    const agendaRef = collection(this.firestore, `usuarios/${this.currentUser.uid}/agenda`);
    const q = query(agendaRef);
    
    // Escuchamos en tiempo real
    onSnapshot(q, (snapshot) => {
      this.tareasPersonales = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })).sort((a: any, b: any) => b.fechaCreacion - a.fechaCreacion); // Ordenamos de la más nueva a la más vieja
    });
  }

  async agregarTarea() {
    if (!this.nuevaTareaTexto.trim()) return;

    const tarea = {
      texto: this.nuevaTareaTexto,
      completada: false,
      fechaCreacion: Date.now()
    };

    try {
      const colRef = collection(this.firestore, `usuarios/${this.currentUser.uid}/agenda`);
      await addDoc(colRef, tarea);
      this.nuevaTareaTexto = ''; // Limpiamos el input
    } catch (error) {
      console.error("Error agregando tarea", error);
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