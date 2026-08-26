/**
 * WhatsApp Broadcasts — controller.
 * Thin HTTP layer. All business logic lives in broadcastsService.
 */
import asyncHandler from '../../../../utils/asyncHandler.js';
import { AppError } from '../../../../shared/helpers/lead.helpers.js';
import { sendSuccess, sendCreated, sendPaginated } from '../../../../utils/responses.js';
import { broadcastsService } from './broadcasts.service.js';

function buildCtx(req) {
  const user     = req.user    || {};
  const fallback = req.context || {};
  const tenantId = user.tenantId || fallback.tenantId;
  if (!tenantId) throw new AppError(401, 'Missing tenant context');
  return {
    tenantId,
    userId: user.sub || user.id || user._id || fallback.userId || null,
    role:   user.role || fallback.role || null,
  };
}

export const broadcastsController = {
  // POST /api/whatsapp/broadcasts
  create: asyncHandler(async (req, res) => {
    const broadcast = await broadcastsService.createBroadcast(buildCtx(req), req.body);
    return sendCreated(res, broadcast, 'Broadcast created');
  }),

  // GET /api/whatsapp/broadcasts
  list: asyncHandler(async (req, res) => {
    const { data, pagination } = await broadcastsService.listBroadcasts(buildCtx(req), req.query);
    return sendPaginated(res, data, pagination);
  }),

  // GET /api/whatsapp/broadcasts/:id
  get: asyncHandler(async (req, res) => {
    const broadcast = await broadcastsService.getBroadcast(buildCtx(req), req.params.id);
    return sendSuccess(res, broadcast);
  }),

  // PATCH /api/whatsapp/broadcasts/:id
  update: asyncHandler(async (req, res) => {
    const broadcast = await broadcastsService.updateBroadcast(buildCtx(req), req.params.id, req.body);
    return sendSuccess(res, broadcast, 'Broadcast updated');
  }),

  // DELETE /api/whatsapp/broadcasts/:id
  remove: asyncHandler(async (req, res) => {
    const result = await broadcastsService.deleteBroadcast(buildCtx(req), req.params.id);
    return sendSuccess(res, result, 'Broadcast deleted');
  }),

  // POST /api/whatsapp/broadcasts/:id/approve
  approve: asyncHandler(async (req, res) => {
    const broadcast = await broadcastsService.approveBroadcast(
      buildCtx(req), req.params.id, { comment: req.body.comment },
    );
    return sendSuccess(res, broadcast, 'Broadcast approved');
  }),

  // POST /api/whatsapp/broadcasts/:id/schedule
  schedule: asyncHandler(async (req, res) => {
    const broadcast = await broadcastsService.scheduleBroadcast(
      buildCtx(req), req.params.id,
      { scheduledAt: req.body.scheduledAt, comment: req.body.comment },
    );
    return sendSuccess(res, broadcast, 'Broadcast scheduled');
  }),

  // POST /api/whatsapp/broadcasts/:id/start
  start: asyncHandler(async (req, res) => {
    const broadcast = await broadcastsService.startBroadcast(
      buildCtx(req), req.params.id, { comment: req.body.comment },
    );
    return sendSuccess(res, broadcast, 'Broadcast started');
  }),

  // POST /api/whatsapp/broadcasts/:id/resend-failed
  resendFailed: asyncHandler(async (req, res) => {
    const broadcast = await broadcastsService.resendFailed(buildCtx(req), req.params.id);
    return sendSuccess(res, broadcast, 'Retry broadcast created', 201);
  }),

  // POST /api/whatsapp/broadcasts/:id/complete
  complete: asyncHandler(async (req, res) => {
    const broadcast = await broadcastsService.completeBroadcast(
      buildCtx(req), req.params.id, { comment: req.body.comment },
    );
    return sendSuccess(res, broadcast, 'Broadcast completed');
  }),

  // POST /api/whatsapp/broadcasts/:id/fail
  fail: asyncHandler(async (req, res) => {
    const broadcast = await broadcastsService.failBroadcast(
      buildCtx(req), req.params.id,
      { failureReason: req.body.failureReason, comment: req.body.comment },
    );
    return sendSuccess(res, broadcast, 'Broadcast marked as failed');
  }),

  // POST /api/whatsapp/broadcasts/:id/cancel
  cancel: asyncHandler(async (req, res) => {
    const broadcast = await broadcastsService.cancelBroadcast(
      buildCtx(req), req.params.id, { comment: req.body.comment },
    );
    return sendSuccess(res, broadcast, 'Broadcast cancelled');
  }),

  // POST /api/whatsapp/broadcasts/preview-audience
  previewAudience: asyncHandler(async (req, res) => {
    const result = await broadcastsService.previewAudience(buildCtx(req), {
      filters:          req.body.filters,
      includedContacts: req.body.includedContacts,
      excludedContacts: req.body.excludedContacts,
    });
    return sendSuccess(res, result);
  }),
};