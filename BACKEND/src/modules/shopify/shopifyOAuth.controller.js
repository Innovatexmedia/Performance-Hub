/**
 * =============================================================================
 * InnovateX Revenue OS — Shopify OAuth Controller
 * =============================================================================
 * FILE: src/modules/shopify/shopifyOAuth.controller.js
 * =============================================================================
 */

import { shopifySettingsService } from './shopifySettings.service.js';
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
  const { authUrl } = shopifySettingsService.buildAuthorizationUrl({ tenantId: req.user.tenantId }, shop);
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

  try {
    const result = await shopifySettingsService.completeAuthorization({ tenantId: state, shopDomain: shop, code });
    return res.redirect(`${frontendUrl}?shopify_connected=1&shop_name=${encodeURIComponent(result.shopName || '')}`);
  } catch (err) {
    return res.redirect(`${frontendUrl}?shopify_error=${encodeURIComponent(err.message)}`);
  }
});