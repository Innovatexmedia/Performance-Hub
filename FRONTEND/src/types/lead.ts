
export type LeadStatus =
  | 'New' | 'Contacted' | 'Qualified' | 'Booked' | 'Call Completed'
  | 'Proposal Sent' | 'Won' | 'Lost' | 'Nurture' | 'Ghosted';

export type LeadTemperature = 'Hot' | 'Warm' | 'Cold';

export type ConsentStatus = 'granted' | 'pending' | 'revoked';

export const LEAD_STATUS_VALUES: LeadStatus[] = [
  'New', 'Contacted', 'Qualified', 'Booked', 'Call Completed',
  'Proposal Sent', 'Won', 'Lost', 'Nurture', 'Ghosted',
];
export const LEAD_TEMPERATURE_VALUES: LeadTemperature[] = ['Hot', 'Warm', 'Cold'];

/** GET /api/leads row shape -- toLeadListDTO. Deliberately narrow. */
export interface LeadListItem {
  id: string;
  name: string;
  email: string;
  phone: string;
  whatsapp_number: string;
  company: string;
  status: LeadStatus;
  lead_temperature: LeadTemperature;
  qualification_score: number;
  source: string;
  assigned_user_id: string | null;
  /** AiSensy-style multi-membership -- a lead can belong to several groups
   * at once. Empty array = no group. */
  group_ids: string[];
  /** Freeform contact tags, distinct from Conversation.tags (which label
   * individual WhatsApp threads, not the underlying contact). Powers
   * campaign/broadcast audience targeting. */
  tags: string[];
  value: number;
  consent_status: ConsentStatus;
  opt_out_status: boolean;
  created_at: string;
  last_contacted_at: string | null;
}

/** GET /api/leads/:id shape -- toLeadDTO (full document, _id -> id). */
export interface Lead {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
  phone: string;
  whatsapp_number: string;
  company: string;
  source: string;
  medium: string;
  campaign: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
  status: LeadStatus;
  qualification_score: number;
  lead_temperature: LeadTemperature;
  assigned_user_id: string | null;
  /** AiSensy-style multi-membership -- a lead can belong to several groups
   * at once. Empty array = no group. */
  group_ids: string[];
  /** Freeform contact tags, distinct from Conversation.tags. */
  tags: string[];
  segment: string;
  value: number;
  notes: string;
  consent_status: ConsentStatus;
  opt_out_status: boolean;
  last_contacted_at: string | null;
  archived?: boolean;
  created_at: string;
  updated_at: string;
}

/** POST/PATCH body -- only ALLOWED_FIELDS from lead.validator.js. */
export interface LeadInput {
  name?: string;
  email?: string;
  phone?: string;
  whatsapp_number?: string;
  company?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  status?: LeadStatus;
  qualification_score?: number;
  lead_temperature?: LeadTemperature;
  assigned_user_id?: string | null;
  /** Full desired membership list for a PATCH -- replaces group_ids
   * entirely (send the current array plus/minus the one you're
   * changing, not just the single id being added/removed). */
  group_ids?: string[];
  /** Full desired tag list for a PATCH -- same "send the whole array"
   * semantics as group_ids. */
  tags?: string[];
  segment?: string;
  value?: number;
  notes?: string;
  consent_status?: ConsentStatus;
  opt_out_status?: boolean;
  last_contacted_at?: string | null;
}

/** Query params accepted by GET /api/leads -- see search/filter.service.js. */
export interface LeadListQuery {
  search?: string;
  status?: LeadStatus;
  lead_temperature?: LeadTemperature;
  source?: string;
  segment?: string;
  assigned_user_id?: string;
  /** Filters to leads whose group_ids ARRAY contains this one id -- still
   * a single id per request (not the full membership list), matches
   * query-builder.js's `{ group_ids: group_id }` "array contains" query. */
  group_id?: string;
  /** Comma-separated list -- matches leads carrying ALL listed tags
   * ($all semantics, same as the campaign/broadcast audience builder). */
  tags?: string;
  includeArchived?: boolean;
  archivedOnly?: boolean;
  sort?: string;
  page?: number;
  limit?: number;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface LeadListResult {
  data: LeadListItem[];
  pagination: Pagination;
}

/** GET /api/leads/:id/notes and POST response -- raw Mongoose LeadNote doc. */
export interface LeadNote {
  _id: string;
  tenant_id: string;
  lead_id: string;
  text: string;
  author: string | null;
  created_at: string;
  updated_at: string;
}

/** GET /api/leads/:id/activities -- raw Mongoose LeadActivity doc. */
export interface LeadActivity {
  _id: string;
  tenant_id: string;
  lead_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  type: string;
  message: string;
  actor: string | null;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * GET /api/leads/:id/details -- the drawer bundle.
 * `recommendation` is explicitly "Mock AI" per its own source comment
 * (src/modules/leads/ai/next-action.service.js) -- a deterministic
 * status -> canned-action lookup table, not a real model call.
 */
export interface LeadRecommendation {
  nextAction: string;
  reason: string;
  analysis: {
    engagement: 'high' | 'medium' | 'low';
    ghostingRisk: 'low' | 'medium' | 'high' | 'unknown';
    daysSinceContact: number | null;
    signals: string[];
  };
  suggestions: string[];
}

export interface LeadDetails {
  lead: Lead;
  notes: LeadNote[];
  timeline: LeadActivity[];
  recommendation: LeadRecommendation;
  counts: {
    deals: number;
    bookings: number;
    qualifications: number;
    calls: number;
    payments: number;
    notes: number;
    activities: number;
  };
}

/** GET /api/leads/constants */
export interface LeadConstants {
  statuses: LeadStatus[];
  temperatures: LeadTemperature[];
  consentStatuses: ConsentStatus[];
}

/**
 * POST /api/leads/import response -- see import.service.js importRows().
 * `errors[].line` is the CSV line number (1-indexed, +1 for the header row).
 */
export interface ImportSummary {
  total: number;
  created: number;
  skipped: number;
  failed: number;
  errors: { line: number; error: string }[];
}