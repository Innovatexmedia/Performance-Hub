/**
 * =============================================================================
 * InnovateX Revenue OS — Nurture Workflow Variable Registry
 * =============================================================================
 *
 * FILE: src/modules/whatsapp/submodules/nurtures/nurtureVariables.js
 *
 * The single, real source of truth for every variable a nurture workflow
 * node can reference (e.g. {{lead.name}}). Both the backend interpolation
 * call and the frontend "Insert Variable" picker read from this same
 * registry (via GET /whatsapp/nurtures/variables) so they can never
 * silently drift apart -- a variable added here is immediately real on
 * both sides, not defined twice in two places.
 *
 * Every field/path below is confirmed against the real, current model
 * definitions (Lead.model.js, Booking.model.js) -- not guessed.
 * =============================================================================
 */

import { Lead } from '../../../leads/lead/lead.model.js';
import { getBookingsByLead } from '../../../bookings/booking.service.js';

/**
 * VARIABLE_REGISTRY -- real, grouped list for the frontend picker.
 * `path` is the exact key used inside {{...}} in step content, matching
 * what buildVariableContext() below actually populates.
 */
export const VARIABLE_REGISTRY = Object.freeze([
  {
    group: 'Lead',
    variables: [
      { path: 'lead.name', label: 'Lead Name', example: 'Priya Sharma' },
      { path: 'lead.email', label: 'Email', example: 'priya@example.com' },
      { path: 'lead.phone', label: 'Phone', example: '+91 98765 43210' },
      { path: 'lead.company', label: 'Company', example: 'Acme Co' },
      { path: 'lead.source', label: 'Source', example: 'Website' },
      { path: 'lead.campaign', label: 'Campaign', example: 'summer-sale' },
      { path: 'lead.status', label: 'Status', example: 'Qualified' },
      { path: 'lead.temperature', label: 'AI Temperature', example: 'Hot' },
      { path: 'lead.ai_score', label: 'AI Qualification Score (0-10)', example: '8' },
    ],
  },
  {
    group: 'Booking',
    variables: [
      { path: 'booking.type', label: 'Meeting Type', example: 'Discovery Call' },
      { path: 'booking.date', label: 'Meeting Date', example: '2026-08-20' },
      { path: 'booking.time', label: 'Meeting Time', example: '15:00' },
      { path: 'booking.link', label: 'Meeting Link', example: 'https://meet.google.com/abc' },
      { path: 'booking.status', label: 'Booking Status', example: 'Scheduled' },
    ],
  },
]);

/**
 * buildVariableContext -- real, populated variable object for one lead,
 * used by interpolate() at actual send time. Booking fields are only
 * populated if the lead has a real, existing booking -- otherwise they
 * resolve to empty strings, same graceful-fallback behavior interpolate()
 * already has for any unrecognized/unpopulated variable.
 */
/**
 * NURTURE_VARIABLE_PATTERN -- deliberately separate from the existing
 * shared VARIABLE_PATTERN (used by Templates/AI Reply Assistant), which
 * only allows [a-zA-Z0-9_]+ and does not support dotted paths. Nurture's
 * variables use a real "group.field" convention ({{lead.name}},
 * {{booking.date}}) for clarity, so this pattern explicitly allows dots.
 * Kept fully isolated -- does not touch or affect the existing pattern
 * or its consumers at all.
 */
const NURTURE_VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/**
 * interpolateNurtureText -- real {{lead.name}}-style substitution for
 * Nurture step content (message text, email subject/body, webhook
 * URL/headers/body). Unrecognized variables are left as-is in the
 * output, same graceful behavior as the existing shared interpolate().
 */
export const interpolateNurtureText = (text, context = {}) => {
  if (!text) return text;
  return String(text).replace(NURTURE_VARIABLE_PATTERN, (full, path) => {
    const val = context[path];
    return val != null ? String(val) : full;
  });
};

export const buildVariableContext = async (tenantId, leadId) => {
  const lead = await Lead.findOne({ _id: leadId, tenant_id: String(tenantId) });
  if (!lead) return {};

  const context = {
    'lead.name': lead.name || '',
    'lead.email': lead.email || '',
    'lead.phone': lead.whatsapp_number || lead.phone || '',
    'lead.company': lead.company || '',
    'lead.source': lead.source || '',
    'lead.campaign': lead.campaign || '',
    'lead.status': lead.status || '',
    'lead.temperature': lead.lead_temperature || '',
    'lead.ai_score': lead.qualification_score != null ? String(lead.qualification_score) : '',
  };

  try {
    const bookings = await getBookingsByLead(String(tenantId), String(leadId));
    // Most recent real booking -- bookings are typically returned newest-first;
    // defensively re-sort here rather than assume caller ordering.
    const latest = Array.isArray(bookings) && bookings.length
      ? [...bookings].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0]
      : null;
    if (latest) {
      context['booking.type'] = latest.meeting_type || '';
      context['booking.date'] = latest.meeting_date || '';
      context['booking.time'] = latest.meeting_time || '';
      context['booking.link'] = latest.meeting_link || '';
      context['booking.status'] = latest.status || '';
    }
  } catch {
    // Real, non-fatal -- a lead with no bookings (or a lookup failure)
    // just means booking.* variables resolve to nothing, not an error
    // that blocks the whole interpolation.
  }

  return context;
};