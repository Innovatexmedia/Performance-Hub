// Shared utilities (adjust paths if your shared utils live elsewhere).
import { AppError } from '../../../../shared/helpers/lead.helpers.js';
import { hasRole, ROLES } from '../../../auth/constants/roles.js';

// Reused activity system from the Lead module (extended with logEntity).
import { activityService } from '../../../leads/activities/activity.service.js';
import { ACTIVITY_TYPE } from '../../../leads/activities/activity.model.js';

import { templatesRepository } from './templates.repository.js';
import { whatsappSettingsService } from '../whatsappSettings/whatsappSettings.service.js';
import {
  TEMPLATE_STATUS,
  TEMPLATE_CATEGORY_VALUES,
  APPROVAL_STATUS,
  PROVIDER_STATUS,
  HEADER_TYPE,
  BUTTON_TYPE_VALUES,
  BUTTON_TYPES_REQUIRING_VALUE,
  HEADER_TYPE_VALUES,
  MAX_BUTTONS,
  MAX_BODY_LENGTH,
  MAX_FOOTER_LENGTH,
  MAX_HEADER_TEXT_LENGTH,
  MAX_BUTTON_TEXT_LENGTH,
  VARIABLE_PATTERN,
  SEARCHABLE_FIELDS,
  SORTABLE_FIELDS,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from './templates.constants.js';

const ENTITY_TYPE = 'whatsapp_template';

/**
 * NOTE: this module intentionally does NOT own any approval-state
 * transition logic anymore. There used to be an `updateApprovalState` /
 * `approveTemplate` / `rejectTemplate` set of methods here that wrote
 * `approvalStatus` directly with no transition validation and no role
 * check -- a second, ungated path to the same field that
 * templateApproval.service.js governs properly (ALLOWED_TRANSITIONS,
 * PROVIDER_CONTROLLED_STATUSES, ROLE_MIN, approver != submitter, etc.).
 * That let any authenticated user set a template's approvalStatus straight
 * to PROVIDER_APPROVED via a plain PATCH /templates/:id, skipping every
 * guard on the real /templates/:id/approve endpoint.
 *
 * All approval transitions now go exclusively through
 * templateApproval.service.js via its own routes. This module only reads
 * approvalStatus (for the usable-for-sending guard below) and otherwise
 * treats it as someone else's field.
 */

function toTemplateDTO(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const { _id, ...rest } = o;
  return { id: String(_id ?? o.id), ...rest };
}

function slugify(value) {
  return (
    String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'template'
  );
}

/** Extract unique {{variable}} names from any number of text fragments. */
function collectVariables(...fragments) {
  const re = new RegExp(VARIABLE_PATTERN, 'g');
  const found = new Set();
  for (const fragment of fragments) {
    if (!fragment) continue;
    let match;
    re.lastIndex = 0;
    while ((match = re.exec(String(fragment))) !== null) {
      found.add(match[1]);
    }
  }
  return [...found];
}

/** Replace {{variable}} tokens in a string from a values map. */
function renderString(text, values, missing) {
  if (!text) return text || '';
  const re = new RegExp(VARIABLE_PATTERN, 'g');
  return String(text).replace(re, (full, name) => {
    if (Object.prototype.hasOwnProperty.call(values, name) && values[name] != null) {
      return String(values[name]);
    }
    missing.add(name);
    return full;
  });
}

function variablesFromTemplateData(data = {}) {
  const headerText = data.header?.type === HEADER_TYPE.TEXT ? data.header?.text : '';
  const buttonValues = Array.isArray(data.buttons) ? data.buttons.map((b) => b.value) : [];
  return collectVariables(headerText, data.body, data.footer, ...buttonValues);
}

/** Content validation; returns an array of { field, message } errors. */
function validateContent(data = {}) {
  const errors = [];

  if (data.body !== undefined && String(data.body).length > MAX_BODY_LENGTH) {
    errors.push({ field: 'body', message: `body exceeds ${MAX_BODY_LENGTH} characters` });
  }
  if (data.footer && String(data.footer).length > MAX_FOOTER_LENGTH) {
    errors.push({ field: 'footer', message: `footer exceeds ${MAX_FOOTER_LENGTH} characters` });
  }

  if (data.header) {
    const { type, text, mediaUrl } = data.header;
    if (type !== undefined && !HEADER_TYPE_VALUES.includes(type)) {
      errors.push({ field: 'header.type', message: 'Invalid header type' });
    }
    if (type === HEADER_TYPE.TEXT) {
      if (!text) errors.push({ field: 'header.text', message: 'header text is required for TEXT header' });
      else if (String(text).length > MAX_HEADER_TEXT_LENGTH) {
        errors.push({ field: 'header.text', message: `header text exceeds ${MAX_HEADER_TEXT_LENGTH} characters` });
      }
    }
    if ([HEADER_TYPE.IMAGE, HEADER_TYPE.VIDEO, HEADER_TYPE.DOCUMENT].includes(type) && !mediaUrl) {
      errors.push({ field: 'header.mediaUrl', message: `mediaUrl is required for ${type} header` });
    }
  }

  if (data.buttons !== undefined) {
    if (!Array.isArray(data.buttons)) {
      errors.push({ field: 'buttons', message: 'buttons must be an array' });
    } else {
      if (data.buttons.length > MAX_BUTTONS) {
        errors.push({ field: 'buttons', message: `a template may have at most ${MAX_BUTTONS} buttons` });
      }
      data.buttons.forEach((btn, i) => {
        if (!btn || !BUTTON_TYPE_VALUES.includes(btn.type)) {
          errors.push({ field: `buttons[${i}].type`, message: 'Invalid button type' });
        }
        if (!btn || !btn.text || !String(btn.text).trim()) {
          errors.push({ field: `buttons[${i}].text`, message: 'button text is required' });
        } else if (String(btn.text).length > MAX_BUTTON_TEXT_LENGTH) {
          errors.push({ field: `buttons[${i}].text`, message: `button text exceeds ${MAX_BUTTON_TEXT_LENGTH} characters` });
        }
        if (btn && BUTTON_TYPES_REQUIRING_VALUE.includes(btn.type) && (!btn.value || !String(btn.value).trim())) {
          errors.push({ field: `buttons[${i}].value`, message: `value is required for ${btn.type} button` });
        }
      });
    }
  }

  return errors;
}

function buildFilter(query = {}) {
  const filter = {};
  if (query.category) filter.category = query.category;
  if (query.status) filter.status = query.status;
  if (query.approvalStatus) filter.approvalStatus = query.approvalStatus;
  if (query.provider) filter.provider = query.provider;
  if (query.providerStatus) filter['providerMetadata.providerStatus'] = query.providerStatus;
  if (query.languageCode) filter.languageCode = query.languageCode;
  if (query.createdBy) filter.createdBy = query.createdBy;
  if (query.isActive !== undefined) {
    filter.isActive = query.isActive === true || query.isActive === 'true';
  }
  if (query.search) {
    const rx = new RegExp(String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = SEARCHABLE_FIELDS.map((f) => ({ [f]: rx }));
  }
  return filter;
}

function buildSort(sort) {
  if (!sort) return { createdAt: -1 };
  const desc = sort.startsWith('-');
  const key = desc ? sort.slice(1) : sort;
  if (!SORTABLE_FIELDS.includes(key)) return { createdAt: -1 };
  return { [key]: desc ? -1 : 1 };
}

function paging(query = {}) {
  const page = Math.max(Number(query.page) || DEFAULT_PAGE, 1);
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  return { page, limit, skip: (page - 1) * limit };
}

async function logTemplate(ctx, template, type, message, meta = {}) {
  await activityService.logEntity(
    ctx,
    { entityType: ENTITY_TYPE, entityId: template._id ?? template.id },
    type,
    { message, meta: { templateId: String(template._id ?? template.id), ...meta } },
  );
}

/**
 * Meta's real template status values -> our (status, approvalStatus) pair.
 * Meta also uses IN_APPEAL/APPEALED in some cases; unmapped values fall
 * back to SUBMITTED_TO_PROVIDER/SUBMITTED rather than silently guessing
 * ACTIVE/APPROVED for something we don't actually recognize.
 */
const META_TEMPLATE_STATUS_MAP = {
  APPROVED: { status: TEMPLATE_STATUS.ACTIVE, approvalStatus: APPROVAL_STATUS.PROVIDER_APPROVED },
  REJECTED: { status: TEMPLATE_STATUS.REJECTED, approvalStatus: APPROVAL_STATUS.PROVIDER_REJECTED },
  PENDING: { status: TEMPLATE_STATUS.SUBMITTED, approvalStatus: APPROVAL_STATUS.SUBMITTED_TO_PROVIDER },
  PAUSED: { status: TEMPLATE_STATUS.PAUSED, approvalStatus: APPROVAL_STATUS.PAUSED },
  DISABLED: { status: TEMPLATE_STATUS.PAUSED, approvalStatus: APPROVAL_STATUS.DISABLED },
};

function mapMetaCategory(metaCategory) {
  return TEMPLATE_CATEGORY_VALUES.includes(metaCategory) ? metaCategory : 'CUSTOM';
}

/** Meta's BUTTONS component types line up 1:1 with ours for the common
 * cases (QUICK_REPLY/PHONE_NUMBER/URL); anything else falls back to
 * CUSTOM rather than failing the whole sync over one unusual button. */
function mapMetaButtonType(metaType) {
  return BUTTON_TYPE_VALUES.includes(metaType) ? metaType : 'CUSTOM';
}

/** Extracts our (header, body, footer, buttons, variables) shape from
 * Meta's `components` array. Only the BODY component's example values are
 * used as `variables` -- header/button dynamic params aren't tracked
 * separately in our schema today (matches MetaProvider.sendTemplate's own
 * documented body-only scope). */
function mapMetaComponents(components = []) {
  const result = {
    header: { type: 'NONE', text: '', mediaUrl: '' },
    body: '',
    footer: '',
    buttons: [],
    variables: [],
  };

  for (const c of components) {
    const type = c.type?.toUpperCase();
    if (type === 'HEADER') {
      const format = c.format?.toUpperCase() || 'TEXT';
      result.header = {
        type: HEADER_TYPE_VALUES.includes(format) ? format : 'TEXT',
        text: format === 'TEXT' ? (c.text || '') : '',
        mediaUrl: '',
      };
    } else if (type === 'BODY') {
      result.body = c.text || '';
      result.variables = c.example?.body_text?.[0] || [];
    } else if (type === 'FOOTER') {
      result.footer = c.text || '';
    } else if (type === 'BUTTONS') {
      result.buttons = (c.buttons || []).map((b) => ({
        type: mapMetaButtonType(b.type?.toUpperCase()),
        text: b.text || '',
        value: b.url || b.phone_number || '',
      }));
    }
  }

  return result;
}


async function generateUniqueSlug(ctx, base, excludeId = null) {
  const root = slugify(base);
  let slug = root;
  let n = 1;
  // Bounded by how many same-named templates exist for the tenant.
  // eslint-disable-next-line no-await-in-loop
  while (true) {
    const existing = await templatesRepository.findBySlug(ctx.tenantId, slug);
    if (!existing || (excludeId && String(existing._id) === String(excludeId))) break;
    slug = `${root}-${n}`;
    n += 1;
  }
  return slug;
}

export const templatesService = {
  // ---- variable extraction + preview (pure helpers, also exported) --------
  extractVariables(body) {
    return collectVariables(body);
  },

  validateTemplate(data) {
    const errors = validateContent(data);
    return { valid: errors.length === 0, errors };
  },

  // ---- CRUD ---------------------------------------------------------------
  async createTemplate(ctx, data) {
    const errors = validateContent(data);
    if (errors.length) throw new AppError(400, 'Template validation failed', errors);

    const slug = data.slug
      ? await generateUniqueSlug(ctx, data.slug)
      : await generateUniqueSlug(ctx, data.name);
    const template = await templatesRepository.createTemplate({
      ...data,
      tenantId: ctx.tenantId,
      slug,
      variables: variablesFromTemplateData(data),
      status: data.status || TEMPLATE_STATUS.DRAFT,
      // approvalStatus is ALWAYS DRAFT on create, regardless of what the
      // client sent -- a template only ever enters the real approval
      // workflow through templateApproval's submit-review endpoint. Letting
      // a client set an arbitrary initial approvalStatus here was the same
      // class of bug as the PATCH bypass: skipping the guarded workflow.
      approvalStatus: APPROVAL_STATUS.DRAFT,
      version: 1,
      usageCount: 0,
      isActive: false,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    });

    await logTemplate(ctx, template, ACTIVITY_TYPE.WHATSAPP_TEMPLATE_CREATED,
      `Template "${template.name}" created`);

    return toTemplateDTO(template);
  },

  async getTemplate(ctx, id) {
    const template = await templatesRepository.findById(ctx.tenantId, id);
    if (!template) throw new AppError(404, 'Template not found');
    return toTemplateDTO(template);
  },

  async listTemplates(ctx, query) {
    const filter = buildFilter(query);
    const sort = buildSort(query.sort);
    const { page, limit, skip } = paging(query);

    const [items, total] = await Promise.all([
      templatesRepository.listTemplates(ctx.tenantId, filter, { sort, skip, limit }),
      templatesRepository.countTemplates(ctx.tenantId, filter),
    ]);

    return {
      data: items.map(toTemplateDTO),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  },

  async updateTemplate(ctx, id, patch) {
    const existing = await templatesRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Template not found');
    if (existing.status === TEMPLATE_STATUS.ARCHIVED) {
      throw new AppError(409, 'Archived templates are read-only');
    }

    // approvalStatus is NOT settable through this endpoint, full stop.
    // Approval transitions (submit-review / approve / reject / etc.) go
    // exclusively through templateApproval's dedicated, role-gated,
    // transition-validated endpoints under /templates/:id/{submit-review,
    // approve,reject,...}. Rejecting clearly here beats silently ignoring
    // it -- a caller who expected this to work needs to know it won't.
    if (patch.approvalStatus !== undefined || patch.approvalComment !== undefined) {
      throw new AppError(
        400,
        'approvalStatus cannot be set via this endpoint. Use the Template Approval workflow endpoints (submit-review / approve / reject / request-changes / submit-provider).',
      );
    }

    const content = { ...patch };

    if (Object.keys(content).length) {
      const merged = {
        header: content.header ?? existing.header,
        body: content.body ?? existing.body,
        footer: content.footer ?? existing.footer,
        buttons: content.buttons ?? existing.buttons,
      };
      const errors = validateContent(merged);
      if (errors.length) throw new AppError(400, 'Template validation failed', errors);

      const set = { ...content, updatedBy: ctx.userId };
      const touchesContent =
        content.body !== undefined ||
        content.header !== undefined ||
        content.footer !== undefined ||
        content.buttons !== undefined;
      if (touchesContent) {
        set.variables = variablesFromTemplateData(merged);
        set.version = (existing.version || 1) + 1;
      }
      if (content.slug !== undefined) {
        set.slug = await generateUniqueSlug(ctx, content.slug, id);
      }

      const updated = await templatesRepository.updateTemplate(ctx.tenantId, id, set);
      await logTemplate(ctx, updated, ACTIVITY_TYPE.WHATSAPP_TEMPLATE_UPDATED,
        'Template updated', { fields: Object.keys(content) });
    }

    return this.getTemplate(ctx, id);
  },

  async deleteTemplate(ctx, id) {
    const existing = await templatesRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Template not found');
    await templatesRepository.deleteTemplate(ctx.tenantId, id);
    return { id: String(existing._id), deleted: true };
  },

  async duplicateTemplate(ctx, id) {
    const source = await templatesRepository.findById(ctx.tenantId, id);
    if (!source) throw new AppError(404, 'Template not found');

    const src = source.toObject();
    const name = `${src.name} (Copy)`;
    const slug = await generateUniqueSlug(ctx, name);

    const clone = await templatesRepository.duplicateTemplate({
      tenantId: ctx.tenantId,
      name,
      slug,
      description: src.description,
      category: src.category,
      languageCode: src.languageCode,
      provider: src.provider,
      providerMetadata: { providerStatus: PROVIDER_STATUS.PENDING },
      header: src.header,
      body: src.body,
      footer: src.footer,
      buttons: src.buttons,
      variables: src.variables,
      status: TEMPLATE_STATUS.DRAFT,
      approvalStatus: APPROVAL_STATUS.DRAFT,
      version: 1,
      usageCount: 0,
      isActive: false,
      approvalHistory: [],
      approvalComments: '',
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    });

    await logTemplate(ctx, clone, ACTIVITY_TYPE.WHATSAPP_TEMPLATE_DUPLICATED,
      `Template duplicated from "${src.name}"`, { sourceId: String(source._id) });

    return toTemplateDTO(clone);
  },

  // ---- lifecycle ----------------------------------------------------------
  async activateTemplate(ctx, id) {
    const existing = await templatesRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Template not found');
    if (existing.status === TEMPLATE_STATUS.ARCHIVED) {
      throw new AppError(409, 'Archived templates are read-only and cannot be activated');
    }

    // Approval gate: a template created by a non-owner must go through real
    // approval (approvalStatus reaching INTERNALLY_APPROVED or further)
    // before it can be activated -- the tenant owner can bypass this and
    // activate directly, matching standard "owner override" authority.
    // Without this, any authenticated user could activate any DRAFT
    // template just by calling this endpoint directly, regardless of
    // whether the tenant owner had reviewed it at all.
    //
    // NOTE: this list uses ONLY the canonical APPROVAL_STATUS values from
    // templateApproval.constants.js. It used to also check
    // APPROVAL_STATUS.ACTIVE, which never existed in that canonical enum
    // (ACTIVE is a TEMPLATE_STATUS, not an approval status) -- a leftover
    // from the old, separate templates.constants.js APPROVAL_STATUS this
    // module no longer defines.
    const isOwner = hasRole(ctx.role, ROLES.TENANT_OWNER);
    const APPROVED_ENOUGH = [
      APPROVAL_STATUS.INTERNALLY_APPROVED,
      APPROVAL_STATUS.SUBMITTED_TO_PROVIDER,
      APPROVAL_STATUS.PROVIDER_APPROVED,
      APPROVAL_STATUS.PAUSED, // reactivating a previously-approved template
    ];
    if (!isOwner && !APPROVED_ENOUGH.includes(existing.approvalStatus)) {
      throw new AppError(
        403,
        'This template has not been approved by the tenant owner yet. Submit it for review first.',
      );
    }

    const updated = await templatesRepository.activateTemplate(ctx.tenantId, id);
    await logTemplate(ctx, updated, ACTIVITY_TYPE.WHATSAPP_TEMPLATE_ACTIVATED, 'Template activated');
    return toTemplateDTO(updated);
  },

  async pauseTemplate(ctx, id) {
    const existing = await templatesRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Template not found');
    if (existing.status === TEMPLATE_STATUS.ARCHIVED) {
      throw new AppError(409, 'Archived templates are read-only');
    }
    const updated = await templatesRepository.pauseTemplate(ctx.tenantId, id);
    await logTemplate(ctx, updated, ACTIVITY_TYPE.WHATSAPP_TEMPLATE_PAUSED, 'Template paused');
    return toTemplateDTO(updated);
  },

  async archiveTemplate(ctx, id) {
    const existing = await templatesRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Template not found');
    const updated = await templatesRepository.archiveTemplate(ctx.tenantId, id);
    await logTemplate(ctx, updated, ACTIVITY_TYPE.WHATSAPP_TEMPLATE_ARCHIVED, 'Template archived');
    return toTemplateDTO(updated);
  },

  // ---- provider sync (simulated transport) --------------------------------
  async syncTemplate(ctx, id) {
    const existing = await templatesRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Template not found');

    const now = new Date();
    const providerMetadata = {
      providerTemplateId:
        existing.providerMetadata?.providerTemplateId ||
        `${existing.provider}_${String(existing._id)}`,
      providerStatus: 'SYNCED',
      providerError: null,
      syncedAt: now,
      rawResponse: { simulated: true, provider: existing.provider, syncedAt: now.toISOString() },
    };

    const updated = await templatesRepository.updateSyncStatus(ctx.tenantId, id, providerMetadata);
    await logTemplate(ctx, updated, ACTIVITY_TYPE.WHATSAPP_TEMPLATE_SYNCED,
      `Template synced with ${existing.provider}`, { providerStatus: 'SYNCED' });

    return toTemplateDTO(updated);
  },

  async updateProviderStatus(ctx, id, providerStatus, extra = {}) {
    const existing = await templatesRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Template not found');
    const updated = await templatesRepository.updateProviderStatus(ctx.tenantId, id, providerStatus, extra);
    return toTemplateDTO(updated);
  },

  // ---- preview ------------------------------------------------------------
  async previewTemplate(ctx, id, variables = {}) {
    const template = await templatesRepository.findById(ctx.tenantId, id);
    if (!template) throw new AppError(404, 'Template not found');

    const values = variables && typeof variables === 'object' ? variables : {};
    const missing = new Set();

    const header = template.header
      ? {
          type: template.header.type,
          text: renderString(template.header.text, values, missing),
          mediaUrl: template.header.mediaUrl,
        }
      : null;
    const body = renderString(template.body, values, missing);
    const footer = renderString(template.footer, values, missing);
    const buttons = (template.buttons || []).map((b) => ({
      type: b.type,
      text: b.text,
      value: renderString(b.value, values, missing),
    }));

    return {
      templateId: String(template._id),
      header,
      body,
      footer,
      buttons,
      variables: template.variables,
      providedVariables: Object.keys(values),
      missingVariables: [...missing],
    };
  },

  // ---- usage tracking (business-rule guard) -------------------------------
  /** Returns the template only if it is usable for sending, else throws. */
  async assertUsable(ctx, id) {
    const template = await templatesRepository.findById(ctx.tenantId, id);
    if (!template) throw new AppError(404, 'Template not found');
    if (template.status !== TEMPLATE_STATUS.ACTIVE || !template.isActive) {
      throw new AppError(409, 'Only ACTIVE templates can be used for sending');
    }
    return template;
  },

  /** Call when a template is actually used (campaign/broadcast/manual send). */
  async incrementUsage(ctx, id) {
    await this.assertUsable(ctx, id);
    const updated = await templatesRepository.incrementUsageCount(ctx.tenantId, id);
    return toTemplateDTO(updated);
  },

  // ---- real sync from Meta -------------------------------------------------
  /**
   * Pulls every template that genuinely exists on Meta's side right now
   * (GET /{waba_id}/message_templates) and reconciles our DB against it:
   *   - Existing local record (matched by providerMetadata.providerTemplateId,
   *     falling back to name+languageCode for one that was deleted locally
   *     and needs recovering) -> updated in place, including approvalStatus/
   *     status, so a template Meta already approved/rejected days ago but
   *     that our webhook missed (e.g. app was unpublished at the time) gets
   *     corrected here too.
   *   - No local match at all -> created fresh, with fields read directly
   *     from Meta's response (bypassing the normal DRAFT-only createTemplate
   *     path deliberately: a synced-back record reflects Meta's already-real
   *     state, not a brand new user draft that hasn't been through review).
   *
   * Previously this whole thing was a no-op stub in whatsappSettingsService
   * that only stamped a lastSyncAt timestamp -- see that file's own comment
   * admitting as much. This is the first real implementation.
   */
  async syncFromMeta(ctx) {
    const config = await whatsappSettingsService.getProviderConfig(ctx);
    const { accessToken, businessAccountId, graphApiVersion } = config.meta || {};
    if (config.provider !== 'META_CLOUD' || config.providerMode === 'SIMULATION') {
      throw new AppError(400, 'WhatsApp Settings must be configured for the real Meta Cloud API (not Simulation) to sync templates');
    }
    if (!accessToken || !businessAccountId) {
      throw new AppError(400, 'Meta access token and Business Account ID must be configured before syncing');
    }

    const version = graphApiVersion || 'v21.0';
    let url = `https://graph.facebook.com/${version}/${businessAccountId}/message_templates?limit=100`;

    let created = 0;
    let updated = 0;
    const errors = [];

    // Meta paginates via `paging.next` -- a bounded loop (not `while(true)`
    // forever) so a misbehaving API can't hang this request indefinitely.
    for (let page = 0; page < 20 && url; page += 1) {
      let response;
      try {
        response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      } catch (networkErr) {
        throw new AppError(502, `Could not reach Meta's API -- ${networkErr.message}`);
      }
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        const msg = json?.error?.message || `HTTP ${response.status}`;
        throw new AppError(502, `Meta rejected the template list request -- ${msg}`);
      }

      for (const metaTemplate of json.data || []) {
        try {
          const mapped = mapMetaComponents(metaTemplate.components);
          const statusInfo = META_TEMPLATE_STATUS_MAP[metaTemplate.status]
            || { status: TEMPLATE_STATUS.SUBMITTED, approvalStatus: APPROVAL_STATUS.SUBMITTED_TO_PROVIDER };

          let existing = await templatesRepository.findByProviderTemplateId(ctx.tenantId, String(metaTemplate.id));
          if (!existing) {
            existing = await templatesRepository.findByNameAndLanguage(ctx.tenantId, metaTemplate.name, metaTemplate.language);
          }

          const patch = {
            name: metaTemplate.name,
            category: mapMetaCategory(metaTemplate.category),
            languageCode: metaTemplate.language,
            status: statusInfo.status,
            approvalStatus: statusInfo.approvalStatus,
            header: mapped.header,
            body: mapped.body,
            footer: mapped.footer,
            buttons: mapped.buttons,
            variables: mapped.variables,
            isActive: statusInfo.status === TEMPLATE_STATUS.ACTIVE,
            providerMetadata: {
              providerTemplateId: String(metaTemplate.id),
              providerStatus: metaTemplate.status,
              providerError: null,
              syncedAt: new Date(),
              rawResponse: metaTemplate,
            },
          };

          if (existing) {
            await templatesRepository.updateTemplate(ctx.tenantId, existing._id, patch);
            updated += 1;
          } else {
            const slug = await generateUniqueSlug(ctx, metaTemplate.name);
            await templatesRepository.createTemplate({
              ...patch,
              tenantId: ctx.tenantId,
              slug,
              description: '',
              provider: 'META_CLOUD',
              version: 1,
              usageCount: 0,
              createdBy: ctx.userId,
              updatedBy: ctx.userId,
            });
            created += 1;
          }
        } catch (itemErr) {
          errors.push({ name: metaTemplate?.name, message: itemErr.message });
        }
      }

      url = json.paging?.next || null;
    }

    return { created, updated, total: created + updated, errors, syncedAt: new Date() };
  },
};