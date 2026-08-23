import { AppError } from '../../../shared/helpers/lead.helpers.js';
import Tenant from '../../auth/models/Tenant.js';
import {
  LEAD_STATUS_VALUES,
  LEAD_TEMPERATURE_VALUES,
  CONSENT_STATUS_VALUES,
} from './lead.constants.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ALLOWED_FIELDS = [
  'name',
  'email',
  'phone',
  'whatsapp_number',
  'company',
  'source',
  'medium',
  'campaign',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'status',
  'qualification_score',
  'lead_temperature',
  'assigned_user_id',
  'group_ids',
  'tags',
  'segment',
  'value',
  'notes',
  'consent_status',
  'opt_out_status',
  'last_contacted_at',
];

function isString(v) {
  return typeof v === 'string';
}

/** Shared field-level checks; pushes messages into `errors`. */
function checkCommonFields(body, errors) {
  if (body.email !== undefined) {
    if (!isString(body.email) || !EMAIL_RE.test(body.email.trim())) {
      errors.push({ field: 'email', message: 'email must be valid' });
    }
  }
  if (body.status !== undefined && !LEAD_STATUS_VALUES.includes(body.status)) {
    errors.push({ field: 'status', message: 'Invalid status value' });
  }
  if (
    body.lead_temperature !== undefined &&
    !LEAD_TEMPERATURE_VALUES.includes(body.lead_temperature)
  ) {
    errors.push({
      field: 'lead_temperature',
      message: 'Invalid temperature value',
    });
  }
  if (body.group_ids !== undefined) {
    if (!Array.isArray(body.group_ids) || !body.group_ids.every(isString)) {
      errors.push({ field: 'group_ids', message: 'group_ids must be an array of strings' });
    }
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || !body.tags.every(isString)) {
      errors.push({ field: 'tags', message: 'tags must be an array of strings' });
    }
  }
  if (
    body.consent_status !== undefined &&
    !CONSENT_STATUS_VALUES.includes(body.consent_status)
  ) {
    errors.push({ field: 'consent_status', message: 'Invalid consent status' });
  }
  if (body.qualification_score !== undefined) {
    const n = Number(body.qualification_score);
    if (Number.isNaN(n) || n < 0 || n > 10) {
      errors.push({
        field: 'qualification_score',
        message: 'score must be between 0 and 10',
      });
    }
  }
  if (body.value !== undefined) {
    const n = Number(body.value);
    if (Number.isNaN(n) || n < 0) {
      errors.push({ field: 'value', message: 'value must be a positive number' });
    }
  }
}

function rejectUnknown(body, errors) {
  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELDS.includes(key)) {
      errors.push({ field: key, message: 'Unknown field' });
    }
  }
}

/** True if `field` has a real value in `body` -- string fields must be
 * non-blank after trim, numeric fields (qualification_score) must parse. */
function isFieldPresent(body, field) {
  const value = body[field];
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return !Number.isNaN(value);
  return true;
}

/**
 * Phase 2.1/2.2 — create: which fields are required is now tenant-
 * configurable (Settings > Lead Fields), not hardcoded to name+phone.
 * Falls back to name+phone if the tenant lookup fails for any reason, so a
 * DB hiccup here degrades to the old default rather than blocking every
 * lead creation outright.
 */
export const validateCreateLead = async (req, _res, next) => {
  const body = req.body || {};
  const errors = [];

  let requiredFields = ['name', 'phone'];
  try {
    const tenant = await Tenant.findById(req.context?.tenantId).select('requiredLeadFields').lean();
    if (tenant?.requiredLeadFields?.length) requiredFields = tenant.requiredLeadFields;
  } catch {
    // fall through to the default above
  }

  for (const field of requiredFields) {
    if (!isFieldPresent(body, field)) {
      errors.push({ field, message: `${field} is required` });
    }
  }
  checkCommonFields(body, errors);
  rejectUnknown(body, errors);

  if (errors.length) return next(AppError.badRequest('Validation failed', errors));
  next();
};

/** Phase 2.3 — update: all optional, reject invalid status/values. */
export const validateUpdateLead = (req, _res, next) => {
  const body = req.body || {};
  const errors = [];

  if (Object.keys(body).length === 0) {
    errors.push({ field: 'body', message: 'At least one field is required' });
  }
  if (body.name !== undefined && (!isString(body.name) || !body.name.trim())) {
    errors.push({ field: 'name', message: 'name cannot be empty' });
  }
  if (body.phone !== undefined && (!isString(body.phone) || !body.phone.trim())) {
    errors.push({ field: 'phone', message: 'phone cannot be empty' });
  }
  checkCommonFields(body, errors);
  rejectUnknown(body, errors);

  if (errors.length) return next(AppError.badRequest('Validation failed', errors));
  next();
};