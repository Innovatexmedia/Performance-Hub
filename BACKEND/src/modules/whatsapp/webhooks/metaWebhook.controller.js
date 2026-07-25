import { metaWebhookService } from './metaWebhook.service.js';
import { whatsappSettingsService } from '../submodules/whatsappSettings/whatsappSettings.service.js';
import asyncHandler from '../../../utils/asyncHandler.js';

export const metaWebhookController = {
  /**
   * GET /api/whatsapp/webhooks/meta/:tenantId
   * Meta's one-time verification handshake. MUST respond with the raw
   * hub.challenge value as plain text -- not JSON, not wrapped -- or Meta
   * refuses to save the webhook URL in their dashboard.
   */
  verify: asyncHandler(async (req, res) => {
    const { tenantId } = req.params;
    // DEV_LOG: remove all lines tagged [WA_INBOUND_DEV] once inbound is confirmed working end-to-end.
    console.log(`[WA_INBOUND_DEV] GET verify hit -- tenantId=${tenantId} mode=${req.query['hub.mode']} token=${req.query['hub.verify_token']}`);
    try {
      const result = await metaWebhookService.handleVerification(tenantId, req.query);
      console.log(`[WA_INBOUND_DEV] GET verify SUCCESS -- echoing challenge back to Meta`);
      res.status(200).type('text/plain').send(result.challenge);
    } catch (err) {
      console.log(`[WA_INBOUND_DEV] GET verify FAILED -- ${err.message}`);
      throw err;
    }
  }),

  /**
   * POST /api/whatsapp/webhooks/meta/:tenantId
   * Real inbound messages + status updates. Deliberately unauthenticated
   * (Meta can't send a JWT) -- security comes from the HMAC signature
   * check instead, verified against THIS tenant's own appSecret.
   */
  receive: asyncHandler(async (req, res) => {
    const { tenantId } = req.params;
    // DEV_LOG: remove all lines tagged [WA_INBOUND_DEV] once inbound is confirmed working end-to-end.
    console.log(`[WA_INBOUND_DEV] POST receive hit -- tenantId=${tenantId} bodySize=${req.rawBody?.length ?? 'NO rawBody!'}`);

    const config = await whatsappSettingsService.getProviderConfig({ tenantId }).catch((err) => {
      console.log(`[WA_INBOUND_DEV] Could not load settings for this tenant -- ${err.message}`);
      return null;
    });
    const appSecret = config?.meta?.appSecret;
    console.log(`[WA_INBOUND_DEV] appSecret present in DB: ${appSecret ? 'yes (' + appSecret.length + ' chars)' : 'NO -- this will always fail signature check'}`);

    const signature = req.headers['x-hub-signature-256'];
    console.log(`[WA_INBOUND_DEV] X-Hub-Signature-256 header present: ${signature ? 'yes' : 'NO -- Meta did not send one'}`);

    const valid = metaWebhookService.verifySignature(req.rawBody, signature, appSecret);
    console.log(`[WA_INBOUND_DEV] Signature verification: ${valid ? 'PASSED' : 'FAILED'}`);

    if (!valid) {
      return res.status(401).json({ success: false, message: 'Signature verification failed' });
    }

    console.log(`[WA_INBOUND_DEV] Raw payload: ${JSON.stringify(req.body)}`);
    await metaWebhookService.processPayload(tenantId, req.body);
    console.log(`[WA_INBOUND_DEV] processPayload() completed without throwing`);
    res.status(200).json({ success: true });
  }),
};