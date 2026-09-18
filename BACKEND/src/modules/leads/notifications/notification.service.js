/**
 * Notification Service — real ES Module implementation.
 *
 * FILE: src/modules/leads/notifications/notification.service.js
 *
 * WHAT CHANGED:
 *   - Replaced CommonJS (module.exports) with ES Module (export)
 *   - Replaced console.log with real Notification.create() DB writes
 *   - Added getNotifications, markRead, markAllRead for the notification bell
 *   - All fields match notification.model.js exactly:
 *     tenantId(String), userId(ObjectId), title, body, isRead, metadata
 *
 * SOURCE: FRONTEND_SPEC §3 Dashboard:
 *   "notification bell with unread count"
 * SOURCE: MASTER_SPEC §B20:
 *   "Notification bell with unread count, dropdown, mark read / mark all read;
 *    13 notification types."
 */

import Notification   from './notification.model.js';
import Tenant         from '../../auth/models/Tenant.js';
import { AppError }   from '../../../shared/helpers/lead.helpers.js';
import { emitToUser } from '../../../realtime/socket.js';

/**
 * NOTIFICATION_TYPE — the event a notification describes.
 *
 * Each value maps to one toggle in Settings > Notification Preferences. Those
 * toggles were saved to Tenant.notificationPreferences and then read by
 * nothing at all: every creator wrote its notification unconditionally, so
 * turning "deal lost" off changed exactly nothing. createNotification now
 * checks the matching preference before writing, which is what the UI has
 * been claiming all along.
 *
 * A notification with no `type` (a nurture task, an automation rule's
 * NOTIFY_USER action) has no toggle to consult and is always delivered --
 * these are explicitly configured by the user elsewhere, so silently
 * dropping them would be wrong.
 */
export const NOTIFICATION_TYPE = Object.freeze({
  HOT_LEAD_ALERT:    'hot_lead_alert',
  BOOKING_CREATED:   'booking_created',
  PAYMENT_RECEIVED:  'payment_received',
  TEMPLATE_APPROVED: 'template_approved',
  CAMPAIGN_SENT:     'campaign_sent',
  DEAL_WON:          'deal_won',
  DEAL_LOST:         'deal_lost',
});

/** Maps a notification type to its camelCase key on notificationPreferences. */
const TYPE_TO_PREFERENCE_KEY = Object.freeze({
  [NOTIFICATION_TYPE.HOT_LEAD_ALERT]:    'hotLeadAlert',
  [NOTIFICATION_TYPE.BOOKING_CREATED]:   'bookingCreated',
  [NOTIFICATION_TYPE.PAYMENT_RECEIVED]:  'paymentReceived',
  [NOTIFICATION_TYPE.TEMPLATE_APPROVED]: 'templateApproved',
  [NOTIFICATION_TYPE.CAMPAIGN_SENT]:     'campaignSent',
  [NOTIFICATION_TYPE.DEAL_WON]:          'dealWon',
  [NOTIFICATION_TYPE.DEAL_LOST]:         'dealLost',
});

/**
 * isTypeEnabled — reads the tenant's toggle for this notification type.
 *
 * Defaults to true on any failure or missing record: a notification that
 * can't be checked should still arrive. The one exception is dealLost, whose
 * schema default is false -- `?? true` would override that, so the stored
 * default is read from the schema rather than assumed here.
 */
const isTypeEnabled = async (tenantId, type) => {
  if (!type) return true;

  const key = TYPE_TO_PREFERENCE_KEY[type];
  if (!key) return true;

  try {
    const tenant = await Tenant.findById(tenantId).select('notificationPreferences').lean();
    if (!tenant) return true;

    const value = tenant.notificationPreferences?.[key];
    if (typeof value === 'boolean') return value;

    // No stored value yet (tenant predates the field): fall back to the
    // schema's own default rather than a hardcoded true, so dealLost stays
    // off as designed.
    return Tenant.schema.path('notificationPreferences').schema.path(key)?.defaultValue ?? true;
  } catch (err) {
    console.warn(`[notification] preference lookup failed for ${type}: ${err.message}`);
    return true;
  }
};

// =============================================================================
// CREATE NOTIFICATION — called by booking, call, qualification, payment services
// =============================================================================

/**
 * createNotification — writes a real notification to MongoDB.
 * Non-blocking — wrapped in try/catch so caller never crashes.
 *
 * @param {Object} data
 *   { tenantId, userId, title, body, metadata? }
 */
export const createNotification = async ({
  tenantId,
  userId,
  title,
  body = '',
  metadata = {},
  type = null,
}) => {
  try {
    if (!tenantId || !userId || !title) return null;

    if (!(await isTypeEnabled(tenantId, type))) return null;

    const notification = await Notification.create({
      tenantId: String(tenantId),
      userId,
      title,
      body,
      isRead:   false,
      metadata,
      type,
    });

    // Push it to that user's open tabs immediately. The bell also polls every
    // 20s as a safety net, so a dropped socket frame delays a notification
    // rather than losing it -- but nobody should wait 20 seconds to find out
    // a payment landed.
    emitToUser(String(userId), 'notification:new', {
      _id:        String(notification._id),
      title:      notification.title,
      body:       notification.body,
      type:       notification.type,
      metadata:   notification.metadata,
      isRead:     false,
      created_at: notification.created_at,
    });

    return notification;
  } catch (err) {
    console.warn(`[notification] createNotification failed: ${err.message}`);
    return null;
  }
};

// =============================================================================
// GET NOTIFICATIONS — for the notification bell dropdown
// =============================================================================

/**
 * getNotifications — returns paginated notifications for a user.
 * SOURCE: MASTER_SPEC §B20 "notification bell with unread count, dropdown"
 *
 * @param {string} tenantId
 * @param {string} userId
 * @param {Object} options — { page, limit, unreadOnly }
 */
export const getNotifications = async (tenantId, userId, options = {}) => {
  const { page = 1, limit = 20, unreadOnly = false } = options;
  const skip = (page - 1) * limit;

  const query = {
    tenantId: String(tenantId),
    userId,
  };
  if (unreadOnly) query.isRead = false;

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(query)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit),
    Notification.countDocuments(query),
    Notification.countDocuments({ tenantId: String(tenantId), userId, isRead: false }),
  ]);

  return {
    notifications,
    unreadCount,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext:    page * limit < total,
    },
  };
};

// =============================================================================
// MARK READ
// =============================================================================

/**
 * markRead — marks a single notification as read.
 * SOURCE: MASTER_SPEC §B20 "mark read"
 */
export const markRead = async (tenantId, userId, notificationId) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, tenantId: String(tenantId), userId },
    { $set: { isRead: true } },
    { new: true }
  );
  if (!notification) throw AppError.notFound('Notification not found');
  return notification;
};

/**
 * markAllRead — marks all notifications for a user as read.
 * SOURCE: MASTER_SPEC §B20 "mark all read"
 */
export const markAllRead = async (tenantId, userId) => {
  const result = await Notification.updateMany(
    { tenantId: String(tenantId), userId, isRead: false },
    { $set: { isRead: true } }
  );
  return { modifiedCount: result.modifiedCount };
};

// =============================================================================
// GET UNREAD COUNT — for the notification bell badge
// =============================================================================

/**
 * getUnreadCount — returns unread count for the notification bell badge.
 * SOURCE: FRONTEND_SPEC §3 "notification bell with unread count"
 */
export const getUnreadCount = (tenantId, userId) =>
  Notification.countDocuments({
    tenantId: String(tenantId),
    userId,
    isRead:   false,
  });

// =============================================================================
// DEFAULT EXPORT — for backward-compat if anything imports as default
// =============================================================================

export const notificationService = {
  createNotification,
  getNotifications,
  markRead,
  markAllRead,
  getUnreadCount,
};

export default notificationService;