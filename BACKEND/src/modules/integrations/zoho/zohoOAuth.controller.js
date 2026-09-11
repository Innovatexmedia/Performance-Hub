/**
 * =============================================================================
 * InnovateX Revenue OS — Zoho CRM OAuth Controller
 * =============================================================================
 * FILE: src/modules/integrations/zoho/zohoOAuth.controller.js
 * Mirrors googleAdsOAuth.controller.js's exact structure.
 * =============================================================================
 */

import { zohoSettingsService } from './zohoSettings.service.js';
import { verifySignedState } from '../../../utils/crypto.js';
import { sendSuccess } from '../../../utils/apiResponse.js';
import asyncHandler from '../../../utils/asyncHandler.js';

export const startAuthorization = asyncHandler(async (req, res) => {
  const authUrl = zohoSettingsService.buildAuthorizationUrl({ tenantId: req.user.tenantId });
  return sendSuccess(res, { authUrl }, 'Authorization URL generated');
});

export const handleCallback = asyncHandler(async (req, res) => {
  const { code, state, error: zohoError } = req.query;
  const frontendUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/integrations`;

  if (zohoError) {
    return res.redirect(`${frontendUrl}?zoho_error=${encodeURIComponent(String(zohoError))}`);
  }
  if (!code || !state) {
    return res.redirect(`${frontendUrl}?zoho_error=missing_code_or_state`);
  }

  const tenantId = verifySignedState(state);
  if (!tenantId) {
    return res.redirect(`${frontendUrl}?zoho_error=invalid_or_expired_state`);
  }

  try {
    await zohoSettingsService.completeAuthorization({ tenantId, userId: null, code });
    return res.redirect(`${frontendUrl}?zoho_connected=1`);
  } catch (err) {
    return res.redirect(`${frontendUrl}?zoho_error=${encodeURIComponent(err.message)}`);
  }
});
