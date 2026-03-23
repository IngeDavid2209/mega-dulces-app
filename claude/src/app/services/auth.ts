import { inject, Injectable, signal } from '@angular/core';
import { 
  Auth, 
  authState, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  User 
} from '@angular/fire/auth';
import { Firestore, doc, setDoc } from '@angular/fire/firestore';
import { Router } from '@angular/router';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private router = inject(Router);
  currentUserSig = signal<User | null | undefined>(undefined);

  constructor() {
    authState(this.auth).subscribe((user) => {
      this.currentUserSig.set(user);
    });
  }

  async login(email: string, pass: string) {
    return signInWithEmailAndPassword(this.auth, email, pass);
  }

  async register(email: string, pass: string, name: string, role: string) {
    const credential = await createUserWithEmailAndPassword(this.auth, email, pass);
    
    // Guarda los datos en Firestore para que sepas quién es Gerente o Empleado
    await setDoc(doc(this.firestore, 'users', credential.user.uid), {
      name,
      role,
      email,
      createdAt: new Date()
    });
    
    return credential;
  }

  async logout() {
    await signOut(this.auth);
    this.router.navigate(['/login']);
  }
}