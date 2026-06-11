import { Router } from 'express';
import * as ctrl from '../controllers/tareas-equipo.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermiso, requireAdmin } from '../middleware/roles.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

router.get('/',                requireAuth,                                            asyncHandler(ctrl.list));
router.get('/:id',             requireAuth,                                            asyncHandler(ctrl.getById));
router.post('/',               requireAuth, requirePermiso('puedeCrearTareasUnicas'),  asyncHandler(ctrl.create));
router.put('/:id',             requireAuth, requirePermiso('puedeCrearTareasUnicas'),  asyncHandler(ctrl.update));
router.post('/:id/cerrar',     requireAuth, requirePermiso('puedeCrearTareasUnicas'),  asyncHandler(ctrl.cerrar));
router.delete('/:id',          requireAuth, requireAdmin,                              asyncHandler(ctrl.remove));

export default router;
