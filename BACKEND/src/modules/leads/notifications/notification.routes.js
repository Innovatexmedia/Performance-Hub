/**
 * Notification routes.
 *
 * FILE: src/modules/leads/notifications/notification.routes.js
 *
 * ROUTE MAP:
 *   GET   /api/notifications              -- list current user's notifications
 *   GET   /api/notifications/unread-count -- cheap poll target for the bell badge
 *   PATCH /api/notifications/:id/read     -- mark one as read
 *   PATCH /api/notifications/read-all     -- mark all as read
 *
 * Register in app.js:
 *   import notificationRoutes from './modules/leads/notifications/notification.routes.js';
 *   app.use('/api/notifications', notificationRoutes);
 */
import { Router } from 'express';
import * as controller from './notification.controller.js';
import { authenticate } from '../../../shared/middlewares/auth.middleware.js';
import { resolveTenant } from '../../../shared/middlewares/tenant.middleware.js';

const router = Router();

router.use(authenticate);
router.use(resolveTenant);

router.get('/unread-count', controller.unreadCount);
router.get('/', controller.list);
router.patch('/read-all', controller.markAllRead);
router.patch('/:id/read', controller.markRead);

export default router;