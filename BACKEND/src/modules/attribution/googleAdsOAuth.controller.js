/**
 * =============================================================================
 * InnovateX Revenue OS — Google Ads OAuth Controller
 * =============================================================================
 * FILE: src/modules/attribution/googleAdsOAuth.controller.js
 * =============================================================================
 */

import { googleAdsSettingsService } from './googleAdsSettings.service.js';
import { verifySignedState } from '../../utils/crypto.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import asyncHandler from '../../utils/asyncHandler.js';

/**
 * startAuthorization — GET /integrations/google-ads/oauth/authorize
 * Returns the real Google consent URL as JSON, NOT a server-side
 * redirect -- a plain browser navigation can't carry the Authorization
 * header this endpoint's own `authenticate` middleware requires, so the
 * frontend calls this as a normal authenticated fetch, then navigates
 * the browser to the URL itself.
 */
export const startAuthorization = asyncHandler(async (req, res) => {
  const authUrl = googleAdsSettingsService.buildAuthorizationUrl({ tenantId: req.user.tenantId });
  return sendSuccess(res, { authUrl }, 'Authorization URL generated');
});

/**
 * handleCallback — GET /integrations/google-ads/oauth/callback
 * Real Google redirect -- public, no Authorization header. Tenant is
 * identified via the `state` param (see googleAdsSettings.service.js's
 * buildAuthorizationUrl for why this is safe). Exchanges the real code
 * for tokens, then redirects the BROWSER back to the frontend
 * Integrations page with a real outcome flag, not a JSON response --
 * this endpoint is only ever reached by a full-page browser redirect.
 */
export const handleCallback = asyncHandler(async (req, res) => {
  const { code, state, error: googleError } = req.query;
  const frontendUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/integrations`;

  if (googleError) {
    // Real, common case: the person clicked "Cancel" on Google's consent screen.
    return res.redirect(`${frontendUrl}?google_ads_error=${encodeURIComponent(String(googleError))}`);
  }
  if (!code || !state) {
    return res.redirect(`${frontendUrl}?google_ads_error=missing_code_or_state`);
  }

  // Real CSRF verification -- confirmed vulnerability this closes: state
  // used to be the raw tenantId with zero signing, and this callback is
  // necessarily fully public (Google redirects the browser here
  // directly, no session/Authorization header of its own). An attacker
  // could previously complete their OWN Google consent to get a genuine
  // `code`, then call this URL directly with state=<any tenant ID they
  // know> -- no victim involved at all -- silently connecting their own
  // ad account to someone else's tenant. verifySignedState rejects
  // anything not signed with this server's own ENCRYPTION_KEY, so
  // forging a state for an arbitrary tenant now requires a secret an
  // external attacker never has.
  const tenantId = verifySignedState(state);
  if (!tenantId) {
    return res.redirect(`${frontendUrl}?google_ads_error=invalid_or_expired_state`);
  }

  try {
    const { customerIds } = await googleAdsSettingsService.completeAuthorization({
      tenantId,
      userId: null, // the real user who clicked Connect isn't identifiable on this specific request; selectAccount() (the next real step) is authenticated and records updatedBy correctly
      code,
    });

    // Real accounts found -- send them through as a query param so the
    // frontend can show a genuine account picker, not force the tenant
    // to already know a raw customer ID.
    const idsParam = encodeURIComponent(customerIds.join(','));
    return res.redirect(`${frontendUrl}?google_ads_connected=1&customer_ids=${idsParam}`);
  } catch (err) {
    return res.redirect(`${frontendUrl}?google_ads_error=${encodeURIComponent(err.message)}`);
  }
});