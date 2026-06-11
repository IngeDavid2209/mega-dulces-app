import { Router } from 'express';
import * as ctrl from '../controllers/checklists.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin, requireAdminGlobal } from '../middleware/roles.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

// Lectura: cualquier autenticado (con filtro de visibilidad dentro del controller)
router.get('/',                          requireAuth,                       asyncHandler(ctrl.list));
router.get('/ranking',                   requireAuth,                       asyncHandler(ctrl.ranking));
router.get('/:id',                       requireAuth,                       asyncHandler(ctrl.getById));

// Creacion / actualizacion: cualquier autenticado (el cliente filtra por permisos)
router.post('/',                         requireAuth,                       asyncHandler(ctrl.create));
router.put('/:id',                       requireAuth,                       asyncHandler(ctrl.update));
router.patch('/by-firebase-id/:docIdFirebase', requireAuth,                 asyncHandler(ctrl.updateByFirebaseId));

// Soft-delete (cascada): admin
router.patch('/:id/soft-delete',         requireAuth, requireAdmin,         asyncHandler(ctrl.softDelete));

// Hard-delete: admin global (replica reglas: solo admin borra definitivo)
router.delete('/:id',                    requireAuth, requireAdminGlobal,   asyncHandler(ctrl.remove));

// Acciones masivas: solo admin global
router.post('/archivar-mes',             requireAuth, requireAdminGlobal,   asyncHandler(ctrl.archivarMes));
router.post('/marcar-fotos-borradas',    requireAuth, requireAdminGlobal,   asyncHandler(ctrl.marcarFotosBorradas));

export default router;
