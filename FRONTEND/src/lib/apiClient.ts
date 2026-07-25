import type { ApiEnvelope } from '@/types/auth';

const BASE_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';

/**
 * ApiError -- thrown for any non-2xx or { success: false } response.
 * `status` lets callers branch on 401/403/404/422 etc.
 * `errors` carries express-validator field errors when present.
 */
export class ApiError extends Error {
  status: number;
  errors?: { field: string; message: string }[];

  constructor(message: string, status: number, errors?: { field: string; message: string }[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
  }
}

/**
 * Auth wiring -- injected by authStore.ts at startup to avoid a circular
 * import (apiClient -> authStore -> apiClient). authStore calls
 * `setAuthHandlers` once; apiClient calls back into it only on 401.
 */
interface AuthHandlers {
  getAccessToken: () => string | null;
  onTokenRefreshed: (accessToken: string) => void;
  onRefreshFailed: () => void;
}

let authHandlers: AuthHandlers | null = null;

export function setAuthHandlers(handlers: AuthHandlers): void {
  authHandlers = handlers;
}

const NO_REFRESH_PATHS = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'];

let refreshInFlight: Promise<string | null> | null = null;

async function attemptRefresh(): Promise<string | null> {
  if (!authHandlers) return null;
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefresh(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    const body = (await res.json()) as ApiEnvelope<{ accessToken: string }>;
    if (!res.ok || !body.success) {
      authHandlers?.onRefreshFailed();
      return null;
    }
    authHandlers?.onTokenRefreshed(body.data.accessToken);
    return body.data.accessToken;
  } catch {
    authHandlers?.onRefreshFailed();
    return null;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  skipAuth?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

/**
 * doRequest -- shared plumbing for both request() and requestRaw():
 * builds the fetch, attaches the bearer token, retries once on 401 via
 * silent refresh, and returns the raw fetch Response. Callers parse the
 * body differently depending on whether the target endpoint uses the
 * standard { success, message, data } envelope or not.
 */
export async function doRequest(path: string, options: RequestOptions): Promise<Response> {
  const { method = 'GET', body, query, skipAuth = false } = options;

  const attempt = async (): Promise<Response> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!skipAuth) {
      const token = authHandlers?.getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    return fetch(buildUrl(path, query), {
      method,
      headers,
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  let res = await attempt();

  if (res.status === 401 && !skipAuth && !NO_REFRESH_PATHS.some((p) => path.startsWith(p))) {
    const newToken = await attemptRefresh();
    if (newToken) {
      res = await attempt();
    }
  }

  return res;
}

/**
 * Every error response in this backend -- regardless of which module --
 * goes through the single global errorHandler middleware, which ALWAYS
 * sends { success: false, message, errors? }. So error parsing is shared
 * between request() and requestRaw() even though their SUCCESS shapes differ.
 */
export async function throwIfError(res: Response): Promise<void> {
  if (res.ok) return;
  let body: Partial<ApiEnvelope<unknown>> = {};
  try {
    body = (await res.json()) as Partial<ApiEnvelope<unknown>>;
  } catch {
    throw new ApiError('Server returned an unreadable response', res.status);
  }
  throw new ApiError(body.message || 'Request failed', res.status, body.errors);
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * request -- for endpoints using the standard envelope
 * { success, message, data }. This is every module EXCEPT Leads/Pipeline
 * (see requestRaw below). Returns `data` directly.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await doRequest(path, options);

  if (res.status === 204) return undefined as T;
  await throwIfError(res);

  const envelope = (await res.json()) as ApiEnvelope<T>;
  if (!envelope.success) {
    throw new ApiError(envelope.message || 'Request failed', res.status, envelope.errors);
  }
  return envelope.data;
}

/**
 * requestPaginated -- for standard-envelope endpoints built with
 * sendPaginated(res, data, pagination) (see src/utils/apiResponse.js).
 * Pagination lives in envelope.meta.pagination, NOT alongside `data` the
 * way Leads/Pipeline's raw { data, pagination } shape does -- this is a
 * genuinely different envelope, not just a naming difference, so it needs
 * its own function rather than reusing request() or requestRaw().
 */
export async function requestPaginated<T>(path: string, options: RequestOptions = {}): Promise<{ data: T[]; pagination: PaginationMeta }> {
  const res = await doRequest(path, options);
  await throwIfError(res);

  const envelope = (await res.json()) as ApiEnvelope<T[]> & { meta?: { pagination?: PaginationMeta } };
  if (!envelope.success) {
    throw new ApiError(envelope.message || 'Request failed', res.status, envelope.errors);
  }
  const pagination = envelope.meta?.pagination ?? {
    page: 1, limit: envelope.data.length, total: envelope.data.length, totalPages: 1, hasNext: false, hasPrev: false,
  };
  return { data: envelope.data, pagination };
}

/**
 * requestRaw -- for the Leads module family (leads, notes, activities,
 * assignments), which predates the { success, data } envelope convention
 * and returns its payload directly at the top level (e.g.
 * `{ data: [...], pagination: {...} }` for lists, or the lead object
 * itself for a single GET) -- confirmed by reading lead.controller.js,
 * which calls `res.json(result)` / `res.json(toLeadDTO(lead))` with no
 * wrapper. Error responses are STILL enveloped as normal (global error
 * handler), so throwIfError is shared with request().
 */
export async function requestRaw<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await doRequest(path, options);

  if (res.status === 204) return undefined as T;
  await throwIfError(res);

  return (await res.json()) as T;
}

/**
 * requestBlob -- for file-download endpoints (e.g. CSV export) that need
 * the Authorization header, so a plain <a href> can't be used. Returns the
 * raw Blob on success; error responses are still the standard JSON envelope.
 */
export async function requestBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  const res = await doRequest(path, options);
  await throwIfError(res);
  return res.blob();
}

/**
 * requestFormData -- for multipart/form-data uploads (e.g. CSV import).
 * Deliberately does NOT set Content-Type: the browser must set it itself
 * (including the multipart boundary) when the body is a FormData instance --
 * setting it manually breaks the upload. Shares the same auth/refresh
 * plumbing and enveloped-or-raw error handling as request()/requestRaw().
 */
async function doFormDataRequest(path: string, formData: FormData, query?: RequestOptions['query']): Promise<Response> {
  const attempt = async (): Promise<Response> => {
    const headers: Record<string, string> = {};
    const token = authHandlers?.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(buildUrl(path, query), {
      method: 'POST',
      headers,
      credentials: 'include',
      body: formData,
    });
  };

  let res = await attempt();
  if (res.status === 401 && !NO_REFRESH_PATHS.some((p) => path.startsWith(p))) {
    const newToken = await attemptRefresh();
    if (newToken) res = await attempt();
  }
  return res;
}

/** Raw (non-enveloped) form-data POST -- used by the Leads import endpoint. */
export async function requestFormDataRaw<T>(path: string, formData: FormData, query?: RequestOptions['query']): Promise<T> {
  const res = await doFormDataRequest(path, formData, query);
  await throwIfError(res);
  return (await res.json()) as T;
}

export const apiClient = {
  get: <T>(path: string, query?: RequestOptions['query']) => request<T>(path, { method: 'GET', query }),
  getPaginated: <T>(path: string, query?: RequestOptions['query']) => requestPaginated<T>(path, { method: 'GET', query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export const apiClientRaw = {
  get: <T>(path: string, query?: RequestOptions['query']) => requestRaw<T>(path, { method: 'GET', query }),
  post: <T>(path: string, body?: unknown) => requestRaw<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => requestRaw<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => requestRaw<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => requestRaw<T>(path, { method: 'DELETE' }),
};