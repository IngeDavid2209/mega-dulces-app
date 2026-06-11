import { Router } from 'express';
import * as ctrl from '../controllers/descansos.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/roles.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

router.get('/',       requireAuth,                  asyncHandler(ctrl.list));
router.put('/',       requireAuth, requireAdmin,    asyncHandler(ctrl.upsert));   // upsert por (empleado, semanaIso)
router.delete('/:id', requireAuth, requireAdmin,    asyncHandler(ctrl.remove));

export default router;
