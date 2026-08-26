/**
 * WhatsApp Campaigns — controller.
 *
 * Thin HTTP layer. All business logic lives in campaignsService.
 * Follows the exact buildCtx + sendSuccess pattern used by contacts and
 * templateApproval controllers.
 */
import asyncHandler from '../../../../utils/asyncHandler.js';
import { AppError } from '../../../../shared/helpers/lead.helpers.js';
import { sendSuccess, sendCreated, sendPaginated } from '../../../../utils/responses.js';
import { campaignsService } from './campaigns.service.js';

function buildCtx(req) {
  const user = req.user || {};
  const fallback = req.context || {};
  const tenantId = user.tenantId || fallback.tenantId;
  if (!tenantId) throw new AppError(401, 'Missing tenant context');
  return {
    tenantId,
    userId: user.sub || user.id || user._id || fallback.userId || null,
    role:   user.role || fallback.role || null,
    permissions: user.permissions || fallback.permissions || [],
  };
}

export const campaignsController = {
  // POST /api/whatsapp/campaigns
  create: asyncHandler(async (req, res) => {
    const campaign = await campaignsService.createCampaign(buildCtx(req), req.body);
    return sendCreated(res, campaign, 'Campaign created');
  }),

  // GET /api/whatsapp/campaigns
  list: asyncHandler(async (req, res) => {
    const { data, pagination } = await campaignsService.listCampaigns(buildCtx(req), req.query);
    return sendPaginated(res, data, pagination);
  }),

  // GET /api/whatsapp/campaigns/:id
  get: asyncHandler(async (req, res) => {
    const campaign = await campaignsService.getCampaign(buildCtx(req), req.params.id);
    return sendSuccess(res, campaign);
  }),

  // PATCH /api/whatsapp/campaigns/:id
  update: asyncHandler(async (req, res) => {
    const campaign = await campaignsService.updateCampaign(buildCtx(req), req.params.id, req.body);
    return sendSuccess(res, campaign, 'Campaign updated');
  }),

  // DELETE /api/whatsapp/campaigns/:id
  remove: asyncHandler(async (req, res) => {
    const result = await campaignsService.deleteCampaign(buildCtx(req), req.params.id);
    return sendSuccess(res, result, 'Campaign deleted');
  }),

  // POST /api/whatsapp/campaigns/:id/approve
  approve: asyncHandler(async (req, res) => {
    const campaign = await campaignsService.approveCampaign(buildCtx(req), req.params.id, { comment: req.body.comment });
    return sendSuccess(res, campaign, 'Campaign approved');
  }),

  // POST /api/whatsapp/campaigns/:id/schedule
  schedule: asyncHandler(async (req, res) => {
    const campaign = await campaignsService.scheduleCampaign(buildCtx(req), req.params.id, {
      scheduledAt: req.body.scheduledAt,
      comment:     req.body.comment,
    });
    return sendSuccess(res, campaign, 'Campaign scheduled');
  }),

  // POST /api/whatsapp/campaigns/:id/start
  start: asyncHandler(async (req, res) => {
    const campaign = await campaignsService.startCampaign(buildCtx(req), req.params.id, { comment: req.body.comment });
    return sendSuccess(res, campaign, 'Campaign started');
  }),

  // POST /api/whatsapp/campaigns/:id/resend-failed
  resendFailed: asyncHandler(async (req, res) => {
    const campaign = await campaignsService.resendFailed(buildCtx(req), req.params.id);
    return sendSuccess(res, campaign, 'Retry campaign created', 201);
  }),

  // POST /api/whatsapp/campaigns/:id/complete
  complete: asyncHandler(async (req, res) => {
    const campaign = await campaignsService.completeCampaign(buildCtx(req), req.params.id, { comment: req.body.comment });
    return sendSuccess(res, campaign, 'Campaign completed');
  }),

  // POST /api/whatsapp/campaigns/:id/fail
  fail: asyncHandler(async (req, res) => {
    const campaign = await campaignsService.failCampaign(buildCtx(req), req.params.id, {
      failureReason: req.body.failureReason,
      comment:       req.body.comment,
    });
    return sendSuccess(res, campaign, 'Campaign marked as failed');
  }),

  // POST /api/whatsapp/campaigns/:id/cancel
  cancel: asyncHandler(async (req, res) => {
    const campaign = await campaignsService.cancelCampaign(buildCtx(req), req.params.id, { comment: req.body.comment });
    return sendSuccess(res, campaign, 'Campaign cancelled');
  }),

  // POST /api/whatsapp/campaigns/preview-audience
  previewAudience: asyncHandler(async (req, res) => {
    const result = await campaignsService.previewAudience(buildCtx(req), {
      filters:           req.body.filters,
      includedContacts:  req.body.includedContacts,
      excludedContacts:  req.body.excludedContacts,
    });
    return sendSuccess(res, result);
  }),
};