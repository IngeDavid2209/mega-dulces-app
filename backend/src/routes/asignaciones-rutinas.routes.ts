import { Router } from 'express';
import * as ctrl from '../controllers/asignaciones-rutinas.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermiso } from '../middleware/roles.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

router.get('/',       requireAuth,                                       asyncHandler(ctrl.list));
router.get('/:id',    requireAuth,                                       asyncHandler(ctrl.getById));
router.post('/',      requireAuth, requirePermiso('puedeCrearRutinas'),  asyncHandler(ctrl.create));
router.put('/:id',    requireAuth, requirePermiso('puedeCrearRutinas'),  asyncHandler(ctrl.update));
router.delete('/:id', requireAuth, requirePermiso('puedeCrearRutinas'),  asyncHandler(ctrl.remove));

export default router;
