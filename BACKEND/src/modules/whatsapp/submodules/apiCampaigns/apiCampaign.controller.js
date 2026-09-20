/**
 * API Campaign — HTTP layer.
 *
 * Two audiences, deliberately shaped differently:
 *
 *  - The PUBLIC handlers answer a customer's server. They return a flat,
 *    documented JSON body rather than this codebase's internal envelope,
 *    because the public API is a contract we're asking third parties to code
 *    against; changing the internal envelope later must not break them.
 *
 *  - The DASHBOARD handlers answer our own frontend and use the standard
 *    sendSuccess/sendPaginated envelope like every other internal controller.
 */

import asyncHandler from '../../../../utils/asyncHandler.js';
import { AppError } from '../../../../shared/helpers/lead.helpers.js';
import { sendSuccess } from '../../../../utils/responses.js';
import { apiCampaignService } from './apiCampaign.service.js';
import { toCampaignDTO } from '../campaigns/campaigns.service.js';

/** Context for an API-key request. There is no user — the key IS the actor. */
function buildApiCtx(req) {
  return { tenantId: req.user.tenantId, userId: null, viaApiKey: true };
}

function buildDashboardCtx(req) {
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

async function handleTrigger(req, res, campaignId) {
  if (!campaignId) {
    throw new AppError(400, '"campaignId" is required');
  }

  const result = await apiCampaignService.trigger(buildApiCtx(req), {
    campaignId,
    recipients: req.body?.recipients,
    idempotencyKey: req.headers['idempotency-key'] || null,
    rawBody: req.body,
    apiKey: req.apiKey,
  });

  // 202, not 200: the work is accepted and queued. Delivery happens later and
  // may still fail per recipient — the run is how the caller finds out.
  return res.status(202).json({ success: true, ...result });
}

export const triggerCampaign = asyncHandler((req, res) =>
  handleTrigger(req, res, req.params.campaignId)
);

export const triggerCampaignFromBody = asyncHandler((req, res) =>
  handleTrigger(req, res, req.body?.campaignId)
);

export const getRunPublic = asyncHandler(async (req, res) => {
  const run = await apiCampaignService.getRun(buildApiCtx(req), req.params.runId);
  return res.status(200).json({ success: true, run });
});

// ── Dashboard handlers ──────────────────────────────────────────────────────

export const listRuns = asyncHandler(async (req, res) => {
  const result = await apiCampaignService.listRuns(buildDashboardCtx(req), req.query.campaignId, {
    limit: req.query.limit,
    page: req.query.page,
  });
  return sendSuccess(res, result);
});

export const getRun = asyncHandler(async (req, res) => {
  const run = await apiCampaignService.getRun(buildDashboardCtx(req), req.params.runId);
  return sendSuccess(res, run);
});

/**
 * Lifecycle handlers. Separate endpoints rather than one PATCH with a status
 * in the body: each is a distinct intent with its own preconditions, and
 * "POST /activate" is far harder to fire by accident than a status field.
 */
export const activateCampaign = asyncHandler(async (req, res) => {
  const campaign = await apiCampaignService.activate(buildDashboardCtx(req), req.params.campaignId, {
    comment: req.body?.comment,
  });
  return sendSuccess(res, toCampaignDTO(campaign), 'API campaign is live');
});

export const pauseCampaign = asyncHandler(async (req, res) => {
  const campaign = await apiCampaignService.pause(buildDashboardCtx(req), req.params.campaignId, {
    comment: req.body?.comment,
  });
  return sendSuccess(res, toCampaignDTO(campaign), 'API campaign paused');
});