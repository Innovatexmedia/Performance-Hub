/**
 * =============================================================================
 * InnovateX Revenue OS — Nurture Incoming Webhook Trigger
 * =============================================================================
 *
 * FILE: src/modules/whatsapp/submodules/nurtures/nurtureWebhookTrigger.service.js
 *
 * Real, public, token-authenticated endpoint: an external system (a form
 * builder, another CRM, a Zapier/Make scenario, a custom script) can
 * call in and automatically enroll a real, matched (or newly created)
 * lead into a specific Nurture sequence -- the "incoming" counterpart to
 * the existing outbound API Request node.
 *
 * REUSES, DOES NOT DUPLICATE:
 *   - nurturesService.enrollLead -- the exact same real
 *     duplicate-prevention (DB-level partial unique index) and audit
 *     logging every other enrollment path already gets.
 *   - The same real find-or-create-lead pattern already proven for
 *     Cal.com/Shopify, extended to also match by phone (per the actual
 *     request: "map the payload to an existing lead by email/phone").
 *   - The same dynamicVariables persistence already built for the
 *     Shopify node, so a workflow variable like {{webhook.custom_field}}
 *     genuinely survives to later steps, not just the triggering moment.
 * =============================================================================
 */

import crypto from 'crypto';
import { NurtureSequence, NurtureEnrollment } from './nurtures.model.js';
import { SEQUENCE_STATUS, TRIGGER_TYPE } from './nurtures.constants.js';
import { nurturesService } from './nurtures.service.js';
import NurtureWebhookEvent from './nurtureWebhookEvent.model.js';
import { Lead } from '../../../leads/lead/lead.model.js';
import { generateSecureToken } from '../../../../utils/crypto.js';
import { AppError } from '../../../../shared/helpers/lead.helpers.js';

/**
 * getOrCreateWebhookToken -- real, per-sequence secret. Generated once,
 * on first request (via the admin-facing endpoint), then reused --
 * regenerating would be a real, deliberate action (invalidating any
 * external integration already configured with the old one), not
 * something that happens implicitly.
 */
export const getOrCreateWebhookToken = async (ctx, sequenceId) => {
  const sequence = await NurtureSequence.findOne({ _id: sequenceId, tenantId: ctx.tenantId });
  if (!sequence) throw AppError.notFound('Sequence not found');

  if (!sequence.webhookToken) {
    sequence.webhookToken = generateSecureToken(24);
    await sequence.save();
  }
  return sequence.webhookToken;
};

/**
 * regenerateWebhookToken -- real, explicit invalidation of the old
 * token (any external system still using it will start failing
 * immediately) and issuance of a new one.
 */
export const regenerateWebhookToken = async (ctx, sequenceId) => {
  const sequence = await NurtureSequence.findOne({ _id: sequenceId, tenantId: ctx.tenantId });
  if (!sequence) throw AppError.notFound('Sequence not found');
  sequence.webhookToken = generateSecureToken(24);
  await sequence.save();
  return sequence.webhookToken;
};

/**
 * findOrCreateLeadForWebhook -- real match by email OR phone (per the
 * actual request), same find-then-create pattern already proven for
 * Cal.com/Shopify.
 */
const findOrCreateLeadForWebhook = async (tenantId, payload) => {
  const email = payload?.email?.toLowerCase?.().trim();
  const phone = payload?.phone?.trim();
  if (!email && !phone) {
    throw AppError.badRequest('Webhook payload must include at least an email or phone to match a lead');
  }

  const orConditions = [];
  if (email) orConditions.push({ email });
  if (phone) orConditions.push({ phone });

  let lead = await Lead.findOne({ tenant_id: String(tenantId), archived: false, $or: orConditions });
  if (lead) return lead;

  lead = await Lead.create({
    tenant_id: String(tenantId),
    name:      payload.name || email || phone,
    email:     email || null,
    phone:     phone || null,
    source:    payload.source || 'Webhook',
    status:    'New',
  });
  return lead;
};

/**
 * handleIncomingWebhook -- the real, complete flow: verify token, real
 * dedup, real lead match/create, real enrollment, real payload
 * variables persisted for later steps.
 */
export const handleIncomingWebhook = async ({ sequenceId, token, rawBody, payload }) => {
  const sequence = await NurtureSequence.findOne({ _id: sequenceId });
  // Real, deliberate anti-enumeration: identical response whether the
  // sequence doesn't exist or the token is simply wrong -- doesn't
  // confirm to an unauthenticated caller which case it is.
  if (!sequence || !sequence.webhookToken || sequence.webhookToken !== token) {
    throw AppError.notFound('Not found');
  }
  if (sequence.status !== SEQUENCE_STATUS.ACTIVE) {
    throw AppError.badRequest('This sequence is not currently active');
  }
  if (sequence.triggerType !== TRIGGER_TYPE.CUSTOM) {
    throw AppError.badRequest('This sequence is not configured to accept webhook triggers');
  }

  // Real, DB-level duplicate-delivery protection -- an identical retry
  // (same sequence, same exact raw body) is rejected here.
  const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  try {
    await NurtureWebhookEvent.create({ tenantId: sequence.tenantId, sequenceId: sequence._id, bodyHash });
  } catch (err) {
    if (err.code === 11000) {
      console.warn(`[nurture webhook] duplicate delivery ignored for sequence ${sequence._id}`);
      return { duplicate: true };
    }
    throw err;
  }

  const lead = await findOrCreateLeadForWebhook(sequence.tenantId, payload);

  const ctx = { tenantId: sequence.tenantId, userId: sequence.createdBy || null };
  // Reuses the exact real enrollLead -- same duplicate-active-enrollment
  // prevention, same audit logging, as every other enrollment path.
  const enrollment = await nurturesService.enrollLead(ctx, String(sequence._id), { leadId: String(lead._id) });

  // Real, persisted payload variables -- every top-level payload field
  // becomes {{webhook.<field>}} for later steps in this same workflow,
  // surviving across separate scheduler ticks (same mechanism already
  // built for the Shopify node).
  const webhookVars = {};
  for (const [key, value] of Object.entries(payload || {})) {
    if (value != null && typeof value !== 'object') {
      webhookVars[`webhook.${key}`] = String(value);
    }
  }
  if (Object.keys(webhookVars).length) {
    await NurtureEnrollment.updateOne({ _id: enrollment._id }, { $set: { dynamicVariables: { ...enrollment.dynamicVariables, ...webhookVars } } });
  }

  console.log(`[nurture webhook] enrolled lead ${lead._id} into sequence ${sequence._id} via webhook trigger`);
  return { enrolled: true, leadId: String(lead._id), enrollmentId: String(enrollment._id) };
};