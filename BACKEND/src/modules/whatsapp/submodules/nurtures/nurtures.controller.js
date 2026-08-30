/**
 * WhatsApp Nurtures — controller.
 * Thin HTTP layer. All business logic lives in nurturesService.
 */
import asyncHandler from '../../../../utils/asyncHandler.js';
import { AppError } from '../../../../shared/helpers/lead.helpers.js';
import { sendSuccess, sendCreated, sendPaginated } from '../../../../utils/responses.js';
import { nurturesService } from './nurtures.service.js';
import { VARIABLE_REGISTRY } from './nurtureVariables.js';
import { getOrCreateWebhookToken, regenerateWebhookToken } from './nurtureWebhookTrigger.service.js';
import config from '../../../../config/config.js';

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

export const nurturesController = {
  // GET /api/whatsapp/nurtures/variables
  getVariables: asyncHandler(async (req, res) => {
    return sendSuccess(res, VARIABLE_REGISTRY, 'Available workflow variables');
  }),

  /**
   * getWebhookUrl -- GET /whatsapp/nurtures/:id/webhook-url
   * Real, admin-facing. Returns the complete, ready-to-use URL
   * (generating a real token on first request if the sequence doesn't
   * have one yet), not just the raw token -- so a tenant can copy/paste
   * it directly into whatever external tool they're configuring.
   */
  getWebhookUrl: asyncHandler(async (req, res) => {
    const token = await getOrCreateWebhookToken(buildCtx(req), req.params.id);
    const url = `${config.API_BASE_URL}/api/whatsapp/nurtures/webhook-trigger/${req.params.id}/${token}`;
    return sendSuccess(res, { url, token }, 'Webhook URL');
  }),

  /**
   * regenerateWebhookUrl -- POST /whatsapp/nurtures/:id/webhook-url/regenerate
   * Real, explicit, destructive action -- invalidates the old token
   * immediately (any external system still using it starts failing),
   * issues a new one.
   */
  regenerateWebhookUrl: asyncHandler(async (req, res) => {
    const token = await regenerateWebhookToken(buildCtx(req), req.params.id);
    const url = `${config.API_BASE_URL}/api/whatsapp/nurtures/webhook-trigger/${req.params.id}/${token}`;
    return sendSuccess(res, { url, token }, 'Webhook URL regenerated — the previous URL no longer works');
  }),

  // ── Sequence ─────────────────────────────────────────────────────────────

  // POST /api/whatsapp/nurtures
  create: asyncHandler(async (req, res) => {
    const sequence = await nurturesService.createSequence(buildCtx(req), req.body);
    return sendCreated(res, sequence, 'Nurture sequence created');
  }),

  // GET /api/whatsapp/nurtures
  list: asyncHandler(async (req, res) => {
    const { data, pagination } = await nurturesService.listSequences(buildCtx(req), req.query);
    return sendPaginated(res, data, pagination);
  }),

  // GET /api/whatsapp/nurtures/:id
  get: asyncHandler(async (req, res) => {
    const sequence = await nurturesService.getSequence(buildCtx(req), req.params.id);
    return sendSuccess(res, sequence);
  }),

  // PATCH /api/whatsapp/nurtures/:id
  update: asyncHandler(async (req, res) => {
    const sequence = await nurturesService.updateSequence(buildCtx(req), req.params.id, req.body);
    return sendSuccess(res, sequence, 'Nurture sequence updated');
  }),

  // DELETE /api/whatsapp/nurtures/:id
  remove: asyncHandler(async (req, res) => {
    const result = await nurturesService.deleteSequence(buildCtx(req), req.params.id);
    return sendSuccess(res, result, 'Nurture sequence deleted');
  }),

  // POST /api/whatsapp/nurtures/:id/activate
  activate: asyncHandler(async (req, res) => {
    const sequence = await nurturesService.activateSequence(
      buildCtx(req), req.params.id, { comment: req.body.comment },
    );
    return sendSuccess(res, sequence, 'Nurture sequence activated');
  }),

  // POST /api/whatsapp/nurtures/:id/pause
  pause: asyncHandler(async (req, res) => {
    const sequence = await nurturesService.pauseSequence(
      buildCtx(req), req.params.id, { comment: req.body.comment },
    );
    return sendSuccess(res, sequence, 'Nurture sequence paused');
  }),

  // POST /api/whatsapp/nurtures/:id/archive
  archive: asyncHandler(async (req, res) => {
    const sequence = await nurturesService.archiveSequence(
      buildCtx(req), req.params.id, { comment: req.body.comment },
    );
    return sendSuccess(res, sequence, 'Nurture sequence archived');
  }),

  // ── Enrollment ────────────────────────────────────────────────────────────

  // POST /api/whatsapp/nurtures/:id/enroll
  enroll: asyncHandler(async (req, res) => {
    const enrollment = await nurturesService.enrollLead(
      buildCtx(req), req.params.id,
      { leadId: req.body.leadId, contactId: req.body.contactId },
    );
    return sendCreated(res, enrollment, 'Lead enrolled in nurture sequence');
  }),

  // GET /api/whatsapp/nurtures/enrollments
  listEnrollments: asyncHandler(async (req, res) => {
    const { data, pagination } = await nurturesService.listEnrollments(buildCtx(req), req.query);
    return sendPaginated(res, data, pagination);
  }),

  // GET /api/whatsapp/nurtures/enrollments/:id
  getEnrollment: asyncHandler(async (req, res) => {
    const enrollment = await nurturesService.getEnrollment(buildCtx(req), req.params.id);
    return sendSuccess(res, enrollment);
  }),

  // POST /api/whatsapp/nurtures/enrollments/:id/pause
  pauseEnrollment: asyncHandler(async (req, res) => {
    const enrollment = await nurturesService.pauseEnrollment(
      buildCtx(req), req.params.id, { comment: req.body.comment },
    );
    return sendSuccess(res, enrollment, 'Enrollment paused');
  }),

  // POST /api/whatsapp/nurtures/enrollments/:id/resume
  resumeEnrollment: asyncHandler(async (req, res) => {
    const enrollment = await nurturesService.resumeEnrollment(
      buildCtx(req), req.params.id, { comment: req.body.comment },
    );
    return sendSuccess(res, enrollment, 'Enrollment resumed');
  }),

  // POST /api/whatsapp/nurtures/enrollments/:id/cancel
  cancelEnrollment: asyncHandler(async (req, res) => {
    const enrollment = await nurturesService.cancelEnrollment(
      buildCtx(req), req.params.id, { comment: req.body.comment },
    );
    return sendSuccess(res, enrollment, 'Enrollment cancelled');
  }),
};