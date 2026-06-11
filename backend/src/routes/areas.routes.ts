import { Router } from 'express';
import * as ctrl from '../controllers/areas.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/roles.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

// Reglas Firestore: read auth, write admin.
router.get('/',        requireAuth,                  asyncHandler(ctrl.list));
router.get('/:id',     requireAuth,                  asyncHandler(ctrl.getById));
router.post('/',       requireAuth, requireAdmin,    asyncHandler(ctrl.create));
router.put('/:id',     requireAuth, requireAdmin,    asyncHandler(ctrl.update));
router.delete('/:id',  requireAuth, requireAdmin,    asyncHandler(ctrl.remove));

export default router;
