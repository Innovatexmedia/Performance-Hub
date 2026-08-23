
import { Router } from 'express';
import { withContext } from '../../../../shared/helpers/lead.helpers.js';
import { savedRepliesController } from './savedReplies.controller.js';
import { validateCreate, validateUpdate, validateIdParam } from './savedReplies.validator.js';

const router = Router();
router.use(withContext);

router
  .route('/')
  .get(savedRepliesController.list) // GET /api/whatsapp/saved-replies
  .post(validateCreate, savedRepliesController.create); // POST /api/whatsapp/saved-replies

router
  .route('/:id')
  .patch(validateUpdate, savedRepliesController.update) // PATCH /api/whatsapp/saved-replies/:id
  .delete(validateIdParam, savedRepliesController.remove); // DELETE /api/whatsapp/saved-replies/:id

export default router;