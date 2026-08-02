import { AppError } from '../../../shared/helpers/lead.helpers.js';
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
  'group_id',
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

/** Phase 2.1/2.2 — create: name + phone required. */
export const validateCreateLead = (req, _res, next) => {
  const body = req.body || {};
  const errors = [];

  if (!isString(body.name) || !body.name.trim()) {
    errors.push({ field: 'name', message: 'name is required' });
  }
  if (!isString(body.phone) || !body.phone.trim()) {
    errors.push({ field: 'phone', message: 'phone is required' });
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