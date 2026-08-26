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
import { validateContent } from '../templates/templates.contentRules.js';
import { extractPlaceholders } from '../../templateParams.js';
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

/** Realistic sample text Meta shows its reviewers for each {{n}} body
 * placeholder -- Meta requires an `example.body_text` on the BODY
 * component whenever the body has placeholders (separate requirement
 * from the header's media example, confirmed live: fixing the header
 * example alone still got rejected with "component of type BODY is
 * missing expected field(s) (example)"). Keyed on the same field names
 * used in template.variables / LEAD_FIELD_ALIASES (templateParams.js)
 * and FRONTEND TemplateBuilder.tsx's LEAD_FIELD_OPTIONS, so a mapped
 * placeholder gets a genuinely relevant sample instead of a generic one. */
const BODY_EXAMPLE_VALUES = {
  name: 'Alex Johnson',
  firstname: 'Alex',
  lastname: 'Johnson',
  company: 'Acme Inc',
  email: 'alex@example.com',
  phone: '+15551234567',
  whatsappnumber: '+15551234567',
  segment: 'Enterprise',
  source: 'Website',
  medium: 'Organic',
  campaign: 'Summer Sale',
  status: 'Qualified',
  value: '5000',
  score: '8',
  temperature: 'Warm',
};

function bodyExampleFor(name) {
  const key = String(name || '').toLowerCase().replace(/[-_\s]/g, '');
  return BODY_EXAMPLE_VALUES[key] || 'Example';
}

function buildMetaComponents(template, headerHandle) {
  const components = [];

  if (template.header?.type && template.header.type !== 'NONE') {
    if (template.header.type === 'TEXT') {
      components.push({ type: 'HEADER', format: 'TEXT', text: template.header.text || '' });
    } else if (headerHandle) {
      // Real media header example -- Meta requires an already-uploaded
      // media handle (from the Resumable Upload API, see
      // uploadHeaderExample() below), not a raw mediaUrl. Previously this
      // was left as `example: undefined`, which Meta rejects outright
      // with "Templates with IMAGE header type need an example/sample" --
      // confirmed live.
      components.push({
        type: 'HEADER',
        format: template.header.type,
        example: { header_handle: [headerHandle] },
      });
    }
  }

  // BODY example -- Meta requires this whenever the body has {{n}}
  // placeholders, confirmed live via a second, separate rejection after
  // the header fix alone ("component of type BODY is missing expected
  // field(s) (example)"). Uses the SAME placeholder extraction as
  // send-time parameter resolution (templateParams.js) so the example
  // count always matches the real parameter count by construction --
  // positional templates resolve sample values via template.variables
  // (the same field mapping used for real sends), named templates
  // resolve directly by field name.
  // BODY example -- Meta requires this whenever the body has {{n}} or
  // {{name}} placeholders. Confirmed live via TWO separate real bugs:
  //   1. The header fix alone still got rejected with "component of
  //      type BODY is missing expected field(s) (example)".
  //   2. Even after adding a body example, a NAMED-parameter template
  //      (e.g. {{first_name}}) STILL got the exact same rejection --
  //      root cause confirmed against Meta's own docs: named and
  //      positional parameters need genuinely DIFFERENT example shapes.
  //      Positional wants `example.body_text: [[...]]` (a flat ordered
  //      array of sample values). Named wants
  //      `example.body_text_named_params: [{param_name, example}, ...]`
  //      -- sending the positional shape for a named template is simply
  //      the wrong field name/shape, so Meta reports "example" as
  //      missing even though a value WAS present, just not one it
  //      recognizes for that parameter format.
  const { names, positional } = extractPlaceholders(template.body);
  const bodyComponent = { type: 'BODY', text: template.body };
  if (names.length > 0) {
    if (positional) {
      const nameMap = Array.isArray(template.variables) ? template.variables : [];
      const samples = names.map((placeholder, i) => bodyExampleFor(nameMap[i] || placeholder));
      bodyComponent.example = { body_text: [samples] };
    } else {
      bodyComponent.example = {
        body_text_named_params: names.map((paramName) => ({
          param_name: paramName,
          example: bodyExampleFor(paramName),
        })),
      };
    }
  }
  components.push(bodyComponent);

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
 * uploadHeaderExample -- Meta's Resumable Upload API, the real flow
 * required to get a `header_handle` for a template's media header
 * example. This is a DIFFERENT Meta API from message sending (which can
 * send media "by link" directly) -- template REGISTRATION specifically
 * requires the sample file to already be uploaded to Meta first.
 *
 * Three real HTTP calls to Meta, per Meta's documented flow:
 *   1. POST /{app-id}/uploads?file_length&file_type -- opens an upload
 *      session, returns an opaque session id like "upload:XYZ...".
 *   2. POST /{upload-session-id} with the raw file bytes (Authorization:
 *      OAuth <token>, NOT Bearer -- Meta's resumable upload endpoints use
 *      a different auth scheme than the rest of the Graph API) -- returns
 *      { h: "<header_handle>" }.
 *   3. (caller) uses that handle in the template's HEADER component
 *      `example.header_handle` array.
 *
 * NOTE: implemented against Meta's documented API shape but NOT
 * exercised against a live Meta account in this environment (no network
 * access to Meta's API in the build/verification sandbox) -- flagging
 * this honestly since Meta's resumable upload endpoints are known to be
 * exacting about exact header/query-param format.
 */
async function uploadHeaderExample(ctx, header) {
  const config = await whatsappSettingsService.getProviderConfig(ctx);
  const { accessToken, appId, graphApiVersion = 'v21.0' } = config?.meta || {};

  if (!appId) {
    throw new AppError(400, "Meta App ID is not configured -- set it in WhatsApp Settings before submitting a template with a media header. It's required for Meta's template media upload API (separate from your Business Account ID).");
  }
  if (!header.mediaUrl) {
    throw new AppError(400, 'Header media file is missing -- re-upload it in the template editor.');
  }

  // Fetch the actual bytes from our own durable Cloudinary URL.
  let buffer;
  let fetchedContentType;
  try {
    const fileResponse = await fetch(header.mediaUrl);
    if (!fileResponse.ok) throw new Error(`status ${fileResponse.status}`);
    fetchedContentType = fileResponse.headers.get('content-type');
    buffer = Buffer.from(await fileResponse.arrayBuffer());
  } catch (err) {
    throw new AppError(502, `Could not fetch the header media file for upload -- ${err.message}`);
  }

  // Real bug, found via live debug logging: header.mediaMimeType can be
  // empty on templates whose header was saved before mime-type tracking
  // was added to TemplateBuilder.tsx -- when it's empty, this used to
  // fall back to a hardcoded generic 'application/octet-stream' instead
  // of the REAL content-type Cloudinary was already reporting one line
  // above (fetchedContentType). Meta correctly rejects
  // application/octet-stream as "not supported" since it's not a real
  // image/video/pdf mime type -- confirmed live, it was even visible
  // base64-encoded inside Meta's own returned upload handle. Cloudinary's
  // live content-type is authoritative and always correct regardless of
  // what got stored (or didn't) at upload time, so it's preferred over
  // our own possibly-stale/missing copy, not just a last-resort fallback.
  const mimeType = fetchedContentType || header.mediaMimeType || 'application/octet-stream';
  const fileLength = header.mediaSizeBytes || buffer.length;

  // Step 1: open the upload session.
  let sessionJson;
  try {
    const sessionRes = await fetch(
      `https://graph.facebook.com/${graphApiVersion}/${appId}/uploads?file_length=${fileLength}&file_type=${encodeURIComponent(mimeType)}&access_token=${accessToken}`,
      { method: 'POST' },
    );
    sessionJson = await sessionRes.json().catch(() => ({}));
    if (!sessionRes.ok || !sessionJson.id) {
      throw new Error(sessionJson?.error?.message || sessionJson?.error?.error_user_msg || `status ${sessionRes.status}`);
    }
  } catch (err) {
    throw new AppError(502, `Meta upload session could not be created -- ${err.message}`);
  }

  // Step 2: upload the actual bytes to that session.
  let uploadJson;
  try {
    const uploadRes = await fetch(`https://graph.facebook.com/${graphApiVersion}/${sessionJson.id}`, {
      method: 'POST',
      headers: { Authorization: `OAuth ${accessToken}`, file_offset: '0' },
      body: buffer,
    });
    uploadJson = await uploadRes.json().catch(() => ({}));
    if (!uploadRes.ok || !uploadJson.h) {
      throw new Error(uploadJson?.error?.message || uploadJson?.error?.error_user_msg || `status ${uploadRes.status}`);
    }
  } catch (err) {
    throw new AppError(502, `Meta media upload failed -- ${err.message}`);
  }

  return uploadJson.h;
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
    // Meta requires this to be told explicitly which style the body
    // uses, not just inferred from the {{}} syntax alone -- omitted for
    // a template with no placeholders at all (Meta defaults to
    // POSITIONAL in that case, and there's nothing to disagree about).
    ...(() => {
      const { names, positional } = extractPlaceholders(template.body);
      if (names.length === 0) return {};
      return { parameter_format: positional ? 'POSITIONAL' : 'NAMED' };
    })(),
    components: await (async () => {
      const hasMediaHeader = template.header?.type && !['NONE', 'TEXT'].includes(template.header.type);
      const headerHandle = hasMediaHeader ? await uploadHeaderExample(ctx, template.header) : null;
      const built = buildMetaComponents(template, headerHandle);
      return built;
    })(),
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
   * EXCEPT for tenant_admin and above (tenant_owner, super_admin).
   *
   * Was originally stricter (owner-only exemption, separation-of-duties
   * applying at the manager tier) -- relaxed per product decision: Admin
   * is meant to be a fully trusted operator in this product, the same way
   * "Admin" works in virtually every comparable SaaS product (Zendesk,
   * Freshservice, etc. -- Admin = full access by default, no artificial
   * self-approval block). That stricter four-eyes pattern is a real,
   * legitimate choice for compliance-heavy tools, but isn't what this
   * product wants. The rule still applies below Admin rank (Sales User,
   * Read-only, or anyone with a custom-granted permission that doesn't
   * reach Admin) -- someone else must review their submissions.
   */
  validateApprover(template, ctx) {
    if (hasRole(ctx.role, ROLES.TENANT_ADMIN)) return;
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

    // Content validation -- was completely missing from this whole
    // pipeline. A template could go DRAFT -> internal review -> approved
    // -> submitted to Meta -> Meta-approved with genuinely broken content
    // (e.g. a {{1}} placeholder with no field mapped -- confirmed live:
    // "media_temp", duplicated from a template saved before this
    // validation existed, sailed through the ENTIRE approval pipeline
    // and only failed at the very last, worst possible moment: an actual
    // campaign send attempt to real recipients). Running the same check
    // used at create/update time here too closes that gap at its real
    // entry point, not just when someone happens to open the edit form.
    const contentErrors = validateContent({
      name: template.name,
      body: template.body,
      footer: template.footer,
      header: template.header,
      buttons: template.buttons,
      variables: template.variables,
    });
    if (contentErrors.length > 0) {
      throw new AppError(400, `This template can't be submitted for review yet -- ${contentErrors.length} issue${contentErrors.length === 1 ? '' : 's'} found: ${contentErrors.map((e) => e.message).join('; ')}`);
    }

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