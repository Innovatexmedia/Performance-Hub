/**
 * =============================================================================
 * InnovateX Revenue OS — Public Lead Capture Controller
 * =============================================================================
 * FILE: src/modules/leads/capture/publicCapture.controller.js
 * Thin HTTP layer -- mirrors calcomPublicBooking.controller.js's own
 * "real service call, no business logic here" pattern.
 * =============================================================================
 */

import { publicCaptureService } from './publicCapture.service.js';
import { sendSuccess, sendCreated } from '../../../utils/apiResponse.js';
import asyncHandler from '../../../utils/asyncHandler.js';

/**
 * capture -- POST /api/public/capture/:tenantId
 */
export const capture = asyncHandler(async (req, res) => {
  const { lead, isNew } = await publicCaptureService.captureLead(req.params.tenantId, req.body);

  const safeLead = {
    id: String(lead._id ?? lead.id),
    name: lead.name,
  };

  if (isNew) {
    return sendCreated(res, safeLead, 'Thanks! We\u2019ve received your details.');
  }
  return sendSuccess(res, safeLead, 'Thanks! We already have your details on file.');
});
