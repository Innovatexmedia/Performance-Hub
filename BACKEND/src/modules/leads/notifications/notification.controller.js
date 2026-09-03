/**
 * =============================================================================
 * InnovateX Revenue OS — Notification Controller
 * =============================================================================
 *
 * FILE: src/modules/leads/notifications/notification.controller.js
 *
 * Thin HTTP layer over notification.service.js's already-real functions
 * (createNotification is called from many places -- qualification,
 * payments, Automation Rules' NOTIFY_USER action, etc.). What was
 * missing was any endpoint for a user to actually READ their own
 * notifications -- this file, and notification.routes.js, are that.
 * =============================================================================
 */
import { notificationService } from './notification.service.js';
import { sendSuccess } from '../../../utils/apiResponse.js';
import asyncHandler from '../../../utils/asyncHandler.js';

/** GET /api/notifications -- ?page, ?limit, ?unreadOnly=true */
export const list = asyncHandler(async (req, res) => {
  const { page, limit, unreadOnly } = req.query;
  const result = await notificationService.getNotifications(req.user.tenantId, req.user.sub, {
    page: page ? Number(page) : undefined,
    limit: limit ? Number(limit) : undefined,
    unreadOnly: unreadOnly === 'true',
  });
  return sendSuccess(res, result, 'Notifications fetched');
});

/** GET /api/notifications/unread-count -- cheap poll target for the bell's badge */
export const unreadCount = asyncHandler(async (req, res) => {
  const count = await notificationService.getUnreadCount(req.user.tenantId, req.user.sub);
  return sendSuccess(res, { count }, 'Unread count fetched');
});

/** PATCH /api/notifications/:id/read */
export const markRead = asyncHandler(async (req, res) => {
  const notification = await notificationService.markRead(req.user.tenantId, req.user.sub, req.params.id);
  return sendSuccess(res, notification, 'Notification marked read');
});

/** PATCH /api/notifications/read-all */
export const markAllRead = asyncHandler(async (req, res) => {
  const result = await notificationService.markAllRead(req.user.tenantId, req.user.sub);
  return sendSuccess(res, result, 'All notifications marked read');
});