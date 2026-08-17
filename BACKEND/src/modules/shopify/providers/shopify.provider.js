/**
 * =============================================================================
 * InnovateX Revenue OS — Shopify API Provider
 * =============================================================================
 *
 * FILE: src/modules/shopify/providers/shopify.provider.js
 *
 * SOURCE: real, current Shopify docs (shopify.dev), confirmed before
 * building:
 *   - OAuth token exchange is its own real, simple REST-style endpoint
 *     (NOT part of the GraphQL Admin API): POST
 *     https://{shop}.myshopify.com/admin/oauth/access_token
 *     { client_id, client_secret, code } -> { access_token, scope }
 *   - ALL data operations (customers, orders, webhooks) use the real
 *     GraphQL Admin API -- required for any new public app since April
 *     2025 (REST Admin API is legacy as of Oct 2024). One endpoint:
 *     POST https://{shop}.myshopify.com/admin/api/{version}/graphql.json
 *     Header: X-Shopify-Access-Token: {token}
 *   - Real webhook registration is the webhookSubscriptionCreate
 *     mutation, format: JSON, callbackUrl your own real endpoint.
 *   - Real webhook signature: HMAC-SHA256 of the raw request body using
 *     the app's shared secret (client secret), base64-encoded, compared
 *     against the X-Shopify-Hmac-Sha256 header.
 *   - Real webhook headers confirmed: X-Shopify-Topic, X-Shopify-Shop-Domain,
 *     X-Shopify-Hmac-Sha256, X-Shopify-Webhook-Id, X-Shopify-Event-Id
 *     (real, dedicated dedup ID -- unlike Cal.com, which has none).
 * =============================================================================
 */

import crypto from 'crypto';

const API_VERSION = '2025-01';

/**
 * verifyWebhookSignature -- real HMAC-SHA256, base64 output (Shopify's
 * own real format, confirmed -- different from Cal.com's hex output).
 */
export const verifyWebhookSignature = (rawBody, signatureHeader, secret) => {
  if (!signatureHeader || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false;
  }
};

/** exchangeCodeForToken -- real OAuth code exchange, its own real non-GraphQL endpoint. */
export const exchangeCodeForToken = async ({ shopDomain, clientId, clientSecret, code }) => {
  let response;
  try {
    response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
  } catch (networkError) {
    throw new Error(`Could not reach Shopify's OAuth endpoint — ${networkError.message}`);
  }

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Shopify rejected this authorization code — ${json?.error_description || json?.error || `HTTP ${response.status}`}`);
  }
  return { accessToken: json.access_token, scopes: (json.scope || '').split(',').filter(Boolean) };
};

export class ShopifyProvider {
  /** @param {{ shopDomain: string, accessToken: string }} config */
  constructor({ shopDomain, accessToken }) {
    if (!shopDomain) throw new Error('ShopifyProvider requires shopDomain');
    if (!accessToken) throw new Error('ShopifyProvider requires accessToken');
    this.shopDomain = shopDomain;
    this.accessToken = accessToken;
    this.graphqlUrl = `https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`;
  }

  async _graphql(query, variables) {
    let response;
    try {
      response = await fetch(this.graphqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.accessToken,
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (networkError) {
      throw new Error(`Could not reach Shopify's GraphQL API — ${networkError.message}`);
    }

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) throw new Error('Shopify rejected this access token — it may have been revoked (app uninstalled).');
      if (response.status === 429) throw new Error('Shopify rate limit reached. Try again shortly.');
      throw new Error(`Shopify API error — HTTP ${response.status}`);
    }
    if (json.errors?.length) {
      throw new Error(`Shopify GraphQL error — ${json.errors.map((e) => e.message).join('; ')}`);
    }
    return json.data;
  }

  /** testConnection -- real, read-only shop info query. */
  async testConnection() {
    const data = await this._graphql(`{ shop { name email myshopifyDomain } }`);
    return { connected: true, shopName: data.shop.name };
  }

  /**
   * createWebhook -- real webhookSubscriptionCreate mutation.
   * @param {string} topic -- real Shopify topic enum, e.g. ORDERS_CREATE
   */
  async createWebhook(topic, callbackUrl) {
    const mutation = `
      mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
          webhookSubscription { id }
          userErrors { field message }
        }
      }
    `;
    const data = await this._graphql(mutation, {
      topic,
      webhookSubscription: { callbackUrl, format: 'JSON' },
    });
    const result = data.webhookSubscriptionCreate;
    if (result.userErrors?.length) {
      throw new Error(`Shopify rejected this webhook subscription — ${result.userErrors.map((e) => e.message).join('; ')}`);
    }
    return result.webhookSubscription.id;
  }

  async deleteWebhook(webhookGid) {
    const mutation = `
      mutation webhookSubscriptionDelete($id: ID!) {
        webhookSubscriptionDelete(id: $id) { deletedWebhookSubscriptionId userErrors { message } }
      }
    `;
    return this._graphql(mutation, { id: webhookGid });
  }

  /** getOrder -- real, single-order lookup by Shopify's real numeric order ID. */
  async getOrder(orderId) {
    const gid = `gid://shopify/Order/${orderId}`;
    const query = `
      query getOrder($id: ID!) {
        order(id: $id) {
          id name email phone displayFulfillmentStatus displayFinancialStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          customer { id email displayName }
        }
      }
    `;
    const data = await this._graphql(query, { id: gid });
    return data.order;
  }
}