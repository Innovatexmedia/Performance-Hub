/**
 * =============================================================================
 * InnovateX Revenue OS — Shopify Checkout Model
 * =============================================================================
 *
 * FILE: src/modules/shopify/shopifyCheckout.model.js
 *
 * Real tracking for every checkouts/create webhook received. Confirmed:
 * Shopify has NO dedicated "abandoned cart" webhook -- the real,
 * documented pattern is to record every checkout start, then check back
 * after a real time window (see ShopifySettings.abandonedCartMinutes)
 * whether it ever turned into a real order. This model is that record.
 *
 * `token` is Shopify's own real checkout token, present in the
 * checkouts/create payload -- needed to reconstruct the real recovery
 * URL (https://{shop}.myshopify.com/.../checkouts/{token}) sent in the
 * WhatsApp recovery message.
 * =============================================================================
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

const shopifyCheckoutSchema = new Schema(
  {
    tenantId:   { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    checkoutId: { type: String, required: true }, // Shopify's real checkout id
    token:      { type: String, default: null },   // Shopify's real checkout token, for the recovery URL

    email:      { type: String, default: null },
    phone:      { type: String, default: null },
    leadId:     { type: Schema.Types.ObjectId, ref: 'Lead', default: null },

    cartTotal:  { type: Number, default: 0 },
    currency:   { type: String, default: 'USD' },
    itemCount:  { type: Number, default: 0 },

    // Real reconciliation state -- set once we've either confirmed this
    // became a real order, or genuinely treated it as abandoned and
    // sent (or attempted) a recovery message. Both are terminal -- a
    // checkout is only ever processed once.
    status: {
      type: String,
      enum: ['pending', 'completed', 'abandoned_notified', 'abandoned_failed'],
      default: 'pending',
      index: true,
    },
    completedOrderId: { type: String, default: null },
    recoveryMessageSentAt: { type: Date, default: null },

    shopifyCreatedAt: { type: Date, required: true }, // real timestamp from Shopify's payload, not our own receipt time
  },
  { timestamps: true }
);

// Real dedup -- one record per tenant+checkout, re-delivered webhooks
// (checkouts/update, or a retried checkouts/create) update in place.
shopifyCheckoutSchema.index({ tenantId: 1, checkoutId: 1 }, { unique: true });
// Real reconciliation query: "pending checkouts old enough to check."
shopifyCheckoutSchema.index({ tenantId: 1, status: 1, shopifyCreatedAt: 1 });

export default mongoose.model('ShopifyCheckout', shopifyCheckoutSchema, 'shopify_checkouts');