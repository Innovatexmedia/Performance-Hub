/**
 * Meta WhatsApp webhook routes.
 *
 * Mounted at: whatsappRouter.use('/webhooks/meta', metaWebhookRoutes)
 * → /api/whatsapp/webhooks/meta/:tenantId
 *
 * Deliberately NO authenticate/resolveTenant/withContext here -- Meta is
 * an external caller that cannot send our JWT. Security comes from the
 * per-tenant URL (tenantId is explicit, not guessed) plus HMAC signature
 * verification against that tenant's own appSecret (see
 * metaWebhook.controller.js). This mirrors the exact pattern already used
 * for src/modules/whatsapp/submodules/deliveryLogs's provider webhook --
 * same "public but signed" design, not a new one invented here.
 */
import { Router } from 'express';
import { metaWebhookController } from './metaWebhook.controller.js';

const router = Router();

router.get('/:tenantId', metaWebhookController.verify);
router.post('/:tenantId', metaWebhookController.receive);

export default router;