// =============================================================================
// AuthService unificado: Firebase Auth (legacy) + backend propio (Fase 5)
// =============================================================================
// Mientras el flag `environment.useBackend` esta en false, este servicio sigue
// trabajando contra Firebase Auth + Firestore exactamente como antes. Cuando
// se pone en true (cutover de sub-fase H), las mismas funciones publicas usan
// el backend Node/Express:
//
//   login()  → POST /api/auth/login   guarda JWT en localStorage y perfil en
//                                    md_sesion_actual.
//   logout() → limpia ambos y redirige.
//
// La interfaz publica (currentUserSig, login, register, logout) NO cambia, por
// eso ningun componente que ya use este servicio necesita modificarse.
import { inject, Injectable, signal } from '@angular/core';
import {
  Auth, authState, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, User
} from '@angular/fire/auth';
import { Firestore, doc, setDoc } from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import { AuthApi } from '../api/auth.api';
import { guardarTokenJwt, leerTokenJwt } from '../core/jwt.interceptor';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private router = inject(Router);
  private authApi = inject(AuthApi);

  /** Usuario actual. En modo Firebase legacy guarda el `User` de Firebase Auth.
   *  En modo backend guarda el perfil completo (igual que md_sesion_actual). */
  currentUserSig = signal<User | any | null | undefined>(undefined);

  constructor() {
    if (environment.useBackend) {
      // Si hay token, intentamos rehidratar el perfil desde /me en cada arranque.
      // Si falla, dejamos null y el guard redirige a /login.
      this.rehidratarDesdeBackend();
    } else {
      // Modo Firebase: el currentUserSig refleja el User de Firebase Auth
      authState(this.auth).subscribe(u => this.currentUserSig.set(u));
    }
  }

  // ---------- LOGIN ----------
  async login(usuarioOCorreo: string, password: string) {
    if (environment.useBackend) {
      const res = await firstValueFrom(this.authApi.login({ usuario: usuarioOCorreo, password }));
      guardarTokenJwt(res.token);
      try { localStorage.setItem('md_sesion_actual', JSON.stringify(res.user)); } catch {}
      this.currentUserSig.set(res.user);
      return res;
    }
    // Legacy: el caller (login.ts) tipicamente ya resolvio el correo. Para
    // mantener compatibilidad, aceptamos directamente el correo.
    return signInWithEmailAndPassword(this.auth, usuarioOCorreo, password);
  }

  // ---------- REGISTER (legacy — el front nuevo registra desde /api/auth/register) ----------
  async register(email: string, pass: string, name: string, role: string) {
    if (environment.useBackend) {
      throw new Error(
        'El registro abierto esta deshabilitado en modo backend. Crea el usuario ' +
        'desde el modulo Personal (que llama a POST /api/auth/register con sesion de admin).'
      );
    }
    const credential = await createUserWithEmailAndPassword(this.auth, email, pass);
    await setDoc(doc(this.firestore, 'users', credential.user.uid), {
      name, role, email, createdAt: new Date(),
    });
    return credential;
  }

  // ---------- LOGOUT ----------
  async logout() {
    if (environment.useBackend) {
      guardarTokenJwt(null);
    } else {
      try { await signOut(this.auth); } catch { /* no-op si no hay sesion */ }
    }
    try { localStorage.removeItem('md_sesion_actual'); } catch {}
    this.currentUserSig.set(null);
    this.router.navigate(['/login']);
  }

  // ---------- helpers internos ----------
  /** Si hay JWT al cargar la app, sincroniza el perfil desde /me. */
  private async rehidratarDesdeBackend(): Promise<void> {
    const token = leerTokenJwt();
    if (!token) { this.currentUserSig.set(null); return; }
    try {
      const res = await firstValueFrom(this.authApi.me());
      this.currentUserSig.set(res.user);
      try { localStorage.setItem('md_sesion_actual', JSON.stringify(res.user)); } catch {}
    } catch {
      // Token invalido / backend caido: limpiamos para forzar login.
      guardarTokenJwt(null);
      this.currentUserSig.set(null);
    }
  }
}
