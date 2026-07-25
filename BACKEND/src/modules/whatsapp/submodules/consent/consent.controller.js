/**
 * WhatsApp Consent & Opt-Out — controller.
 *
 * Thin HTTP layer. All business logic lives in consentService.
 * Follows the exact buildCtx + response-helper pattern used by
 * deliveryLogs, campaigns and automationRules controllers.
 */
import asyncHandler from '../../../../utils/asyncHandler.js';
import { AppError } from '../../../../shared/helpers/lead.helpers.js';
import { sendSuccess, sendCreated, sendPaginated } from '../../../../utils/responses.js';
import { consentService } from './consent.service.js';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'tenant_demo';

function buildCtx(req) {
  if (req.user?.tenantId) {
    return {
      tenantId: req.user.tenantId,
      userId:   req.user.sub || req.user.id || req.user._id || null,
      role:     req.user.role || null,
    };
  }
  return {
    tenantId: req.context?.tenantId || req.header('x-tenant-id') || DEFAULT_TENANT_ID,
    userId:   req.context?.userId   || req.header('x-user-id')   || null,
    role:     req.context?.role     || req.header('x-user-role') || 'tenant_owner',
  };
}

// Capture compliance metadata (IP + user agent) for the audit trail.
function reqMeta(req) {
  return {
    ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
    userAgent: req.headers['user-agent'] || null,
  };
}

export const consentController = {
  // POST /api/whatsapp/consent
  create: asyncHandler(async (req, res) => {
    const consent = await consentService.createConsent(buildCtx(req), req.body, reqMeta(req));
    return sendCreated(res, consent, 'Consent record created');
  }),

  // GET /api/whatsapp/consent
  list: asyncHandler(async (req, res) => {
    const { data, pagination } = await consentService.listConsents(buildCtx(req), req.query);
    return sendPaginated(res, data, pagination);
  }),

  // GET /api/whatsapp/consent/stats
  stats: asyncHandler(async (req, res) => {
    const result = await consentService.getStats(buildCtx(req));
    return sendSuccess(res, result);
  }),

  // GET /api/whatsapp/consent/verify/:phoneNumber
  verify: asyncHandler(async (req, res) => {
    const result = await consentService.verifyConsent(buildCtx(req), req.params.phoneNumber);
    return sendSuccess(res, result);
  }),

  // GET /api/whatsapp/consent/:id
  get: asyncHandler(async (req, res) => {
    const consent = await consentService.getConsent(buildCtx(req), req.params.id);
    return sendSuccess(res, consent);
  }),

  // GET /api/whatsapp/consent/:id/history
  history: asyncHandler(async (req, res) => {
    const result = await consentService.getHistory(buildCtx(req), req.params.id);
    return sendSuccess(res, result);
  }),

  // POST /api/whatsapp/consent/:id/opt-in
  optIn: asyncHandler(async (req, res) => {
    const consent = await consentService.optIn(buildCtx(req), req.params.id, {
      optInMethod:   req.body.optInMethod,
      consentSource: req.body.consentSource,
      consentText:   req.body.consentText,
      expiresAt:     req.body.expiresAt,
      reason:        req.body.reason,
    }, reqMeta(req));
    return sendSuccess(res, consent, 'Contact opted in');
  }),

  // POST /api/whatsapp/consent/:id/opt-out
  optOut: asyncHandler(async (req, res) => {
    const consent = await consentService.optOut(buildCtx(req), req.params.id, {
      optOutMethod: req.body.optOutMethod,
      reason:       req.body.reason,
    }, reqMeta(req));
    return sendSuccess(res, consent, 'Contact opted out');
  }),

  // POST /api/whatsapp/consent/:id/block
  block: asyncHandler(async (req, res) => {
    const consent = await consentService.block(buildCtx(req), req.params.id, {
      reason: req.body.reason,
    }, reqMeta(req));
    return sendSuccess(res, consent, 'Contact blocked');
  }),

  // POST /api/whatsapp/consent/:id/unblock
  unblock: asyncHandler(async (req, res) => {
    const consent = await consentService.unblock(buildCtx(req), req.params.id, {
      reason: req.body.reason,
    }, reqMeta(req));
    return sendSuccess(res, consent, 'Contact unblocked');
  }),
};