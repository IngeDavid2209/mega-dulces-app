// Rutas de autenticacion: register, login, me.
import { Router } from 'express';
import { register, login, me } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/roles.js';

const router = Router();

// Publico
router.post('/login', login);

// Requiere admin (solo admin crea usuarios — replica regla esAdmin() de Firestore)
router.post('/register', requireAuth, requireAdmin, register);

// Requiere sesion valida
router.get('/me', requireAuth, me);

export default router;
