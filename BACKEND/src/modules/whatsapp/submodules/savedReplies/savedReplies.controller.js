/**
 * WhatsApp Saved Replies — controller.
 * Thin HTTP layer; all logic lives in savedReplies.service.js. Follows the
 * same buildCtx + response-helper pattern as automationRules.controller.js.
 */
import asyncHandler from '../../../../utils/asyncHandler.js';
import { sendSuccess, sendCreated } from '../../../../utils/responses.js';
import { savedRepliesService } from './savedReplies.service.js';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'tenant_demo';

function buildCtx(req) {
  if (req.user?.tenantId) {
    return {
      tenantId: req.user.tenantId,
      userId: req.user.sub || req.user.id || req.user._id || null,
      role: req.user.role || null,
    };
  }
  return {
    tenantId: req.context?.tenantId || req.header('x-tenant-id') || DEFAULT_TENANT_ID,
    userId: req.context?.userId || req.header('x-user-id') || null,
    role: req.context?.role || req.header('x-user-role') || 'tenant_owner',
  };
}

export const savedRepliesController = {
  // GET /api/whatsapp/saved-replies
  list: asyncHandler(async (req, res) => {
    const replies = await savedRepliesService.list(buildCtx(req));
    return sendSuccess(res, replies);
  }),

  // POST /api/whatsapp/saved-replies
  create: asyncHandler(async (req, res) => {
    const reply = await savedRepliesService.create(buildCtx(req), req.body);
    return sendCreated(res, reply, 'Saved reply created');
  }),

  // PATCH /api/whatsapp/saved-replies/:id
  update: asyncHandler(async (req, res) => {
    const reply = await savedRepliesService.update(buildCtx(req), req.params.id, req.body);
    return sendSuccess(res, reply, 'Saved reply updated');
  }),

  // DELETE /api/whatsapp/saved-replies/:id
  remove: asyncHandler(async (req, res) => {
    const result = await savedRepliesService.remove(buildCtx(req), req.params.id);
    return sendSuccess(res, result, 'Saved reply deleted');
  }),
};