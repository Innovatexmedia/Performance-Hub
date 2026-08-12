/**
 * Settings domain constants.
 *
 * FILE: src/modules/settings/settings.constants.js
 *
 * SOURCE: FRONTEND_SPEC §19 Settings (10 tabs):
 *   Company · Branding · Lead Fields · Pipeline Stages · Qualification Questions
 *   · Scoring Rules · Notifications · Consent & Data · Billing · Security
 *
 * SOURCE: DEVELOPER_HANDOFF.md TenantSettings entity:
 *   "company_name, company_website, accent_color, qualification_questions[],
 *    pipeline_stages(PipelineStage[]), scoring_rules[{factor,weight}],
 *    consent_required, data_retention_days, notification_prefs, whatsapp(WhatsAppSettings)"
 *
 * NOTE: Settings are stored on the Tenant document directly (embedded).
 * No separate settings collection needed.
 */

import config from '../../config/config.js';

/**
 * SETTINGS_TAB — the 10 tabs from FRONTEND_SPEC §19
 */
export const SETTINGS_TAB = Object.freeze({
  COMPANY:        'company',
  BRANDING:       'branding',
  LEAD_FIELDS:    'lead_fields',
  PIPELINE_STAGES:'pipeline_stages',
  QUALIFICATION:  'qualification',
  SCORING_RULES:  'scoring_rules',
  NOTIFICATIONS:  'notifications',
  CONSENT:        'consent',
  BILLING:        'billing',
  SECURITY:       'security',
});

/**
 * ACCENT_COLORS — preset accent colors shown in Branding tab.
 * SOURCE: FRONTEND_SPEC §19 Branding — color swatches visible in screenshot
 */
export const ACCENT_COLORS = Object.freeze([
  '#6366f1', // indigo  (default)
  '#7c3aed', // violet
  '#0d9488', // teal
  '#3b82f6', // blue
  '#ec4899', // pink
  '#f59e0b', // amber
  '#10b981', // emerald
]);

/**
 * LEAD_FIELDS — standard fields captured for every lead (read-only display).
 * SOURCE: FRONTEND_SPEC §19 Lead Fields tab — "Standard fields captured for every lead"
 * Screenshot shows: name, email, phone, whatsapp_number, company, source,
 *                   campaign, segment, consent_status, qualification_score
 */
export const LEAD_FIELDS = Object.freeze([
  'name', 'email', 'phone', 'whatsapp_number', 'company',
  'source', 'campaign', 'segment', 'consent_status', 'qualification_score',
]);

/**
 * PIPELINE_STAGES — system-defined stages (read-only display).
 * SOURCE: FRONTEND_SPEC §19 Pipeline Stages tab + deal.constants.js DEAL_STAGE
 * Screenshot: New Lead(#1), Qualified(#2), Booked Call(#3), Call Completed(#4),
 *             Proposal Sent(#5), Negotiation(#6), Won(#7), Lost(#8), Nurture(#9)
 */
export const PIPELINE_STAGES = Object.freeze([
  { id: 1, name: 'New Lead',       color: '#64748b' },
  { id: 2, name: 'Qualified',      color: '#3b82f6' },
  { id: 3, name: 'Booked Call',    color: '#7c3aed' },
  { id: 4, name: 'Call Completed', color: '#0d9488' },
  { id: 5, name: 'Proposal Sent',  color: '#f59e0b' },
  { id: 6, name: 'Negotiation',    color: '#ec4899' },
  { id: 7, name: 'Won',            color: '#10b981' },
  { id: 8, name: 'Lost',           color: '#ef4444' },
  { id: 9, name: 'Nurture',        color: '#14b8a6' },
]);

/**
 * DEFAULT_QUALIFICATION_QUESTIONS — shown in Qualification tab.
 * SOURCE: FRONTEND_SPEC §19 Qualification Questions tab screenshot
 */
export const DEFAULT_QUALIFICATION_QUESTIONS = Object.freeze([
  'What problem are you trying to solve?',
  'What is your monthly lead volume?',
  'What is your current revenue range?',
  'What tools are you using now?',
  'How soon do you want to implement?',
  'What is your budget range?',
  'Who makes the buying decision?',
]);

/**
 * DEFAULT_SCORING_RULES — shown in Scoring Rules tab.
 * SOURCE: FRONTEND_SPEC §19 Scoring Rules tab screenshot:
 *   Budget fit(30) | Urgency(25) | Decision authority(20) | Engagement(15) | Company size(10)
 * Total must be 100.
 */
export const DEFAULT_SCORING_RULES = Object.freeze([
  { factor: 'Budget fit',          weight: 30 },
  { factor: 'Urgency',             weight: 25 },
  { factor: 'Decision authority',  weight: 20 },
  { factor: 'Engagement',          weight: 15 },
  { factor: 'Company size',        weight: 10 },
]);

/**
 * DATA_RETENTION_OPTIONS — options for consent & data retention.
 * SOURCE: DEVELOPER_HANDOFF.md TenantSettings.data_retention_days
 */
export const DATA_RETENTION_OPTIONS = Object.freeze([30, 60, 90, 180, 365]);

/**
 * SUBSCRIPTION_PLAN_DETAILS — billing tab display info.
 * SOURCE: FRONTEND_SPEC §19 Billing tab
 *
 * maxUsers now reads from the same PLAN_MAX_USERS_* env vars as
 * Tenant.js's PLAN_LIMITS (see config.js) -- previously this was a
 * SEPARATE, hardcoded set of numbers, with a real risk of silently
 * drifting out of sync with what Tenant.js actually enforces. Now both
 * read from one real source, so the Billing tab always shows the number
 * that's genuinely enforced.
 */
export const SUBSCRIPTION_PLAN_DETAILS = Object.freeze({
  free:       { name: 'Free',       price: 0,    currency: 'USD', maxUsers: config.PLAN_MAX_USERS_FREE,       maxLeads: 250 },
  starter:    { name: 'Starter',    price: 29,   currency: 'USD', maxUsers: config.PLAN_MAX_USERS_STARTER,    maxLeads: 1000 },
  growth:     { name: 'Growth',     price: 79,   currency: 'USD', maxUsers: config.PLAN_MAX_USERS_GROWTH,     maxLeads: 10000 },
  scale:      { name: 'Scale',      price: 199,  currency: 'USD', maxUsers: config.PLAN_MAX_USERS_SCALE,      maxLeads: 50000 },
  enterprise: { name: 'Enterprise', price: null, currency: 'USD', maxUsers: config.PLAN_MAX_USERS_ENTERPRISE, maxLeads: 999999 },
});