export const TEMPLATE_CATEGORY = Object.freeze({
  MARKETING: 'MARKETING',
  UTILITY: 'UTILITY',
  AUTHENTICATION: 'AUTHENTICATION',
  BOOKING: 'BOOKING',
  PAYMENT: 'PAYMENT',
  FOLLOW_UP: 'FOLLOW_UP',
  REMINDER: 'REMINDER',
  SUPPORT: 'SUPPORT',
  SALES: 'SALES',
  CUSTOM: 'CUSTOM',
});
export const TEMPLATE_CATEGORY_VALUES = Object.freeze(Object.values(TEMPLATE_CATEGORY));

export const TEMPLATE_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  ARCHIVED: 'ARCHIVED',
});
export const TEMPLATE_STATUS_VALUES = Object.freeze(Object.values(TEMPLATE_STATUS));

/**
 * APPROVAL_STATUS -- re-exported, NOT redefined.
 *
 * This used to be a second, independent enum defined right here in this
 * file, with different values than templateApproval.constants.js's
 * APPROVAL_STATUS (ACTIVE, ARCHIVED, CHANGES_REQUESTED,
 * REJECTED_INTERNALLY existed here but not there; REJECTED and DISABLED
 * existed there but not here). Both enums back the SAME `approvalStatus`
 * field on the SAME WhatsAppTemplate document -- two independent sources
 * of truth for one piece of state is exactly how a value like
 * PROVIDER_APPROVED could get written by a path that bypassed the real
 * transition/role rules entirely (see templates.service.js history).
 *
 * templateApproval.constants.js is authoritative: it owns
 * ALLOWED_TRANSITIONS, PROVIDER_CONTROLLED_STATUSES, and role minimums for
 * every value in this enum. Re-exporting here (rather than importing
 * directly in templates.model.js) keeps this file's public surface
 * unchanged for anything already doing
 * `import { APPROVAL_STATUS } from './templates.constants.js'`.
 */
export { APPROVAL_STATUS, APPROVAL_STATUS_VALUES } from '../templateApproval/templateApproval.constants.js';

export const PROVIDER = Object.freeze({
  META_CLOUD: 'META_CLOUD',
  WATI: 'WATI',
  INTERAKT: 'INTERAKT',
  AISENSY: 'AISENSY',
  GALLABOX: 'GALLABOX',
  TWILIO: 'TWILIO',
  DIALOG360: '360DIALOG',
  CUSTOM_WEBHOOK: 'CUSTOM_WEBHOOK',
  SIMULATION: 'SIMULATION',
});
export const PROVIDER_VALUES = Object.freeze(Object.values(PROVIDER));

export const PROVIDER_STATUS = Object.freeze({
  PENDING: 'PENDING',
  UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SYNCED: 'SYNCED',
  ERROR: 'ERROR',
});
export const PROVIDER_STATUS_VALUES = Object.freeze(Object.values(PROVIDER_STATUS));

export const HEADER_TYPE = Object.freeze({
  NONE: 'NONE',
  TEXT: 'TEXT',
  IMAGE: 'IMAGE',
  VIDEO: 'VIDEO',
  DOCUMENT: 'DOCUMENT',
});
export const HEADER_TYPE_VALUES = Object.freeze(Object.values(HEADER_TYPE));

export const BUTTON_TYPE = Object.freeze({
  QUICK_REPLY: 'QUICK_REPLY',
  PHONE_NUMBER: 'PHONE_NUMBER',
  URL: 'URL',
  COPY_CODE: 'COPY_CODE',
  FLOW: 'FLOW',
  CUSTOM: 'CUSTOM',
});
export const BUTTON_TYPE_VALUES = Object.freeze(Object.values(BUTTON_TYPE));

// Button types that require a value (phone number, url, code, flow id).
export const BUTTON_TYPES_REQUIRING_VALUE = Object.freeze([
  BUTTON_TYPE.PHONE_NUMBER,
  BUTTON_TYPE.URL,
  BUTTON_TYPE.COPY_CODE,
  BUTTON_TYPE.FLOW,
]);

// Content limits (aligned with WhatsApp Cloud API).
export const MAX_BUTTONS = 10;
export const MAX_BODY_LENGTH = 1024;
export const MAX_FOOTER_LENGTH = 60;
export const MAX_HEADER_TEXT_LENGTH = 60;
export const MAX_BUTTON_TEXT_LENGTH = 25;

// {{variable}} detection — letters, digits, underscore.
export const VARIABLE_PATTERN = '\\{\\{\\s*([a-zA-Z0-9_]+)\\s*\\}\\}';

export const SUPPORTED_LANGUAGES = Object.freeze([
  { code: 'en', name: 'English' },
  { code: 'en_US', name: 'English (US)' },
  { code: 'en_GB', name: 'English (UK)' },
  { code: 'hi', name: 'Hindi' },
  { code: 'hi_IN', name: 'Hindi (India)' },
  { code: 'ar', name: 'Arabic' },
  { code: 'es', name: 'Spanish' },
  { code: 'es_ES', name: 'Spanish (Spain)' },
  { code: 'fr', name: 'French' },
  { code: 'fr_FR', name: 'French (France)' },
  { code: 'pt_BR', name: 'Portuguese (Brazil)' },
  { code: 'de', name: 'German' },
]);

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export const SEARCHABLE_FIELDS = Object.freeze(['name', 'slug', 'description', 'body']);
export const SORTABLE_FIELDS = Object.freeze([
  'createdAt',
  'updatedAt',
  'name',
  'usageCount',
  'lastUsedAt',
  'version',
]);