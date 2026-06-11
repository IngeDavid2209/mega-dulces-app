// Las tareas unicas son sub-recurso de Usuario.
// Se montan en server.ts bajo /api/usuarios/:usuarioId/tareas-unicas con mergeParams.
import { Router } from 'express';
import * as ctrl from '../controllers/tareas-unicas.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/errors.js';

// mergeParams: true → permite acceder a req.params.usuarioId desde el router padre.
const router = Router({ mergeParams: true });

router.get('/',          requireAuth, asyncHandler(ctrl.list));
router.post('/',         requireAuth, asyncHandler(ctrl.create));
router.put('/:id',       requireAuth, asyncHandler(ctrl.update));
router.delete('/:id',    requireAuth, asyncHandler(ctrl.remove));

export default router;
