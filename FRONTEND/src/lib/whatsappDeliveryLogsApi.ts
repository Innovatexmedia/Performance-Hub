import { apiClient, doRequest, throwIfError, ApiError } from '@/lib/apiClient';
import type {
  DeliveryLog, DeliveryLogListQuery, Pagination, DeliveryLogStats,
} from '@/types/whatsappDeliveryLog';

/**
 * SOURCE: src/modules/whatsapp/submodules/deliveryLogs/
 *   deliveryLogs.controller.js + .routes.js
 * Mounted at /api/whatsapp/delivery-logs.
 *
 * list() does NOT use apiClient.getPaginated -- that helper expects
 * pagination nested under envelope.meta.pagination, but this endpoint's
 * sendPaginated() puts `pagination` as a top-level sibling of `data`
 * (confirmed against templates, which uses the identical sendPaginated
 * helper). A small local fetch matches that real shape instead of
 * guessing wrong and silently losing pagination info.
 */
async function requestPaginatedTopLevel<T>(
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): Promise<{ data: T[]; pagination: Pagination }> {
  const res = await doRequest(path, { method: 'GET', query });
  await throwIfError(res);
  const envelope = await res.json();
  if (!envelope.success) {
    throw new ApiError(envelope.message || 'Request failed', res.status, envelope.errors);
  }
  return { data: envelope.data, pagination: envelope.pagination };
}

export const whatsappDeliveryLogsApi = {
  list: (query: DeliveryLogListQuery = {}) =>
    requestPaginatedTopLevel<DeliveryLog>('/whatsapp/delivery-logs', query as Record<string, string | number | boolean | undefined>),

  get: (id: string) =>
    apiClient.get<DeliveryLog>(`/whatsapp/delivery-logs/${id}`),

  stats: (query: Partial<DeliveryLogListQuery> = {}) =>
    apiClient.get<DeliveryLogStats>('/whatsapp/delivery-logs/stats', query as Record<string, string | number | boolean | undefined>),

  retry: (id: string) =>
    apiClient.post<DeliveryLog>(`/whatsapp/delivery-logs/${id}/retry`),

  updateStatus: (id: string, status: string, extra?: { failureReason?: string; failureCode?: string }) =>
    apiClient.patch<DeliveryLog>(`/whatsapp/delivery-logs/${id}/status`, { status, ...extra }),
};