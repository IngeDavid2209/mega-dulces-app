import { Router } from 'express';
import * as ctrl from '../controllers/usuarios.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/roles.js';
import { asyncHandler } from '../utils/errors.js';
import tareasUnicasRouter from './tareas-unicas.routes.js';
import agendaRouter from './agenda.routes.js';

const router = Router();

router.get('/',       requireAuth,                  asyncHandler(ctrl.list));
router.get('/:id',    requireAuth,                  asyncHandler(ctrl.getById));
router.put('/:id',    requireAuth, requireAdmin,    asyncHandler(ctrl.update));
router.delete('/:id', requireAuth, requireAdmin,    asyncHandler(ctrl.remove));

// Sub-recursos del usuario
router.use('/:usuarioId/tareas-unicas', tareasUnicasRouter);
router.use('/:usuarioId/agenda',        agendaRouter);

export default router;
