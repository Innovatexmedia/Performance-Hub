import { leadRepository }        from './lead.repository.js';
import { ROLES }                 from '../../auth/constants/roles.js';
import { duplicateService }      from '../duplicate-detection/duplicate.service.js';
import { scoringService }        from '../scoring/scoring.service.js';
import { activityService }       from '../activities/activity.service.js';
import { ACTIVITY_TYPE }         from '../activities/activity.model.js';
import { noteService }           from '../notes/note.service.js';
import { recommendationService } from '../ai/recommendation.service.js';
import { buildSearch }           from '../search/search.service.js';
import { leadEvents }            from '../../../shared/events/lead.events.js';
import { toLeadDTO, toLeadListDTOs } from '../../../shared/mappers/lead.mappers.js';
import { AppError, paginationMeta } from '../../../shared/helpers/lead.helpers.js';
import { LEAD_STATUS }           from './lead.constants.js';

import { countPaymentsByLead }   from '../../payments/payment.service.js';
// Booking integration — countBookingsByLead only, no circular dependency.
// booking.service.js imports Lead directly (leadModel), NOT leadService.
import { createTrackingEvent }         from '../../attribution/attribution.service.js';
import { TRACKING_EVENT_TYPE }          from '../../attribution/attribution.constants.js';
import { countBookingsByLead }        from '../../bookings/booking.service.js';
import { countQualificationsByLead } from '../../qualification/qualification.service.js';
import { countCallsByLead }            from '../../calls/call.service.js';

/**
 * A sales_user may only read/edit/archive/restore leads assigned to THEM,
 * strictly -- not unassigned ones either -- never another rep's, even by
 * guessing/copying an ID directly. Everyone else (tenant_owner/
 * tenant_admin/read_only_user/super_admin) is unrestricted. Throws the
 * same 404 a nonexistent lead would, so this doesn't leak *whether*
 * another rep's lead exists.
 */
function assertLeadAccessible(ctx, lead) {
  if (ctx.role === ROLES.SALES_USER && lead.assigned_user_id !== ctx.userId) {
    throw AppError.notFound('Lead not found');
  }
}

/**
 * Lead Service — business logic + cross-module orchestration.
 * Controllers call this; this calls repositories and sibling services.
 * `ctx` = { tenantId, userId, role }
 */
export const leadService = {

  // ─── CREATE ────────────────────────────────────────────────────────────────

  async createLead(ctx, data, { skipDuplicateCheck = false } = {}) {
    if (!skipDuplicateCheck) {
      await duplicateService.assertNoDuplicate(ctx.tenantId, {
        email: data.email,
        phone: data.phone,
      });
    }

    const { score, temperature } = scoringService.scoreLead(data);
    const payload = {
      ...data,
      tenant_id:           ctx.tenantId,
      qualification_score: data.qualification_score ?? score,
      lead_temperature:    data.lead_temperature ?? temperature,
    };

    // A sales_user can only ever see leads assigned to THEM (see
    // assertLeadAccessible/buildLeadFilter) -- so a lead they create but
    // leave unassigned would immediately vanish from their own view the
    // moment it's saved. Default it to themselves unless they explicitly
    // picked a different owner (e.g. handing it straight to a teammate).
    if (ctx.role === ROLES.SALES_USER && !payload.assigned_user_id) {
      payload.assigned_user_id = ctx.userId;
    }

    const lead = await leadRepository.create(payload);

    await activityService.log(ctx, lead._id, ACTIVITY_TYPE.LEAD_CREATED, {
      message: `Lead "${lead.name || lead.email || lead.phone}" created`,
    });

    // Emit LEAD_CREATED tracking event
    createTrackingEvent({
      tenant_id:  ctx.tenantId,
      event_type: TRACKING_EVENT_TYPE.LEAD_CREATED,
      lead_id:    lead._id,
      source:     lead.source || null,
      medium:     lead.medium || null,
      campaign:   lead.campaign || null,
    }).catch(() => {});

    leadEvents.created({
      tenantId: ctx.tenantId,
      leadId:   String(lead._id),
      lead:     toLeadDTO(lead),
      actor:    ctx.userId,
    });

    return lead;
  },

  // ─── READ SINGLE ───────────────────────────────────────────────────────────

  async getLead(ctx, id) {
    const lead = await leadRepository.findById(ctx.tenantId, id);
    if (!lead) throw AppError.notFound('Lead not found');
    assertLeadAccessible(ctx, lead);
    return lead;
  },

  // ─── READ LIST ─────────────────────────────────────────────────────────────

  async getLeads(ctx, query) {
    const { filter, sort, page, limit, skip } = buildSearch(query, ctx);

    const [items, total] = await Promise.all([
      leadRepository.find(ctx.tenantId, filter, { sort, skip, limit }),
      leadRepository.count(ctx.tenantId, filter),
    ]);

    return {
      data:       toLeadListDTOs(items),
      pagination: paginationMeta({ page, limit, total }),
    };
  },

  // ─── UPDATE ────────────────────────────────────────────────────────────────

  async updateLead(ctx, id, patch) {
    const existing = await leadRepository.findById(ctx.tenantId, id);
    if (!existing) throw AppError.notFound('Lead not found');
    assertLeadAccessible(ctx, existing);

    const merged = { ...existing.toObject(), ...patch };
    if (patch.qualification_score === undefined) {
      const { score, temperature } = scoringService.scoreLead(merged);
      patch.qualification_score = score;
      if (patch.lead_temperature === undefined) {
        patch.lead_temperature = temperature;
      }
    }

    const updated = await leadRepository.updateById(ctx.tenantId, id, patch);

    const fields = Object.keys(patch);
    let activityType    = ACTIVITY_TYPE.LEAD_UPDATED;
    let activityMessage = 'Lead updated';

    if (fields.includes('status')) {
      activityType    = 'Lead Status Updated';
      activityMessage = `Lead status changed to ${patch.status}`;
    }

    await activityService.log(ctx, id, activityType, {
      message: activityMessage,
      meta:    { fields },
    });

    if (
      patch.assigned_user_id !== undefined &&
      patch.assigned_user_id !== existing.assigned_user_id
    ) {
      await activityService.log(ctx, id, ACTIVITY_TYPE.LEAD_ASSIGNED, {
        message: `Lead assigned to ${patch.assigned_user_id || 'unassigned'}`,
        meta:    { from: existing.assigned_user_id, to: patch.assigned_user_id },
      });
    }

    if (
      patch.status === LEAD_STATUS.QUALIFIED &&
      existing.status !== LEAD_STATUS.QUALIFIED
    ) {
      await activityService.log(ctx, id, ACTIVITY_TYPE.LEAD_QUALIFIED, {
        message: 'Lead qualified',
      });
    }

    leadEvents.updated({
      tenantId: ctx.tenantId,
      leadId:   id,
      lead:     toLeadDTO(updated),
      actor:    ctx.userId,
      changed:  Object.keys(patch),
    });

    return updated;
  },

  // ─── ARCHIVE ───────────────────────────────────────────────────────────────

  async archiveLead(ctx, id) {
    const existing = await leadRepository.findById(ctx.tenantId, id);
    if (!existing) throw AppError.notFound('Lead not found');
    assertLeadAccessible(ctx, existing);

    const archived = await leadRepository.archiveById(ctx.tenantId, id);

    await activityService.log(ctx, id, ACTIVITY_TYPE.LEAD_ARCHIVED, {
      message: 'Lead archived',
    });

    leadEvents.archived({
      tenantId: ctx.tenantId,
      leadId:   id,
      lead:     toLeadDTO(archived),
      actor:    ctx.userId,
    });

    return archived;
  },

  async unarchiveLead(ctx, id) {
    const existing = await leadRepository.findById(ctx.tenantId, id);
    if (!existing) throw AppError.notFound('Lead not found');
    assertLeadAccessible(ctx, existing);

    const restored = await leadRepository.unarchiveById(ctx.tenantId, id);

    await activityService.log(ctx, id, ACTIVITY_TYPE.LEAD_RESTORED, {
      message: 'Lead restored from archive',
    });

    // No dedicated LEAD_RESTORED bus event -- this is functionally an
    // update (archived: true -> false), so reuse `updated` rather than add
    // a new event type every subscriber would need to special-case.
    leadEvents.updated({
      tenantId: ctx.tenantId,
      leadId:   id,
      lead:     toLeadDTO(restored),
      actor:    ctx.userId,
    });

    return restored;
  },

  // ─── DETAIL DRAWER ─────────────────────────────────────────────────────────

  /**
   * getLeadDetails — all data for the lead detail drawer.
   * SOURCE: FRONTEND_SPEC §4 lead drawer "linked record counts (deals/bookings/calls/payments)"
   *
   * bookings count is now REAL via countBookingsByLead().
   * deals/calls/payments remain stubbed until those modules are integrated.
   */
  async getLeadDetails(ctx, id) {
    const lead = await this.getLead(ctx, id);

    const [notes, timeline, noteCount, activityCount, bookingCount, qualificationCount, paymentCount, callCount] =
      await Promise.all([
        noteService.getNotes(ctx, id),
        activityService.getTimeline(ctx, id),
        noteService.count(ctx, id),
        activityService.count(ctx, id),
        countBookingsByLead(ctx.tenantId, String(lead._id)),
        countQualificationsByLead(ctx.tenantId, String(lead._id)),
        countCallsByLead(ctx.tenantId, String(lead._id)),
        countPaymentsByLead(ctx.tenantId, String(lead._id)),
      ]);

    return {
      lead:           toLeadDTO(lead),
      notes,
      timeline,
      recommendation: recommendationService.forLead(lead.toObject()),
      counts: {
        deals:      0,
        bookings:       bookingCount,
        qualifications: qualificationCount,
        calls:          callCount,
        payments:       paymentCount,
        notes:      noteCount,
        activities: activityCount,
      },
    };
  },
};