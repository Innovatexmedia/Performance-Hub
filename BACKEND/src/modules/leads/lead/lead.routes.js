import { Router } from 'express';
import { upload } from '../../../shared/middlewares/upload.middleware.js';
import { authenticate } from '../../../shared/middlewares/auth.middleware.js';

import { leadController } from './lead.controller.js';
import { validateCreateLead, validateUpdateLead } from './lead.validator.js';
import { withContext } from '../../../shared/helpers/lead.helpers.js';
import { authorize, ACTIONS } from '../../../shared/permissions/lead.permissions.js';

// Sub-feature routers / controllers composed under /api/leads.
import noteRoutes from '../notes/note.routes.js';
import activityRoutes from '.././activities/activity.routes.js';
import assignmentRoutes from '../assignments/assignment.routes.js';
import { exportController } from '../exports/export.controller.js';
import { importController } from '../imports/import.controller.js';
import groupRoutes from '../groups/group.routes.js';

/**
 * Lead routes — mount at: app.use('/api/leads', leadRoutes)
 *
 * Static / multi-segment paths are declared BEFORE "/:id" so they are not
 * captured by the param route.
 */
const router = Router();
router.use(authenticate);

router.use(withContext);

// --- static collection-level routes (before "/:id") ---------------------
router.get('/export', authorize(ACTIONS.EXPORT), exportController.exportCsv);
// router.post('/import', authorize(ACTIONS.IMPORT), importController.importCsv);
router.post('/import', authorize(ACTIONS.IMPORT), upload.single('file'), importController.importCsv
);
router.get('/import/:id', authorize(ACTIONS.IMPORT), importController.getImportStatus);
router.get('/constants', authorize(ACTIONS.READ), leadController.constants);
router.use('/groups', groupRoutes);

// --- nested sub-resources ----------------------------------------------
router.use('/:id/notes', noteRoutes); // Phase 8
router.use('/:id/activities', activityRoutes); // Phase 9 (timeline)
router.use(assignmentRoutes); // /:id/assign, /:id/unassign, /:id/assign/auto, /assign/bulk

router.get('/:id/details', authorize(ACTIONS.READ), leadController.details); // Phase 10
router.post('/:id/restore', authorize(ACTIONS.DELETE), leadController.restore); // un-archive

// --- core CRUD ----------------------------------------------------------
router
  .route('/')
  .get(authorize(ACTIONS.READ), leadController.list)
  .post(authorize(ACTIONS.CREATE), validateCreateLead, leadController.create);

router
  .route('/:id')
  .get(authorize(ACTIONS.READ), leadController.get)
  .patch(authorize(ACTIONS.UPDATE), validateUpdateLead, leadController.update) 
  .delete(authorize(ACTIONS.DELETE), leadController.archive);

export default router;