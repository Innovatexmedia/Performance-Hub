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
  created_at: string;
  updated_at: string;
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