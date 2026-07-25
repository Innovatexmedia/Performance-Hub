import { Router } from 'express';

import { authenticate } from '../../shared/middlewares/auth.middleware.js';
import { resolveTenant } from '../../shared/middlewares/tenant.middleware.js';
import { withContext } from '../../shared/helpers/lead.helpers.js';

import inboxRoutes from './submodules/inbox/inbox.routes.js';
import conversationRoutes from './conversations/conversation.routes.js';
import messageRoutes from './messages/message.routes.js';
import contactsRoutes from './submodules/contacts/contacts.routes.js';
import templatesRoutes from './submodules/templates/templates.routes.js';
import {
  templateApprovalRoutes,
  templateApprovalWebhookRoutes,
} from './submodules/templateApproval/templateApproval.routes.js';
import campaignsRoutes from './submodules/campaigns/campaigns.routes.js';
import broadcastsRoutes from './submodules/broadcasts/broadcasts.routes.js';
import nurturesRoutes from './submodules/nurtures/nurtures.routes.js';
import aiReplyAssistantRoutes from './submodules/aiReplyAssistant/aiReplyAssistant.routes.js';
import automationRulesRoutes   from './submodules/automationRules/automationRules.routes.js';
import deliveryLogsRoutes      from './submodules/deliveryLogs/deliveryLogs.routes.js';
import consentRoutes           from './submodules/consent/consent.routes.js';
import whatsappAnalyticsRoutes  from './submodules/whatsappAnalytics/whatsappAnalytics.routes.js';
import whatsappSettingsRoutes   from './submodules/whatsappSettings/whatsappSettings.routes.js';
import metaWebhookRoutes        from './webhooks/metaWebhook.routes.js';

const whatsappRouter = Router();

/**
 * PUBLIC WEBHOOKS -- mounted BEFORE authenticate.
 *
 * templateApprovalWebhookRoutes receives callbacks from the WhatsApp
 * provider (Meta/WATI/etc.) -- those requests never carry a JWT, so this
 * route MUST be reachable without authenticate/resolveTenant/withContext.
 * Tenant identity for this route comes from the webhook payload itself
 * (see templateApproval.controller.js). Fixed: this used to be mounted
 * AFTER whatsappRouter.use(authenticate) below, which meant every real
 * provider callback was rejected with 401 before it ever reached the
 * handler -- manual Postman calls only "worked" because a JWT was
 * attached by hand, masking the bug.
 *
 * metaWebhookRoutes -- same reasoning, same fix pattern: Meta cannot send
 * our JWT either. Tenant identity comes from the URL itself (/:tenantId),
 * and request authenticity comes from the HMAC signature check inside the
 * controller (see metaWebhook.controller.js), not from a JWT.
 */
whatsappRouter.use('/template-approval', templateApprovalWebhookRoutes);
whatsappRouter.use('/webhooks/meta', metaWebhookRoutes);

/**
 * Authentication FIRST for everything else
 */
whatsappRouter.use(authenticate);

/**
 * Resolve tenant
 */
whatsappRouter.use(resolveTenant);

/**
 * Build request context from authenticated user
 */
whatsappRouter.use(withContext);

/**
 * Feature modules
 */
whatsappRouter.use('/inbox', inboxRoutes);
whatsappRouter.use('/conversations', conversationRoutes);
whatsappRouter.use('/messages', messageRoutes);
whatsappRouter.use('/contacts', contactsRoutes);

whatsappRouter.use('/templates', templatesRoutes);
whatsappRouter.use('/templates', templateApprovalRoutes);

whatsappRouter.use('/campaigns', campaignsRoutes);
whatsappRouter.use('/broadcasts', broadcastsRoutes);
whatsappRouter.use('/nurtures', nurturesRoutes);
whatsappRouter.use('/ai', aiReplyAssistantRoutes);
whatsappRouter.use('/automation-rules', automationRulesRoutes);
whatsappRouter.use('/delivery-logs', deliveryLogsRoutes);
whatsappRouter.use('/consent', consentRoutes);
whatsappRouter.use('/analytics', whatsappAnalyticsRoutes);
whatsappRouter.use('/settings', whatsappSettingsRoutes);

export default whatsappRouter;