/**
 * AI Qualification Service — business logic + cross-module orchestration.
 *
 * SOURCE: MASTER_SPEC.md §B5:
 *   "Configurable discovery questions → AI engine → fit score 1–10, temperature,
 *    quality, buying intent, urgency, pain points, recommended offer, next action,
 *    follow-up draft. Apply & route. Updates lead score/temp/status + timeline +
 *    (if hot) notify. Human override supported."
 *
 * SOURCE: DEVELOPER_HANDOFF.md qualifyLead action:
 *   "qualifyLead(id, {score,temperature,reason,nextAction})
 *    → updates score/temp/status/notes + track('AI Qualified') + (if Hot) notify + toast"
 *
 * SOURCE: FRONTEND_SPEC §6:
 *   "Flow: pick lead → answer discovery questions → Run AI Qualification →
 *    assessment → apply & route (booking / nurture / sales)"
 *   "Applying updates the lead score/temperature/status + timeline + (if hot) notification"
 *   "Human override supported"
 *
 * THREE OPERATIONS:
 *   1. runQualification  — runs AI assessment, saves result (not yet applied)
 *   2. applyResult       — user clicks Apply → updates lead + deal + timeline + notify
 *   3. overrideScore     — human adjusts AI score → updates lead score + temperature
 *
 * Pattern matches booking.service.js and call.service.js exactly.
 */

import * as qualRepo from './qualification.repository.js';
import { automationRulesService } from '../whatsapp/submodules/automationRules/automationRules.service.js';
import { TRIGGER_TYPE as AUTOMATION_TRIGGER_TYPE } from '../whatsapp/submodules/automationRules/automationRules.constants.js';
import {
  QUALIFICATION_ROUTE,
  TRACKING_EVENT_ON_QUALIFY,
  LEAD_STATUS_ON_QUALIFY,
  PIPELINE_STAGE_ON_QUALIFY,
} from './qualification.constants.js';

// Named imports — Lead and Deal use named exports
import { Lead } from '../leads/lead/lead.model.js';
import { Deal } from '../pipeline/deals/deal.model.js';

// EXISTING AI service — already implemented in leads/ai/
// qualificationAiService.assess(lead, answers) → {fitScore, temperature, quality,
//   buyingIntent, urgency, painPoints, recommendedOffer, nextAction, followUpDraft, isLive}
import { qualificationAiService } from '../leads/ai/qualification-ai.service.js';

// Scoring service — temperatureFor(score) for override recalculation
import { temperatureFor } from '../leads/scoring/scoring.service.js';

// Activity logging
import { ACTIVITY_TYPE } from '../leads/activities/activity.model.js';
import { activityService } from '../leads/activities/activity.service.js';

// Notifications
import Notification from '../leads/notifications/notification.model.js';

// AppError and paginationMeta — same import as lead.service.js
import { AppError, paginationMeta } from '../../shared/helpers/lead.helpers.js';

// LEAD_TEMPERATURE for hot lead check
import { LEAD_TEMPERATURE } from '../leads/lead/lead.constants.js';
import { nurturesService } from '../whatsapp/submodules/nurtures/nurtures.service.js';
import { NurtureSequence, NurtureEnrollment } from '../whatsapp/submodules/nurtures/nurtures.model.js';
import { TRIGGER_TYPE, SEQUENCE_STATUS, ENROLLMENT_STATUS } from '../whatsapp/submodules/nurtures/nurtures.constants.js';

// =============================================================================
// PRIVATE HELPERS — identical pattern to booking.service.js and call.service.js
// =============================================================================

/**
 * buildCtx — converts req.user (JWT) → ctx shape used by all services.
 * req.user = { sub, tenantId, role, sessionId }  (from auth.middleware.js)
 * ctx      = { tenantId, userId, role }
 */
const buildCtx = (reqUser) => ({
  tenantId: reqUser.tenantId,
  userId:   reqUser.sub,
  role:     reqUser.role,
});

/**
 * logActivity — non-blocking activity timeline log.
 * Pattern matches booking.service.js logActivity exactly.
 */
const logActivity = async (ctx, leadId, type, message, meta = {}) => {
  try {
    await activityService.log(ctx, leadId, type, { message, meta });
  } catch (err) {
    console.warn(`[qualification] activity log failed for lead ${leadId}: ${err.message}`);
  }
};

/**
 * createNotification — non-blocking in-app notification.
 * Pattern matches booking.service.js createNotification exactly.
 * Notification model fields: tenantId(String), userId(ObjectId), title, body, isRead, metadata
 */
const createNotification = async (tenantId, userId, title, body, metadata = {}) => {
  try {
    if (!userId) return;
    await Notification.create({ tenantId, userId, title, body, isRead: false, metadata });
  } catch (err) {
    console.warn(`[qualification] notification failed: ${err.message}`);
  }
};

/**
 * emitTrackingEvent — placeholder until tracking module is built.
 * SOURCE: MASTER_SPEC §I2 TrackingEventType — 'AI Qualified'
 * Pattern matches booking.service.js emitTrackingEvent exactly.
 */
// Attribution tracking service
import { createTrackingEvent } from '../attribution/attribution.service.js';

const emitTrackingEvent = async (eventType, leadId, tenantId, metadata = {}) => {
  await createTrackingEvent({ tenant_id: tenantId, event_type: eventType, lead_id: leadId, ...metadata }).catch(() => {});
};

/**
 * getSuggestedRoute — determines routing recommendation from temperature.
 * SOURCE: FRONTEND_SPEC §6 "apply & route (booking / nurture / sales)"
 */
const getSuggestedRoute = (temperature) => {
  if (temperature === LEAD_TEMPERATURE.HOT)  return QUALIFICATION_ROUTE.BOOK_CALL;
  if (temperature === LEAD_TEMPERATURE.WARM) return QUALIFICATION_ROUTE.ADD_NURTURE;
  return QUALIFICATION_ROUTE.SALES_REVIEW;
};

// =============================================================================
// GET QUALIFICATIONS — paginated list
// =============================================================================

export const getQualifications = async (tenantId, filter = {}, options = {}) => {
  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  const [qualifications, total] = await Promise.all([
    qualRepo.findByTenantId(tenantId, filter, { skip, limit }),
    qualRepo.countByTenantId(tenantId, filter),
  ]);

  return {
    qualifications,
    pagination: paginationMeta({ page, limit, total }),
  };
};

// =============================================================================
// GET SINGLE
// =============================================================================

export const getQualificationById = async (tenantId, id) => {
  const qualification = await qualRepo.findById(tenantId, id);
  if (!qualification) throw AppError.notFound('Qualification not found');
  return qualification;
};

// =============================================================================
// GET BY LEAD
// =============================================================================

export const getQualificationsByLead = (tenantId, leadId) =>
  qualRepo.findByLead(tenantId, leadId);

export const getLatestForLead = (tenantId, leadId) =>
  qualRepo.findLatestByLead(tenantId, leadId);

export const countQualificationsByLead = (tenantId, leadId) =>
  qualRepo.countByLead(tenantId, leadId);

// =============================================================================
// OPERATION 1 — RUN QUALIFICATION
// =============================================================================

/**
 * runQualification — runs the AI assessment and saves the result.
 *
 * DOES NOT update the lead yet — result is saved with applied: false.
 * The sales rep reviews the assessment first, then clicks "Apply".
 *
 * SOURCE: FRONTEND_SPEC §6:
 *   "Flow: pick lead → answer discovery questions → Run AI Qualification → assessment"
 *   "The result is shown on the right column before applying"
 *
 * STEPS:
 *   1. Verify lead exists in tenant
 *   2. Call qualificationAiService.assess(lead, answers) — existing service
 *   3. Determine suggested_route from temperature
 *   4. Save qualification record (applied: false)
 *   5. Return assessment for frontend to display
 *
 * @param {string} leadId   — from request body
 * @param {Object} answers  — discovery question answers
 * @param {Object} reqUser  — req.user from authenticate middleware
 */
export const runQualification = async (leadId, answers, reqUser) => {
  const ctx = buildCtx(reqUser);

  // ── 1. Verify lead exists in this tenant ──────────────────────────────────
  const lead = await Lead.findOne({
    _id:       leadId,
    tenant_id: String(ctx.tenantId),
    archived:  false,
  });
  if (!lead) throw AppError.notFound('Lead not found in this workspace');

  // ── 2. Call existing qualificationAiService.assess() ─────────────────────
  // SOURCE: modules/leads/ai/qualification-ai.service.js
  // Returns: { fitScore, temperature, quality, buyingIntent, urgency,
  //            painPoints, recommendedOffer, nextAction, followUpDraft, isLive }
  const assessment = await qualificationAiService.assess(lead.toObject(), answers || {});

  // ── 3. Determine suggested route from temperature ─────────────────────────
  const suggested_route = getSuggestedRoute(assessment.temperature);

  // ── 4. Save qualification record (not yet applied) ────────────────────────
  const qualification = await qualRepo.create({
    tenant_id:         String(ctx.tenantId),
    lead_id:           leadId,
    answered_by:       ctx.userId,
    answers:           answers || {},
    fit_score:         assessment.fitScore,
    temperature:       assessment.temperature,
    quality:           assessment.quality,
    buying_intent:     assessment.buyingIntent,
    urgency:           assessment.urgency,
    pain_points:       assessment.painPoints || [],
    recommended_offer: assessment.recommendedOffer || '',
    next_action:       assessment.nextAction || '',
    follow_up_draft:   assessment.followUpDraft || '',
    reason:            assessment.reason || '',
    is_ai_live:        assessment.isLive || false,
    suggested_route,
    applied:           false,
    created_by:        ctx.userId,
  });

  // ── 5. Return full assessment + qualification id ──────────────────────────
  return qualification;
};

// =============================================================================
// OPERATION 2 — APPLY RESULT
// =============================================================================

/**
 * applyResult — user clicks "Apply to Lead" — updates lead + deal + timeline + notify.
 *
 * SOURCE: DEVELOPER_HANDOFF.md qualifyLead:
 *   "updates score/temp/status/notes + track('AI Qualified') + (if Hot) notify"
 * SOURCE: FRONTEND_SPEC §6:
 *   "Applying updates the lead score/temperature/status + timeline + (if hot) notification"
 *
 * STEPS:
 *   1. Load qualification record
 *   2. Update lead: qualification_score, lead_temperature, status → 'Qualified'
 *   3. Advance deal to 'Qualified' stage (only if lead was New/Contacted)
 *   4. Mark qualification.applied = true
 *   5. Log to activity timeline (LEAD_QUALIFIED)
 *   6. If temperature === Hot → create notification
 *   7. Emit tracking event 'AI Qualified'
 *
 * @param {string} qualificationId
 * @param {Object} reqUser
 */
export const applyResult = async (qualificationId, reqUser) => {
  const ctx = buildCtx(reqUser);

  // ── 1. Load qualification ─────────────────────────────────────────────────
  const qualification = await qualRepo.findById(String(ctx.tenantId), qualificationId);
  if (!qualification) throw AppError.notFound('Qualification not found');
  if (qualification.applied) throw AppError.badRequest('This qualification has already been applied');

  const leadId    = qualification.lead_id;
  const score     = qualification.override_score ?? qualification.fit_score;
  const temp      = qualification.temperature;

  // ── 2. Update lead: score + temperature + status ──────────────────────────
  // SOURCE: DEVELOPER_HANDOFF.md "updates score/temp/status"
  const updatedLead = await Lead.findOneAndUpdate(
    { _id: leadId, tenant_id: String(ctx.tenantId) },
    {
      $set: {
        qualification_score: score,
        lead_temperature:    temp,
        status:              LEAD_STATUS_ON_QUALIFY,
      },
    },
    { new: true }
  );
  if (!updatedLead) throw AppError.notFound('Lead not found');

  // ── 3. Advance deal to 'Qualified' stage ──────────────────────────────────
  // Only advance if deal exists and is not already past Qualified stage
  // (won't downgrade a deal that's at Booked Call, Proposal Sent, etc.)
  const openDeal = await Deal.findOne({
    tenant_id: String(ctx.tenantId),
    lead_id:   leadId,
    archived:  false,
    stage:     { $in: ['New Lead', 'Qualified'] },
  }).sort({ created_at: -1 });

  if (openDeal) {
    await Deal.findOneAndUpdate(
      { _id: openDeal._id, tenant_id: String(ctx.tenantId) },
      {
        $set:  { stage: PIPELINE_STAGE_ON_QUALIFY },
        $push: {
          stageHistory: {
            stage:   PIPELINE_STAGE_ON_QUALIFY,
            movedAt: new Date(),
            movedBy: ctx.userId,
          },
        },
      }
    );
  }

  // ── 4. Mark qualification applied ─────────────────────────────────────────
  const updated = await qualRepo.updateById(String(ctx.tenantId), qualificationId, {
    applied:    true,
    applied_at: new Date(),
    applied_by: ctx.userId,
    updated_by: ctx.userId,
  });

  // ── 5. Log to lead activity timeline ──────────────────────────────────────
  // ACTIVITY_TYPE.LEAD_QUALIFIED = 'Lead Qualified' — exists in activity.model.js
  await logActivity(
    ctx,
    leadId,
    ACTIVITY_TYPE.AI_QUALIFIED,
    `AI Qualification applied — Score: ${score}/10, Temperature: ${temp}, Quality: ${qualification.quality}`,
    {
      qualification_id: String(qualificationId),
      fit_score:        score,
      temperature:      temp,
      quality:          qualification.quality,
      suggested_route:  qualification.suggested_route,
    }
  );

  // ── 6. Hot lead notification ───────────────────────────────────────────────
  // SOURCE: DEVELOPER_HANDOFF.md "(if Hot) notify"
  // SOURCE: FRONTEND_SPEC §6 "(if hot) a notification"
  if (temp === LEAD_TEMPERATURE.HOT) {
    await createNotification(
      String(ctx.tenantId),
      qualification.answered_by || ctx.userId,
      '🔥 Hot Lead Qualified',
      `${updatedLead.name || updatedLead.email} scored ${score}/10 — recommended action: ${qualification.next_action}`,
      {
        qualification_id: String(qualificationId),
        lead_id:          String(leadId),
        fit_score:        score,
        temperature:      temp,
      }
    );
  }

  // ── 7. Emit tracking event 'AI Qualified' ─────────────────────────────────
  // SOURCE: MASTER_SPEC §I2 TrackingEventType — 'AI Qualified'
  // SOURCE: DEVELOPER_HANDOFF.md qualifyLead → "track('AI Qualified')"
  emitTrackingEvent(TRACKING_EVENT_ON_QUALIFY, leadId, ctx.tenantId, {
    qualification_id: String(qualificationId),
    fit_score:        score,
    temperature:      temp,
  });

  // Real Automation Rules dispatch for LEAD_QUALIFIED -- same
  // previously-idle dispatch() as LEAD_CREATED/MESSAGE_RECEIVED.
  // leadId here may be a populated Document (see the comment below on
  // String(leadId) for why) -- normalize to a plain id string.
  automationRulesService
    .dispatch(ctx, AUTOMATION_TRIGGER_TYPE.LEAD_QUALIFIED, {
      leadId: String(leadId._id || leadId),
      lead: updatedLead,
    })
    .catch((err) => {
      console.warn(`[automation] LEAD_QUALIFIED dispatch failed for lead ${leadId}: ${err.message}`);
    });

  // ── 7b. Real pause-on-qualified ─────────────────────────────────────────────
  // A lead becoming qualified means they've moved to a different funnel
  // stage -- their OTHER, unrelated active nurture enrollments should
  // pause, regardless of which temperature they landed at (Hot leads
  // get a direct notification above, not silence -- they shouldn't also
  // keep receiving an unrelated drip sequence). Placed BEFORE step 8's
  // auto-enroll so the newly-created enrollment (if any) is never
  // accidentally paused by this same qualification event -- it doesn't
  // exist yet at this point. Best-effort: must never fail the
  // qualification apply itself.
  await NurtureEnrollment.updateMany(
    { tenantId: String(ctx.tenantId), leadId, status: ENROLLMENT_STATUS.ACTIVE },
    {
      $set: { status: ENROLLMENT_STATUS.PAUSED, pauseReason: 'QUALIFIED', nextExecutionAt: null },
      $push: { auditLog: { action: 'PAUSE', performedAt: new Date(), note: `Lead qualified (${temp})` } },
    },
  ).catch((err) => {
    console.error('[nurture] failed to pause enrollments on qualification for lead', String(leadId), err);
  });

  // ── 8. Real auto-enroll into nurture for Cold/Warm leads ───────────────────
  // Only Cold/Warm, per the actual request -- Hot leads get a direct
  // notification above, not an automated drip sequence. Finds a real,
  // tenant-configured ACTIVE sequence declaring itself as the handler
  // for this exact temperature (see nurtures.model.js's
  // qualificationTemperature field) -- there is no hardcoded "Cold
  // always goes to X sequence" rule, since spec never specifies one;
  // this is a real tenant choice made through the sequence builder.
  // Reuses enrollLead() entirely -- its own real duplicate-enrollment
  // prevention applies here exactly as it does for manual enrollment,
  // not reimplemented.
  if (temp === LEAD_TEMPERATURE.COLD || temp === LEAD_TEMPERATURE.WARM) {
    try {
      const matchingSequence = await NurtureSequence.findOne({
        tenantId: ctx.tenantId,
        status: SEQUENCE_STATUS.ACTIVE,
        triggerType: TRIGGER_TYPE.LEAD_QUALIFIED,
        qualificationTemperature: temp,
      });
      if (matchingSequence) {
        // leadId here is qualification.lead_id -- populated into a full Lead
        // document by qualRepo.findById()'s .populate('lead_id', ...), not a
        // raw ObjectId. Every other use of leadId in this function passes it
        // through unstringified (Mongoose's own query/create casting handles
        // a populated Document correctly for an ObjectId-typed field/filter),
        // but String(leadId) does NOT -- Document has no custom toString(),
        // so String() on it produces the literal string "[object Object]",
        // which is what was actually reaching enrollLead() and failing
        // "Cast to ObjectId failed". Extract the real id first.
        await nurturesService.enrollLead(ctx, String(matchingSequence._id), { leadId: String(leadId._id || leadId) });
      }
    } catch (err) {
      // Real, but non-fatal -- e.g. the lead is already enrolled (real
      // duplicate-prevention inside enrollLead correctly rejects that).
      // Qualification itself must not fail because of this.
      console.warn(`[qualification] auto-enroll into nurture failed for lead ${leadId}: ${err.message}`);
    }
  }

  return { qualification: updated, lead: updatedLead };
};

// =============================================================================
// OPERATION 3 — OVERRIDE SCORE
// =============================================================================

/**
 * overrideScore — human manually adjusts the AI-generated score.
 *
 * SOURCE: FRONTEND_SPEC §6 "Human override supported"
 *
 * STEPS:
 *   1. Load qualification record
 *   2. Recalculate temperature from override_score using temperatureFor()
 *   3. Save override fields on qualification record
 *   4. Update lead qualification_score + lead_temperature immediately
 *   5. Log override to activity timeline
 *
 * @param {string} qualificationId
 * @param {number} overrideScore  — 0–10
 * @param {Object} reqUser
 */
export const overrideScore = async (qualificationId, overrideScore, reqUser) => {
  const ctx = buildCtx(reqUser);

  // ── 1. Load qualification ─────────────────────────────────────────────────
  const qualification = await qualRepo.findById(String(ctx.tenantId), qualificationId);
  if (!qualification) throw AppError.notFound('Qualification not found');

  const previousScore = qualification.override_score ?? qualification.fit_score;

  // ── 2. Recalculate temperature from override score ────────────────────────
  // Uses the existing temperatureFor() from scoring.service.js
  const newTemperature = temperatureFor(overrideScore);

  // ── 3. Save override on qualification ────────────────────────────────────
  const updated = await qualRepo.updateById(String(ctx.tenantId), qualificationId, {
    override_score: overrideScore,
    override_at:    new Date(),
    override_by:    ctx.userId,
    temperature:    newTemperature,
    updated_by:     ctx.userId,
  });

  // ── 4. Update lead score + temperature if already applied ─────────────────
  if (qualification.applied) {
    await Lead.findOneAndUpdate(
      { _id: qualification.lead_id, tenant_id: String(ctx.tenantId) },
      {
        $set: {
          qualification_score: overrideScore,
          lead_temperature:    newTemperature,
        },
      }
    );
  }

  // ── 5. Log override to activity timeline ──────────────────────────────────
  await logActivity(
    ctx,
    qualification.lead_id,
    ACTIVITY_TYPE.LEAD_UPDATED,
    `AI score overridden from ${previousScore}/10 to ${overrideScore}/10. New temperature: ${newTemperature}`,
    {
      qualification_id: String(qualificationId),
      previous_score:   previousScore,
      override_score:   overrideScore,
      new_temperature:  newTemperature,
    }
  );

  return updated;
};