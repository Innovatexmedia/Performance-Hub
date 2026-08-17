/**
 * =============================================================================
 * InnovateX Revenue OS — Shopify Webhook Controller
 * =============================================================================
 *
 * FILE: src/modules/shopify/shopifyWebhook.controller.js
 *
 * Real, public webhook receiver. Tenant identified via the URL path
 * (see shopifySettings.service.js's completeAuthorization -- the real
 * callbackUrl registered with Shopify is tenant-specific). Signature
 * verified against SHOPIFY_CLIENT_SECRET -- confirmed this is the real
 * secret Shopify signs webhooks with (the app's own shared secret, not
 * a per-tenant value the way Cal.com's webhook secret was).
 * =============================================================================
 */

import ShopifySettings from './shopifySettings.model.js';
import ShopifyWebhookEvent from './shopifyWebhookEvent.model.js';
import { shopifySettingsService } from './shopifySettings.service.js';
import { verifyWebhookSignature } from './providers/shopify.provider.js';
import config from '../../config/config.js';
import { sendSuccess, sendError } from '../../utils/apiResponse.js';
import asyncHandler from '../../utils/asyncHandler.js';

/**
 * handleWebhook -- POST /api/shopify/webhook/:tenantId/:topicPath
 * Public (Shopify's own server calling this).
 */
export const handleWebhook = asyncHandler(async (req, res) => {
  const { tenantId } = req.params;
  const signature = req.headers['x-shopify-hmac-sha256'];
  const topic = req.headers['x-shopify-topic'];
  const eventId = req.headers['x-shopify-event-id'];
  const shopDomain = req.headers['x-shopify-shop-domain'];

  if (!config.SHOPIFY_CLIENT_SECRET) {
    return sendError(res, 'Not configured', 404);
  }

  // Real signature check against req.rawBody -- the exact bytes Shopify
  // sent, populated globally by app.js's express.json({verify}), same
  // real mechanism already proven for both the Meta and Cal.com webhooks.
  const isValid = verifyWebhookSignature(req.rawBody, signature, config.SHOPIFY_CLIENT_SECRET);
  if (!isValid) {
    console.warn(`[shopify webhook] invalid signature for tenant ${tenantId}, shop ${shopDomain}`);
    return sendError(res, 'Invalid signature', 401);
  }

  // Real tenant isolation check: the settings doc for this tenantId must
  // genuinely exist, be connected, AND match the shop domain the
  // webhook claims to be from -- prevents a signature valid for ANY
  // Shopify app install from being replayed against a different
  // tenant's URL.
  const settings = await ShopifySettings.findOne({ tenantId, connected: true });
  if (!settings || settings.shopDomain !== shopDomain) {
    console.warn(`[shopify webhook] tenant/shop mismatch for tenant ${tenantId}`);
    return sendError(res, 'Not found', 404);
  }

  // Real, DB-level idempotency -- if this exact event was already
  // recorded, acknowledge and stop, regardless of how many times
  // Shopify retries delivery.
  if (eventId) {
    try {
      await ShopifyWebhookEvent.create({ tenantId, eventId, topic });
    } catch (err) {
      if (err.code === 11000) {
        return sendSuccess(res, null, 'Already processed'); // real duplicate, not an error
      }
      throw err;
    }
  }

  try {
    switch (topic) {
      case 'customers/create':
        await shopifySettingsService.processCustomerCreated(tenantId, req.body);
        break;
      case 'checkouts/create':
      case 'checkouts/update':
        await shopifySettingsService.processCheckoutCreated(tenantId, req.body);
        break;
      case 'orders/create':
      case 'orders/updated':
        await shopifySettingsService.processOrderEvent(tenantId, req.body);
        break;
      default:
        console.warn(`[shopify webhook] unrecognized topic "${topic}" for tenant ${tenantId}`);
    }
  } catch (err) {
    // A single bad event shouldn't retry forever -- acknowledge receipt,
    // log clearly. Real webhook failures stay visible in server logs
    // rather than silently vanishing.
    console.warn(`[shopify webhook] failed to process ${topic} for tenant ${tenantId}: ${err.message}`);
  }

  return sendSuccess(res, null, 'Webhook received');
});