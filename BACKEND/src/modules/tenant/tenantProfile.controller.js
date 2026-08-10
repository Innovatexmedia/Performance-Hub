import { asyncHandler } from '../../shared/helpers/lead.helpers.js';
import { sendSuccess } from '../../utils/responses.js';
import { tenantProfileService } from './tenantProfile.service.js';

function buildCtx(req) {
  const user = req.user || {};
  return {
    tenantId: user.tenantId || null,
    userId: user.sub || user.id || user._id || null,
  };
}

export const tenantProfileController = {
  // GET /api/tenant/profile
  getProfile: asyncHandler(async (req, res) => {
    const profile = await tenantProfileService.getProfile(buildCtx(req));
    return sendSuccess(res, profile, 'Business profile fetched');
  }),

  // PATCH /api/tenant/profile
  updateProfile: asyncHandler(async (req, res) => {
    const profile = await tenantProfileService.updateProfile(buildCtx(req), req.body);
    return sendSuccess(res, profile, 'Business profile updated');
  }),
};