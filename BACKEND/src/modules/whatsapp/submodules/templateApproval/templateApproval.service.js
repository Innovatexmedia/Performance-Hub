/**
 * WhatsApp Template Approval — service (workflow engine).
 *
 * Owns transition validation, the approver≠submitter rule, activity logging,
 * and webhook-driven provider transitions. Operates on the existing
 * WhatsAppTemplate model via templateApprovalRepository.
 */
import { AppError } from '../../../../shared/helpers/lead.helpers.js';
import { emitToTenant } from '../../../../realtime/socket.js';
import { activityService } from '../../../leads/activities/activity.service.js';
import { ACTIVITY_TYPE } from '../../../leads/activities/activity.model.js';
import { hasRole, ROLES } from '../../../auth/constants/roles.js';
import { templateApprovalRepository } from './templateApproval.repository.js';
import { whatsappSettingsService } from '../whatsappSettings/whatsappSettings.service.js';
import { PROVIDER, PROVIDER_STATUS } from '../templates/templates.constants.js';
import {
  APPROVAL_STATUS,
  APPROVAL_ACTION,
  ALLOWED_TRANSITIONS,
  PROVIDER_CONTROLLED_STATUSES,
  PROVIDER_REJECTION_REASON_VALUES,
  USABLE_APPROVAL_STATUS,
  PROVIDER_ACTOR,
} from './templateApproval.constants.js';

const ENTITY_TYPE = 'whatsapp_template';

// Roles permitted to perform manager-level actions (tenant_admin and above).
const MANAGER_ROLES = [ROLES.TENANT_ADMIN, ROLES.TENANT_OWNER, ROLES.SUPER_ADMIN];

function toTemplateDTO(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const { _id, ...rest } = o;
  return { id: String(_id ?? o.id), ...rest };
}

function buildHistoryEntry(fromStatus, toStatus, action, comment, performedBy, now) {
  return { fromStatus, toStatus, action, comment: comment || '', performedBy: performedBy ?? null, performedAt: now };
}

async function logActivity(ctx, template, type, message, meta = {}) {
  await activityService.logEntity(
    ctx,
    { entityType: ENTITY_TYPE, entityId: template._id ?? template.id },
    type,
    { message, meta: { templateId: String(template._id ?? template.id), ...meta } },
  );
}

/**
 * Meta's real Template API only supports 3 categories -- our model has 10
 * (BOOKING, PAYMENT, FOLLOW_UP, REMINDER, SUPPORT, SALES, CUSTOM don't
 * exist on Meta's side at all). Non-Meta categories fall back to UTILITY,
 * Meta's generic catch-all -- the ORIGINAL category stays as-is in our own
 * database for internal organization, only the submission payload maps it.
 */
function toMetaCategory(category) {
  if (category === 'MARKETING' || category === 'UTILITY' || category === 'AUTHENTICATION') return category;
  return 'UTILITY';
}

/**
 * Meta's real template `name` field only accepts lowercase letters,
 * digits, and underscores -- NOT hyphens, spaces, or uppercase. Our
 * internal `slug` (templates.service.js#slugify) is hyphen-separated
 * (e.g. "innovatex-media"), which Meta's Graph API rejects outright as an
 * "Invalid parameter" on the `name` field. Rather than changing slug
 * generation (which also drives URL routing and uniqueness checks
 * elsewhere), this derives a separate, Meta-safe name just for the
 * submission payload.
 */
function toMetaTemplateName(slug) {
  return (
    String(slug || '')
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 512) || 'template'
  );
}

function buildMetaComponents(template) {
  const components = [];

  if (template.header?.type && template.header.type !== 'NONE') {
    if (template.header.type === 'TEXT') {
      components.push({ type: 'HEADER', format: 'TEXT', text: template.header.text || '' });
    } else {
      // IMAGE/VIDEO/DOCUMENT headers require an already-uploaded Meta media
      // handle, not a raw mediaUrl -- that's a separate media-upload flow
      // this integration doesn't implement yet. Submitting a non-text
      // header would fail against Meta's real API, so it's intentionally
      // left out of the payload rather than sending something Meta would
      // reject anyway.
      components.push({ type: 'HEADER', format: template.header.type, example: undefined });
    }
  }

  components.push({ type: 'BODY', text: template.body });

  if (template.footer) {
    components.push({ type: 'FOOTER', text: template.footer });
  }

  if (Array.isArray(template.buttons) && template.buttons.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: template.buttons.map((b) => {
        const base = { type: b.type, text: b.text };
        if (b.type === 'URL') return { ...base, url: b.value };
        if (b.type === 'PHONE_NUMBER') return { ...base, phone_number: b.value };
        if (b.type === 'COPY_CODE') return { ...base, example: [b.value] };
        return base; // QUICK_REPLY, FLOW, CUSTOM -- no extra field
      }),
    });
  }

  return components;
}

/**
 * submitTemplateToMeta -- the real Graph API call. Returns
 * { providerTemplateId, metaStatus, rawResponse } on success, or throws
 * a clear AppError on failure (invalid credentials, Meta rejecting the
 * payload shape, name collision, etc.) -- never silently swallowed.
 */
async function submitTemplateToMeta(ctx, template) {
  const config = await whatsappSettingsService.getProviderConfig(ctx);
  const { accessToken, businessAccountId, graphApiVersion = 'v21.0' } = config?.meta || {};

  if (!accessToken || !businessAccountId) {
    throw new AppError(400, 'WhatsApp is not connected to Meta yet -- configure it in WhatsApp Settings before submitting templates.');
  }

  const payload = {
    name: toMetaTemplateName(template.slug), // was `template.slug` directly -- hyphens made Meta reject every submission
    category: toMetaCategory(template.category),
    language: template.languageCode,
    components: buildMetaComponents(template),
  };

  const url = `https://graph.facebook.com/${graphApiVersion}/${businessAccountId}/message_templates`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (networkError) {
    throw new AppError(502, `Could not reach Meta's Graph API -- ${networkError.message}`);
  }

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    // Meta's top-level error.message is often generic ("Invalid parameter").
    // error_user_msg / error_data.details usually name the actual offending
    // field -- surface those when present so failures are self-diagnosing
    // instead of needing a manual trace every time.
    const metaMessage =
      json?.error?.error_user_msg ||
      json?.error?.error_data?.details ||
      json?.error?.message ||
      `HTTP ${response.status}`;
    throw new AppError(400, `Meta rejected this template -- ${metaMessage}`);
  }

  return {
    providerTemplateId: json.id || null,
    // Meta returns 'status' on the created template resource -- typically
    // "PENDING" while under their real review.
    metaStatus: json.status === 'APPROVED' ? PROVIDER_STATUS.APPROVED : PROVIDER_STATUS.UNDER_REVIEW,
    rawResponse: json,
  };
}

export const templateApprovalService = {
  /** Throws unless `to` is a permitted successor of `from`. */
  validateTransition(fromStatus, toStatus) {
    const allowed = ALLOWED_TRANSITIONS[fromStatus] || [];
    if (!allowed.includes(toStatus)) {
      throw new AppError(409, `Invalid transition: ${fromStatus} → ${toStatus}`);
    }
  },

  /**
   * Throws if the approver is the same user who submitted the template --
   * EXCEPT for tenant_owner (and super_admin), who are explicitly allowed
   * to do every step of the workflow per the role table (a solo owner
   * running their own tenant submits AND approves their own templates;
   * there's no one else to do it). The separation-of-duties rule still
   * applies at the manager tier (tenant_admin / sales_manager /
   * marketing_manager) -- a manager should still get a second reviewer.
   */
  validateApprover(template, ctx) {
    if (hasRole(ctx.role, ROLES.TENANT_OWNER)) return;
    if (template.submittedBy && ctx.userId && String(template.submittedBy) === String(ctx.userId)) {
      throw new AppError(403, 'Approver must be different from the submitter');
    }
  },

  /** Guard against users manually assigning provider-controlled statuses. */
  assertNotProviderControlled(toStatus) {
    if (PROVIDER_CONTROLLED_STATUSES.includes(toStatus)) {
      throw new AppError(403, `${toStatus} can only be set by the provider webhook`);
    }
  },

  async loadTemplate(tenantId, id) {
    const template = await templateApprovalRepository.findById(tenantId, id);
    if (!template) throw new AppError(404, 'Template not found');
    return template;
  },

  // ── User-initiated transitions ─────────────────────────────────────────
  async submitForReview(ctx, id, { comment = '' } = {}) {
    const template = await this.loadTemplate(ctx.tenantId, id);
    const from = template.approvalStatus;
    const to = APPROVAL_STATUS.SUBMITTED_FOR_INTERNAL_REVIEW;

    this.assertNotProviderControlled(to);
    this.validateTransition(from, to);

    // A sales_user may only submit templates they created; managers submit any.
    const isManager = MANAGER_ROLES.includes(ctx.role);
    if (!isManager && template.createdBy && String(template.createdBy) !== String(ctx.userId)) {
      throw new AppError(403, 'You can only submit templates you created');
    }

    // Resubmission if this template has been through review before.
    const resubmitted = (template.transitionHistory || []).some(
      (h) => h.action === APPROVAL_ACTION.SUBMIT_FOR_REVIEW,
    );

    const now = new Date();
    const entry = buildHistoryEntry(from, to, APPROVAL_ACTION.SUBMIT_FOR_REVIEW, comment, ctx.userId, now);
    const updated = await templateApprovalRepository.submitForReview(ctx.tenantId, id, {
      performedBy: ctx.userId,
      comment,
      now,
      historyEntry: entry,
    });

    await logActivity(
      ctx,
      updated,
      resubmitted ? ACTIVITY_TYPE.WHATSAPP_TEMPLATE_RESUBMITTED : ACTIVITY_TYPE.WHATSAPP_TEMPLATE_SUBMITTED,
      resubmitted ? 'Template resubmitted for internal review' : 'Template submitted for internal review',
      { from, to },
    );
    return toTemplateDTO(updated);
  },

  async requestChanges(ctx, id, { comment = '' } = {}) {
    const template = await this.loadTemplate(ctx.tenantId, id);
    const from = template.approvalStatus;
    const to = APPROVAL_STATUS.DRAFT;

    this.validateTransition(from, to);

    const now = new Date();
    const entry = buildHistoryEntry(from, to, APPROVAL_ACTION.REQUEST_CHANGES, comment, ctx.userId, now);
    const updated = await templateApprovalRepository.requestChanges(ctx.tenantId, id, {
      comment,
      historyEntry: entry,
    });

    await logActivity(ctx, updated, ACTIVITY_TYPE.WHATSAPP_TEMPLATE_CHANGES_REQUESTED,
      'Changes requested on template', { from, to, comment });
    return toTemplateDTO(updated);
  },

  async approveInternally(ctx, id, { comment = '' } = {}) {
    const template = await this.loadTemplate(ctx.tenantId, id);
    const from = template.approvalStatus;
    const to = APPROVAL_STATUS.INTERNALLY_APPROVED;

    this.validateTransition(from, to);
    this.validateApprover(template, ctx);

    const now = new Date();
    const entry = buildHistoryEntry(from, to, APPROVAL_ACTION.APPROVE, comment, ctx.userId, now);
    const updated = await templateApprovalRepository.approveInternally(ctx.tenantId, id, {
      performedBy: ctx.userId,
      comment,
      now,
      historyEntry: entry,
    });

    await logActivity(ctx, updated, ACTIVITY_TYPE.WHATSAPP_TEMPLATE_INTERNALLY_APPROVED,
      'Template internally approved', { from, to });
    return toTemplateDTO(updated);
  },

  async rejectInternally(ctx, id, { comment = '' } = {}) {
    const template = await this.loadTemplate(ctx.tenantId, id);
    const from = template.approvalStatus;
    const to = APPROVAL_STATUS.REJECTED;

    this.validateTransition(from, to);

    const now = new Date();
    const entry = buildHistoryEntry(from, to, APPROVAL_ACTION.REJECT, comment, ctx.userId, now);
    const updated = await templateApprovalRepository.rejectInternally(ctx.tenantId, id, {
      performedBy: ctx.userId,
      comment,
      now,
      historyEntry: entry,
    });

    await logActivity(ctx, updated, ACTIVITY_TYPE.WHATSAPP_TEMPLATE_REJECTED,
      'Template rejected internally', { from, to, comment });
    return toTemplateDTO(updated);
  },

  async submitToProvider(ctx, id) {
    const template = await this.loadTemplate(ctx.tenantId, id);
    const from = template.approvalStatus;
    const to = APPROVAL_STATUS.SUBMITTED_TO_PROVIDER;

    this.assertNotProviderControlled(to);
    this.validateTransition(from, to);

    const now = new Date();
    const entry = buildHistoryEntry(from, to, APPROVAL_ACTION.SUBMIT_TO_PROVIDER, '', ctx.userId, now);

    // Only attempt a real Meta submission when the tenant is actually
    // configured for it -- same fallback pattern as resolveProvider() on
    // the messaging side. A tenant still in Simulation Mode (or using a
    // different provider) keeps the old local-only behavior; nothing here
    // silently pretends a submission happened when it didn't.
    let metaResult = null;
    const settingsConfig = await whatsappSettingsService.getProviderConfig(ctx).catch(() => null);
    if (settingsConfig?.provider === PROVIDER.META_CLOUD && settingsConfig?.providerMode !== 'SIMULATION') {
      metaResult = await submitTemplateToMeta(ctx, template); // throws with a clear message on real failure -- not caught here on purpose
    }

    const updated = await templateApprovalRepository.submitToProvider(ctx.tenantId, id, {
      now,
      historyEntry: entry,
      providerTemplateId: metaResult?.providerTemplateId,
      providerStatus: metaResult?.metaStatus,
      rawResponse: metaResult?.rawResponse,
    });

    await logActivity(ctx, updated, ACTIVITY_TYPE.WHATSAPP_TEMPLATE_SUBMITTED_TO_PROVIDER,
      metaResult ? 'Template submitted to Meta for real review' : 'Template submitted to provider (simulated)', { from, to });
    return toTemplateDTO(updated);
  },

  // ── Provider webhook-driven transitions (no user context) ──────────────
  /**
   * Webhooks carry no authenticated user, so the template is resolved by its
   * globally-unique id and the tenant is derived from the record. Subsequent
   * writes are scoped to that tenantId.
   */
  async resolveWebhookTemplate({ templateId, providerTemplateId }) {
    let template = null;
    if (templateId) template = await templateApprovalRepository.findByIdUnscoped(templateId);
    if (!template && providerTemplateId) {
      template = await templateApprovalRepository.findByProviderTemplateId(providerTemplateId);
    }
    if (!template) throw new AppError(404, 'Template not found for webhook');
    return template;
  },

  webhookCtx(template) {
    return { tenantId: template.tenantId, userId: PROVIDER_ACTOR, role: null };
  },

  async providerApproved(payload) {
    const template = await this.resolveWebhookTemplate(payload);
    const ctx = this.webhookCtx(template);
    const from = template.approvalStatus;
    const to = APPROVAL_STATUS.PROVIDER_APPROVED;
    this.validateTransition(from, to);

    const now = new Date();
    const entry = buildHistoryEntry(from, to, APPROVAL_ACTION.PROVIDER_APPROVED, payload.providerStatus || '', PROVIDER_ACTOR, now);
    const updated = await templateApprovalRepository.providerApproved(template.tenantId, template._id, {
      now,
      providerTemplateId: payload.providerTemplateId,
      historyEntry: entry,
    });

    await logActivity(ctx, updated, ACTIVITY_TYPE.WHATSAPP_TEMPLATE_PROVIDER_APPROVED,
      'Template approved by provider', { from, to, providerTemplateId: payload.providerTemplateId });

    // Push to any open Template Approval tab for this tenant so it updates
    // without a manual refresh -- same channel message.service.js already
    // uses for the Inbox (see realtime/socket.js).
    emitToTenant(ctx.tenantId, 'whatsapp:template', {
      templateId: String(updated._id ?? updated.id),
      template: toTemplateDTO(updated),
    });
    return toTemplateDTO(updated);
  },

  async providerRejected(payload) {
    const template = await this.resolveWebhookTemplate(payload);
    const ctx = this.webhookCtx(template);
    const from = template.approvalStatus;
    const to = APPROVAL_STATUS.PROVIDER_REJECTED;
    this.validateTransition(from, to);

    const now = new Date();
    const entry = buildHistoryEntry(from, to, APPROVAL_ACTION.PROVIDER_REJECTED, payload.providerRejectionMessage || '', PROVIDER_ACTOR, now);
    const updated = await templateApprovalRepository.providerRejected(template.tenantId, template._id, {
      now,
      reason: payload.providerRejectionReason || null,
      message: payload.providerRejectionMessage || null,
      historyEntry: entry,
    });

    await logActivity(ctx, updated, ACTIVITY_TYPE.WHATSAPP_TEMPLATE_PROVIDER_REJECTED,
      'Template rejected by provider', {
        from,
        to,
        providerRejectionReason: payload.providerRejectionReason || null,
      });

    emitToTenant(ctx.tenantId, 'whatsapp:template', {
      templateId: String(updated._id ?? updated.id),
      template: toTemplateDTO(updated),
    });
    return toTemplateDTO(updated);
  },

  async providerPaused(payload) {
    const template = await this.resolveWebhookTemplate(payload);
    const ctx = this.webhookCtx(template);
    const from = template.approvalStatus;
    const to = APPROVAL_STATUS.PAUSED;
    this.validateTransition(from, to);

    const now = new Date();
    const entry = buildHistoryEntry(from, to, APPROVAL_ACTION.PROVIDER_PAUSED, payload.providerStatus || '', PROVIDER_ACTOR, now);
    const updated = await templateApprovalRepository.providerPaused(template.tenantId, template._id, {
      now,
      historyEntry: entry,
    });

    await logActivity(ctx, updated, ACTIVITY_TYPE.WHATSAPP_TEMPLATE_PAUSED,
      'Template paused by provider (quality drop)', { from, to });

    emitToTenant(ctx.tenantId, 'whatsapp:template', {
      templateId: String(updated._id ?? updated.id),
      template: toTemplateDTO(updated),
    });
    return toTemplateDTO(updated);
  },

  async providerDisabled(payload) {
    const template = await this.resolveWebhookTemplate(payload);
    const ctx = this.webhookCtx(template);
    const from = template.approvalStatus;
    const to = APPROVAL_STATUS.DISABLED;
    this.validateTransition(from, to);

    const now = new Date();
    const entry = buildHistoryEntry(from, to, APPROVAL_ACTION.PROVIDER_DISABLED, payload.providerStatus || '', PROVIDER_ACTOR, now);
    const updated = await templateApprovalRepository.providerDisabled(template.tenantId, template._id, {
      now,
      historyEntry: entry,
    });

    await logActivity(ctx, updated, ACTIVITY_TYPE.WHATSAPP_TEMPLATE_DISABLED,
      'Template disabled by provider', { from, to });

    emitToTenant(ctx.tenantId, 'whatsapp:template', {
      templateId: String(updated._id ?? updated.id),
      template: toTemplateDTO(updated),
    });
    return toTemplateDTO(updated);
  },

  // ── Timeline + usage guard ─────────────────────────────────────────────
  async getTimeline(ctx, id) {
    const timeline = await templateApprovalRepository.getTimeline(ctx.tenantId, id);
    if (timeline === null) throw new AppError(404, 'Template not found');
    return timeline;
  },

  /**
   * Business-rule guard. A template is usable for sending (Campaigns,
   * Broadcasts, Nurture, Automation, Manual Sends) ONLY when
   * approvalStatus === PROVIDER_APPROVED.
   */
  async assertUsable(ctx, id) {
    const template = await this.loadTemplate(ctx.tenantId, id);
    if (template.approvalStatus !== USABLE_APPROVAL_STATUS) {
      throw new AppError(409, 'Template is not provider-approved and cannot be used for sending');
    }
    return toTemplateDTO(template);
  },

  isUsable(template) {
    return !!template && template.approvalStatus === USABLE_APPROVAL_STATUS;
  },

  /** Validate a provider rejection reason string (used by the validator layer). */
  isValidRejectionReason(reason) {
    return reason === undefined || reason === null || PROVIDER_REJECTION_REASON_VALUES.includes(reason);
  },
};