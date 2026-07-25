import { apiClient, doRequest, throwIfError, ApiError } from '@/lib/apiClient';
import type {
  Consent, ConsentListQuery, Pagination, CreateConsentInput, VerifyConsentResult, ConsentStats,
} from '@/types/whatsappConsent';

/**
 * SOURCE: src/modules/whatsapp/submodules/consent/
 *   consent.controller.js + .routes.js
 * Mounted at /api/whatsapp/consent.
 *
 * list() uses the same custom top-level-pagination fetch as
 * whatsappDeliveryLogsApi -- the controller calls sendPaginated(), which
 * puts `pagination` as a sibling of `data`, not nested under
 * envelope.meta.pagination.
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

export const whatsappConsentApi = {
  list: (query: ConsentListQuery = {}) =>
    requestPaginatedTopLevel<Consent>('/whatsapp/consent', query as Record<string, string | number | boolean | undefined>),

  stats: () =>
    apiClient.get<ConsentStats>('/whatsapp/consent/stats'),

  get: (id: string) =>
    apiClient.get<Consent>(`/whatsapp/consent/${id}`),

  getHistory: (id: string) =>
    apiClient.get<{ id: string; phoneNumber: string; status: string; history: Consent['history'] }>(`/whatsapp/consent/${id}/history`),

  verify: (phoneNumber: string) =>
    apiClient.get<VerifyConsentResult>(`/whatsapp/consent/verify/${encodeURIComponent(phoneNumber)}`),

  create: (input: CreateConsentInput) =>
    apiClient.post<Consent>('/whatsapp/consent', input),

  optIn: (id: string, input: { optInMethod?: string; consentSource?: string; consentText?: string; expiresAt?: string; reason?: string } = {}) =>
    apiClient.post<Consent>(`/whatsapp/consent/${id}/opt-in`, input),

  optOut: (id: string, input: { optOutMethod?: string; reason?: string } = {}) =>
    apiClient.post<Consent>(`/whatsapp/consent/${id}/opt-out`, input),

  block: (id: string, reason?: string) =>
    apiClient.post<Consent>(`/whatsapp/consent/${id}/block`, { reason }),

  unblock: (id: string, reason?: string) =>
    apiClient.post<Consent>(`/whatsapp/consent/${id}/unblock`, { reason }),
};