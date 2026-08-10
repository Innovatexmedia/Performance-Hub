import { Router } from 'express';
import { conversationController } from './conversation.controller.js';
import { validateAssign, validateStatus } from './conversation.validator.js';
import { withContext } from '../../../shared/helpers/lead.helpers.js';

import { messageController } from '../messages/message.controller.js';
import noteRoutes from '../notes/note.routes.js';
import tagRoutes from '../tags/tag.routes.js';
import deliveryLogRoutes from '../delivery-logs/delivery-log.routes.js';

/**
 * Mounted at /api/whatsapp/conversations.
 * Composes the conversation-scoped sub-resources (messages, notes, tags,
 * delivery-logs). Multi-segment routes are declared before "/:id".
 */
const router = Router();
router.use(withContext);

router.get('/', conversationController.list);

// for API testing only
router.get('/', conversationController.list);
router.post('/', conversationController.create);
router.post('/for-lead/:leadId', conversationController.findOrCreateForLead);


// Conversation-scoped messages list (send/simulate live under /messages).
router.get('/:id/messages', messageController.listForConversation);

// Real infinite-scroll-up backing -- GET /:id/older-messages?before=<ISO timestamp>
router.get('/:id/older-messages', conversationController.loadOlderMessages);

router.post('/:id/assign', validateAssign, conversationController.assign);
router.patch('/:id/status', validateStatus, conversationController.changeStatus);

router.use('/:id/notes', noteRoutes);
router.use('/:id/tags', tagRoutes);
router.use('/:id/delivery-logs', deliveryLogRoutes);

// Generic detail last so it doesn't shadow the sub-resource routes.
router.get('/:id', conversationController.details);

export default router;