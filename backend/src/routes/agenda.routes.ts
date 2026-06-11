// Agenda: sub-recurso de Usuario. Se monta bajo /api/usuarios/:usuarioId/agenda.
import { Router } from 'express';
import * as ctrl from '../controllers/agenda.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router({ mergeParams: true });

router.get('/',       requireAuth, asyncHandler(ctrl.list));
router.post('/',      requireAuth, asyncHandler(ctrl.create));
router.put('/:id',    requireAuth, asyncHandler(ctrl.update));
router.delete('/:id', requireAuth, asyncHandler(ctrl.remove));

export default router;
