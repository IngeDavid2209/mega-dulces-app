import { Router } from 'express';
import * as ctrl from '../controllers/rutinas-catalogo.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermiso, requireAdminGlobal } from '../middleware/roles.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

router.get('/',                  requireAuth,                                    asyncHandler(ctrl.list));
router.get('/:id',               requireAuth,                                    asyncHandler(ctrl.getById));
router.post('/',                 requireAuth, requirePermiso('puedeCrearRutinas'), asyncHandler(ctrl.create));
router.put('/:id',               requireAuth, requirePermiso('puedeCrearRutinas'), asyncHandler(ctrl.update));
router.post('/:id/duplicar',     requireAuth, requirePermiso('puedeCrearRutinas'), asyncHandler(ctrl.duplicar));
router.post('/:id/archivar',     requireAuth, requirePermiso('puedeCrearRutinas'), asyncHandler(ctrl.archivar));
router.post('/:id/restaurar',    requireAuth, requirePermiso('puedeCrearRutinas'), asyncHandler(ctrl.restaurar));
router.delete('/:id',            requireAuth, requireAdminGlobal,                asyncHandler(ctrl.remove));

export default router;
