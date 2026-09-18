import { apiClient } from '@/lib/apiClient';

/**
 * SOURCE: BACKEND/src/modules/leads/notifications/
 *         {notification.routes.js, notification.controller.js}
 * Mounted at /api/notifications. Standard envelope (apiClient unwraps .data).
 */

export interface NotificationItem {
  _id: string;
  tenantId: string;
  userId: string;
  title: string;
  body: string;
  isRead: boolean;
  metadata: Record<string, unknown>;
  /** Which event this describes, matching a Settings > Notification
   *  Preferences toggle. Null for notifications with no toggle (nurture
   *  tasks, automation NOTIFY_USER). */
  type?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * NotificationPushPayload -- what the server emits on 'notification:new'
 * (see notification.service.js createNotification). A deliberately smaller
 * shape than the REST record: tenantId/userId are implied by the socket room
 * and updated_at has no meaning on a just-created notification.
 */
export interface NotificationPushPayload {
  _id: string;
  title: string;
  body: string;
  type?: string | null;
  metadata: Record<string, unknown>;
  isRead: boolean;
  created_at: string;
}

export interface NotificationListResult {
  notifications: NotificationItem[];
  unreadCount: number;
  pagination: { page: number; limit: number; total: number; totalPages: number; hasNext: boolean };
}

export const notificationsApi = {
  list: (params?: { page?: number; limit?: number; unreadOnly?: boolean }) =>
    apiClient.get<NotificationListResult>('/notifications', params as Record<string, string | number | boolean | undefined>),

  unreadCount: () => apiClient.get<{ count: number }>('/notifications/unread-count'),

  markRead: (id: string) => apiClient.patch<NotificationItem>(`/notifications/${id}/read`),

  markAllRead: () => apiClient.patch<{ modifiedCount: number }>('/notifications/read-all'),
};