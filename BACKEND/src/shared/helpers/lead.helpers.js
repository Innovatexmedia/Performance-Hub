/**
 * Cross-cutting helpers for the Lead module.
 *
 * WHAT CHANGED:
 * getContext() now reads from req.user (JWT) when available,
 * falling back to headers for backward compatibility during testing.
 * This bridges the gap between booking routes (JWT) and lead/pipeline
 * routes (withContext) so they share the same tenantId.
 */

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'tenant_demo';
const DEFAULT_ROLE = process.env.DEFAULT_ROLE || 'tenant_owner';

export class AppError extends Error {
  constructor(statusCode, message, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, this.constructor);
  }
  static badRequest(message = 'Bad request', details) {
    return new AppError(400, message, details);
  }
  static forbidden(message = 'Forbidden') {
    return new AppError(403, message);
  }
  static notFound(message = 'Not found') {
    return new AppError(404, message);
  }
  static conflict(message = 'Conflict', details) {
    return new AppError(409, message, details);
  }
  /**
   * planLimitExceeded — the shared shape for every "you've hit your
   * plan's limit" error (campaigns today; the same helper is available
   * for leads/users/workspaces wherever real enforcement gets added).
   * Sets a stable `code` the frontend can reliably check for (see
   * errorHandler.middleware.js's `response.code` passthrough) to show a
   * dedicated upgrade modal instead of a generic error toast, without
   * fragile string-matching on the human-readable message.
   */
  static planLimitExceeded(message, { resource, limit, current } = {}) {
    const err = new AppError(400, message);
    err.code = 'PLAN_LIMIT_EXCEEDED';
    err.resource = resource;
    err.limit = limit;
    err.current = current;
    return err;
  }
}

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * getContext — derives tenantId, userId, role from the request.
 *
 * Priority:
 * 1. req.user (set by authenticate JWT middleware) — the only path
 *    allowed in production.
 * 2. x-tenant-id / x-user-id / x-user-role headers — DEV-ONLY
 *    convenience for testing lead/pipeline routes without a full auth
 *    flow.
 *
 * SECURITY: the header/default fallback below is now hard-gated to
 * non-production environments. It previously ran unconditionally,
 * which meant any route using withContext WITHOUT authenticate running
 * first (a real, recurring class of bug in this project -- see e.g.
 * plan.routes.js and cashfreeWebhook.routes.js, both found existing as
 * files but never actually mounted in app.js) would let a caller
 * impersonate any tenant/role simply by setting those headers directly,
 * or fall through to a hardcoded demo-tenant-owner identity with no
 * headers at all. In production there is now no fallback: missing
 * req.user is treated as unauthenticated, full stop.
 *
 * This ensures lead.service.js ctx.tenantId matches booking.service.js ctx.tenantId
 * when both are called in the same user session.
 */
export function getContext(req) {
  if (req.user) {
    return {
      tenantId: req.user.tenantId,
      userId:   req.user.sub,
      role:     req.user.role,
    };
  }

  if (process.env.NODE_ENV === 'production') {
    throw new AppError(401, 'Authentication required.');
  }

  return {
    tenantId: req.header('x-tenant-id') || DEFAULT_TENANT_ID,
    userId:   req.header('x-user-id')   || null,
    role:     req.header('x-user-role') || DEFAULT_ROLE,
  };
}

export const withContext = (req, _res, next) => {
  if (!req.context) req.context = getContext(req);
  next();
};

export function pick(obj = {}, keys = []) {
  const out = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

export function paginationMeta({ page, limit, total }) {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 0,
    hasNext: page * limit < total,
    hasPrev: page > 1,
  };
}

export function normalizePaging(query = {}) {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
}