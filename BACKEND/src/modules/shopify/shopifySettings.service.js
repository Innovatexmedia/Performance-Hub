/**
 * =============================================================================
 * InnovateX Revenue OS — Shopify Settings Service
 * =============================================================================
 *
 * FILE: src/modules/shopify/shopifySettings.service.js
 *
 * Real OAuth lifecycle + real webhook-driven processing. Deliberately
 * reuses existing real functions rather than duplicating their logic --
 * same discipline already proven for Cal.com:
 *   - conversationService.findOrCreateForLead -- real "get/create a
 *     WhatsApp thread for this lead" logic, already used by the Lead
 *     Detail drawer's own WhatsApp quick action.
 *   - messageService.sendMessage -- the SAME real send path every
 *     salesperson-sent message goes through, including its real
 *     opt-out guard. This is exactly why normal salesperson-to-lead
 *     messaging stays unaffected: Shopify-triggered sends aren't a
 *     separate, parallel send mechanism, they're the same one.
 * =============================================================================
 */

import ShopifySettings from './shopifySettings.model.js';
import ShopifyCheckout from './shopifyCheckout.model.js';
import { ShopifyProvider, exchangeCodeForToken } from './providers/shopify.provider.js';
import { conversationService } from '../whatsapp/conversations/conversation.service.js';
import { messageService } from '../whatsapp/messages/message.service.js';
import { MESSAGE_TYPE } from '../whatsapp/messages/message.model.js';
import { Lead } from '../leads/lead/lead.model.js';
import { encrypt, decrypt, generateSecureToken } from '../../utils/crypto.js';
import { AppError } from '../../shared/helpers/lead.helpers.js';
import config from '../../config/config.js';

const getOrCreate = async (tenantId) => {
  let doc = await ShopifySettings.findOne({ tenantId });
  if (!doc) doc = await ShopifySettings.create({ tenantId });
  return doc;
};

/** Real, minimal scope set -- see shopifySettings.model.js's file comment for why read_all_orders is deliberately excluded. */
const REQUIRED_SCOPES = 'read_customers,write_customers,read_orders';

const WEBHOOK_TOPICS = {
  checkoutsCreate: 'CHECKOUTS_CREATE',
  checkoutsUpdate: 'CHECKOUTS_UPDATE',
  ordersCreate:    'ORDERS_CREATE',
  ordersUpdated:   'ORDERS_UPDATED',
  customersCreate: 'CUSTOMERS_CREATE',
};

const findOrCreateLead = async (tenantId, { email, phone, name }) => {
  const normalizedEmail = email?.toLowerCase().trim();
  if (!normalizedEmail && !phone) {
    throw new Error('Shopify customer has neither email nor phone — cannot match or create a lead');
  }

  let lead = normalizedEmail
    ? await Lead.findOne({ tenant_id: String(tenantId), email: normalizedEmail, archived: false })
    : null;
  if (!lead && phone) {
    lead = await Lead.findOne({ tenant_id: String(tenantId), phone, archived: false });
  }
  if (lead) return lead;

  return Lead.create({
    tenant_id: String(tenantId),
    name:      name || normalizedEmail || phone,
    email:     normalizedEmail || null,
    phone:     phone || null,
    source:    'Shopify',
    status:    'New',
  });
};

/**
 * sendWhatsAppToLead -- the one real place this integration ever sends a
 * WhatsApp message, reusing the exact same real functions a salesperson's
 * own send goes through (see file header). Never a separate send path.
 */
const sendWhatsAppToLead = async (tenantId, leadId, content) => {
  const ctx = { tenantId, userId: null, role: 'tenant_admin' };
  const conversation = await conversationService.findOrCreateForLead(ctx, leadId);
  return messageService.sendMessage(ctx, {
    conversationId: conversation.id,
    content,
    type: MESSAGE_TYPE.TEXT,
  });
};

export const shopifySettingsService = {
  async getSettings(ctx) {
    const doc = await getOrCreate(ctx.tenantId);
    return doc.toJSON();
  },

  /** buildAuthorizationUrl -- real Shopify OAuth consent URL, same real pattern as Google Ads' OAuth. */
  buildAuthorizationUrl(ctx, shopDomain) {
    if (!config.SHOPIFY_CLIENT_ID) {
      throw AppError.badRequest('Shopify is not configured on this server yet. An administrator needs to set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET.');
    }
    const normalizedShop = shopDomain.includes('.myshopify.com') ? shopDomain : `${shopDomain}.myshopify.com`;
    const params = new URLSearchParams({
      client_id: config.SHOPIFY_CLIENT_ID,
      scope: REQUIRED_SCOPES,
      redirect_uri: config.SHOPIFY_OAUTH_REDIRECT_URI,
      state: String(ctx.tenantId),
    });
    return `https://${normalizedShop}/admin/oauth/authorize?${params.toString()}`;
  },

  /**
   * completeAuthorization -- real code exchange, then real webhook
   * registration for all 5 topics this integration needs. A webhook
   * failing to register doesn't fail the whole connection -- same
   * "connection succeeds, one real sub-step failure is surfaced
   * clearly" principle already used for Cal.com.
   */
  async completeAuthorization({ tenantId, shopDomain, code }) {
    const { accessToken, scopes } = await exchangeCodeForToken({
      shopDomain,
      clientId: config.SHOPIFY_CLIENT_ID,
      clientSecret: config.SHOPIFY_CLIENT_SECRET,
      code,
    });

    const provider = new ShopifyProvider({ shopDomain, accessToken });
    const verified = await provider.testConnection();

    const doc = await getOrCreate(tenantId);
    doc.shopDomain = shopDomain;
    doc.accessToken = encrypt(accessToken);
    doc.scopes = scopes;
    doc.shopName = verified.shopName;
    doc.connected = true;
    doc.connectedAt = doc.connectedAt || new Date();
    doc.lastVerifiedAt = new Date();

    const callbackBase = `${config.API_BASE_URL || 'http://localhost:4000'}/api/shopify/webhook/${tenantId}`;
    const webhookErrors = [];
    for (const [field, topic] of Object.entries(WEBHOOK_TOPICS)) {
      try {
        const path = topic.toLowerCase().replace(/_/g, '-');
        doc.webhookIds[field] = await provider.createWebhook(topic, `${callbackBase}/${path}`);
      } catch (err) {
        webhookErrors.push(`${topic}: ${err.message}`);
      }
    }
    doc.lastSyncError = webhookErrors.length ? `Connected, but ${webhookErrors.length} webhook(s) failed to register: ${webhookErrors.join('; ')}` : null;

    await doc.save();
    return doc.toJSON();
  },

  async disconnect(ctx) {
    const doc = await getOrCreate(ctx.tenantId);
    if (doc.accessToken && doc.shopDomain) {
      try {
        const provider = new ShopifyProvider({ shopDomain: doc.shopDomain, accessToken: decrypt(doc.accessToken) });
        for (const webhookGid of Object.values(doc.webhookIds.toObject())) {
          if (webhookGid) await provider.deleteWebhook(webhookGid).catch(() => {});
        }
      } catch {
        // Best-effort -- token may already be revoked (app uninstalled from Shopify's side).
      }
    }
    doc.connected = false;
    doc.accessToken = null;
    doc.webhookIds = {};
    await doc.save();
    return doc.toJSON();
  },

  // ── Real webhook event processing ─────────────────────────────────────────

  /** processCustomerCreated -- real Lead sync from a new Shopify customer. */
  async processCustomerCreated(tenantId, customer) {
    await findOrCreateLead(tenantId, {
      email: customer.email,
      phone: customer.phone,
      name: [customer.first_name, customer.last_name].filter(Boolean).join(' '),
    });
  },

  /** processCheckoutCreated -- real tracking record, the foundation of abandoned-cart detection. */
  async processCheckoutCreated(tenantId, checkout) {
    const lead = await findOrCreateLead(tenantId, {
      email: checkout.email,
      phone: checkout.phone,
      name: [checkout.billing_address?.first_name, checkout.billing_address?.last_name].filter(Boolean).join(' '),
    }).catch(() => null); // a checkout with no real contact info can't be matched -- tracked anyway, just without a lead

    await ShopifyCheckout.findOneAndUpdate(
      { tenantId, checkoutId: String(checkout.id) },
      {
        $set: {
          token: checkout.token || null,
          email: checkout.email || null,
          phone: checkout.phone || null,
          leadId: lead?._id || null,
          cartTotal: parseFloat(checkout.total_price || '0'),
          currency: checkout.currency || 'USD',
          itemCount: (checkout.line_items || []).length,
          shopifyCreatedAt: new Date(checkout.created_at || Date.now()),
        },
      },
      { upsert: true }
    );
  },

  /**
   * processOrderEvent -- real order confirmation trigger. Also marks the
   * matching checkout (if any) as completed, so the real reconciliation
   * job never mistakenly treats a genuinely completed purchase as
   * abandoned.
   */
  async processOrderEvent(tenantId, order) {
    const lead = await findOrCreateLead(tenantId, {
      email: order.email,
      phone: order.phone || order.customer?.phone,
      name: order.customer ? [order.customer.first_name, order.customer.last_name].filter(Boolean).join(' ') : null,
    });

    if (order.checkout_token) {
      await ShopifyCheckout.updateMany(
        { tenantId, token: order.checkout_token, status: 'pending' },
        { $set: { status: 'completed', completedOrderId: String(order.id) } }
      );
    }

    const total = order.total_price ? `${order.currency || ''} ${order.total_price}`.trim() : 'your order';
    const message = `Hi! Your order #${order.order_number || order.name || ''} for ${total} has been confirmed. Thank you for shopping with us!`;

    try {
      await sendWhatsAppToLead(tenantId, lead._id, message);
    } catch (err) {
      console.warn(`[shopify] order confirmation WhatsApp send failed for tenant ${tenantId}: ${err.message}`);
    }
  },

  /**
   * reconcileAbandonedCarts -- the real detection logic Shopify itself
   * doesn't provide. Finds checkouts still 'pending' after the tenant's
   * configured window, sends one real WhatsApp recovery message each,
   * and marks them so this never double-sends.
   */
  async reconcileAbandonedCarts(tenantId) {
    const settings = await getOrCreate(tenantId);
    const cutoff = new Date(Date.now() - settings.abandonedCartMinutes * 60 * 1000);

    const staleCheckouts = await ShopifyCheckout.find({
      tenantId,
      status: 'pending',
      shopifyCreatedAt: { $lte: cutoff },
      leadId: { $ne: null },
    });

    let sent = 0;
    let failed = 0;
    for (const checkout of staleCheckouts) {
      try {
        const recoveryUrl = checkout.token ? `https://${settings.shopDomain}/${settings.shopDomain?.split('.')[0]}/checkouts/${checkout.token}` : null;
        const message = `Hi! You left ${checkout.itemCount} item(s) in your cart${recoveryUrl ? ` — you can finish your order here: ${recoveryUrl}` : ''}. Let us know if you have any questions!`;
        await sendWhatsAppToLead(tenantId, checkout.leadId, message);
        checkout.status = 'abandoned_notified';
        checkout.recoveryMessageSentAt = new Date();
        sent += 1;
      } catch (err) {
        checkout.status = 'abandoned_failed';
        console.warn(`[shopify] abandoned-cart recovery send failed for tenant ${tenantId}, checkout ${checkout.checkoutId}: ${err.message}`);
        failed += 1;
      }
      await checkout.save();
    }
    return { sent, failed, checked: staleCheckouts.length };
  },
};