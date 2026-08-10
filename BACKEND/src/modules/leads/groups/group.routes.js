import { Router } from 'express';
import { groupController } from './group.controller.js';
import { validateCreateGroup, validateUpdateGroup, validateAssignMembers } from './group.validator.js';
import { withContext } from '../../../shared/helpers/lead.helpers.js';
import { authorize, ACTIONS } from '../../../shared/permissions/lead.permissions.js';

/**
 * Group routes — mount at: app.use('/api/leads/groups', groupRoutes)
 * composed into lead.routes.js BEFORE the '/:id' param route, same pattern
 * as '/export' and '/constants'.
 *
 * Reuses lead:read / lead:update permissions rather than inventing a
 * separate permission set -- groups are a lead sub-feature, not a distinct
 * resource with its own access model.
 */
const router = Router();
router.use(withContext);

router
  .route('/')
  .get(authorize(ACTIONS.READ), groupController.list)
  .post(authorize(ACTIONS.UPDATE), validateCreateGroup, groupController.create);

router
  .route('/:id')
  .get(authorize(ACTIONS.READ), groupController.get)
  .patch(authorize(ACTIONS.UPDATE), validateUpdateGroup, groupController.update)
  .delete(authorize(ACTIONS.UPDATE), groupController.remove);

router.post('/:id/assign', authorize(ACTIONS.UPDATE), validateAssignMembers, groupController.assign);
router.put('/:id/members', authorize(ACTIONS.UPDATE), groupController.setMembers);

export default router;