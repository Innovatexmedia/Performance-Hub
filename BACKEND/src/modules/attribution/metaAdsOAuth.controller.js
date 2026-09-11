/**
 * =============================================================================
 * InnovateX Revenue OS — Meta Ads OAuth Controller
 * =============================================================================
 * FILE: src/modules/attribution/metaAdsOAuth.controller.js
 * Mirrors googleAdsOAuth.controller.js exactly in shape and reasoning.
 * =============================================================================
 */

import { metaAdsSettingsService } from './metaAdsSettings.service.js';
import { verifySignedState } from '../../utils/crypto.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import asyncHandler from '../../utils/asyncHandler.js';

/**
 * startAuthorization — GET /integrations/meta-ads/oauth/authorize
 * Returns the real Meta consent URL as JSON, NOT a server-side
 * redirect — same reasoning as googleAdsOAuth.controller.js's
 * startAuthorization: a plain browser navigation can't carry the
 * Authorization header this endpoint's own `authenticate` middleware
 * requires.
 */
export const startAuthorization = asyncHandler(async (req, res) => {
  const authUrl = metaAdsSettingsService.buildAuthorizationUrl({ tenantId: req.user.tenantId });
  return sendSuccess(res, { authUrl }, 'Authorization URL generated');
});

/**
 * handleCallback — GET /integrations/meta-ads/oauth/callback
 * Real Meta redirect — public, no Authorization header. Tenant is
 * identified via the signed `state` param, same real CSRF protection as
 * googleAdsOAuth.controller.js's handleCallback (see crypto.js's
 * signState/verifySignedState).
 */
export const handleCallback = asyncHandler(async (req, res) => {
  const { code, state, error: metaError, error_description: metaErrorDescription } = req.query;
  const frontendUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/integrations`;

  if (metaError) {
    // Real, common case: the person clicked "Cancel" on Meta's consent screen.
    return res.redirect(`${frontendUrl}?meta_ads_error=${encodeURIComponent(String(metaErrorDescription || metaError))}`);
  }
  if (!code || !state) {
    return res.redirect(`${frontendUrl}?meta_ads_error=missing_code_or_state`);
  }

  const tenantId = verifySignedState(state);
  if (!tenantId) {
    return res.redirect(`${frontendUrl}?meta_ads_error=invalid_or_expired_state`);
  }

  try {
    const { accounts } = await metaAdsSettingsService.completeAuthorization({
      tenantId,
      userId: null, // the real user who clicked Connect isn't identifiable on this specific request; selectAccount() (the next real step) is authenticated and records updatedBy correctly
      code,
    });

    // Real accounts found -- send them through as a query param so the
    // frontend can show a genuine account picker, not force the tenant
    // to already know a raw ad account ID. Encoded as JSON since Meta
    // accounts carry a real display name alongside the ID (Google's
    // customerIds are bare IDs with no name at this stage), unlike
    // googleAdsOAuth.controller.js's simple comma-joined ID list.
    const accountsParam = encodeURIComponent(JSON.stringify(accounts));
    return res.redirect(`${frontendUrl}?meta_ads_connected=1&accounts=${accountsParam}`);
  } catch (err) {
    return res.redirect(`${frontendUrl}?meta_ads_error=${encodeURIComponent(err.message)}`);
  }
});