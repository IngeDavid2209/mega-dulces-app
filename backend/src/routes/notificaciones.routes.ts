import { Router } from 'express';
import * as ctrl from '../controllers/notificaciones.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

router.get('/',                requireAuth, asyncHandler(ctrl.list));
router.post('/',               requireAuth, asyncHandler(ctrl.create));
router.patch('/:id/leida',     requireAuth, asyncHandler(ctrl.marcarLeida));
router.delete('/:id',          requireAuth, asyncHandler(ctrl.remove));

// Tokens FCM (estos endpoints reemplazan la coleccion `usuarios_tokens` de Firestore).
router.get('/tokens',           requireAuth, asyncHandler(ctrl.listarTokens));
router.post('/tokens',          requireAuth, asyncHandler(ctrl.registrarToken));
// DELETE acepta JWT o service secret (handler decide). No usamos requireAuth aqui
// para permitir limpieza desde notify-update.js sin que la function tenga JWT.
router.delete('/tokens/:token', asyncHandler(ctrl.borrarToken));

export default router;
