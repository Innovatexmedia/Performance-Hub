/**
 * =============================================================================
 * InnovateX Revenue OS — Shopify OAuth Controller
 * =============================================================================
 * FILE: src/modules/shopify/shopifyOAuth.controller.js
 * =============================================================================
 */

import { shopifySettingsService } from './shopifySettings.service.js';
import { verifySignedState } from '../../utils/crypto.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import asyncHandler from '../../utils/asyncHandler.js';

/**
 * startAuthorization -- GET /api/shopify/oauth/authorize?shop=...
 * Authenticated. Returns the real, shop-specific consent URL as JSON --
 * same reason as Google Ads: a plain browser navigation can't carry
 * this endpoint's own required Authorization header.
 */
export const startAuthorization = asyncHandler(async (req, res) => {
  const { shop } = req.query;
  if (!shop) {
    return res.status(400).json({ success: false, message: 'A shop domain is required (e.g. your-store.myshopify.com)' });
  }
  // buildAuthorizationUrl returns a real string directly (not an
  // object) -- same real return shape as googleAdsSettingsService's own
  // buildAuthorizationUrl, and consumed the same correct way there (see
  // googleAdsOAuth.controller.js: `const authUrl = ...`). This used to
  // destructure `{ authUrl }` from that string instead, which silently
  // produced authUrl: undefined -- the response still succeeded (200),
  // just with no real URL in it. The frontend then set
  // `window.location.href = undefined`, which the browser coerces to
  // the literal relative path "/undefined" and navigates there for
  // real -- a full page reload landing on an unrecognized route, which
  // is what actually produced the apparent "logout" (the session itself
  // was never invalidated; the app just bounced to Login after landing
  // on a route it didn't recognize).
  const authUrl = shopifySettingsService.buildAuthorizationUrl({ tenantId: req.user.tenantId }, shop);
  return sendSuccess(res, { authUrl }, 'Authorization URL generated');
});

/**
 * handleCallback -- GET /shopify/oauth/callback
 * Real Shopify redirect -- public, tenant identified via the `state` param.
 */
export const handleCallback = asyncHandler(async (req, res) => {
  const { code, state, shop, error: shopifyError } = req.query;
  const frontendUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/integrations`;

  if (shopifyError) {
    return res.redirect(`${frontendUrl}?shopify_error=${encodeURIComponent(String(shopifyError))}`);
  }
  if (!code || !state || !shop) {
    return res.redirect(`${frontendUrl}?shopify_error=missing_required_params`);
  }

  // Real CSRF verification -- same confirmed vulnerability closed here
  // as googleAdsOAuth.controller.js's identical fix (see crypto.js's
  // signState/verifySignedState). This callback is fully public with
  // no session of its own; an attacker completing their OWN Shopify
  // app install could previously call this URL directly with
  // state=<any tenant ID they know> and connect their own store to a
  // victim tenant.
  const tenantId = verifySignedState(state);
  if (!tenantId) {
    return res.redirect(`${frontendUrl}?shopify_error=invalid_or_expired_state`);
  }

  try {
    const result = await shopifySettingsService.completeAuthorization({ tenantId, shopDomain: shop, code });
    return res.redirect(`${frontendUrl}?shopify_connected=1&shop_name=${encodeURIComponent(result.shopName || '')}`);
  } catch (err) {
    return res.redirect(`${frontendUrl}?shopify_error=${encodeURIComponent(err.message)}`);
  }
});