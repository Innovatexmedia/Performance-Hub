/**
 * Call Intelligence Service — multi-provider (Gemini / OpenAI / Claude).
 *
 * FILE: src/modules/calls/call.service.js
 *
 * WHAT CHANGED:
 *   - generateAiSummary now goes through the shared
 *     resolveActiveAiProvider() (see integrations/aiProviderClient.js)
 *     instead of being hardcoded to Gemini only -- a tenant "chooses" the
 *     provider simply by connecting it (with a real, verified key) on
 *     the Integrations page; whoever was most recently connected/
 *     re-verified wins if more than one is connected.
 *   - Falls back to deterministic mock ONLY when no provider is
 *     available anywhere or there's no real transcript to analyse.
 *   - Once a provider IS resolved but the real API call fails, this now
 *     throws a real error instead of silently degrading to mock -- a
 *     configured key that stops working shouldn't look identical to
 *     normal mock mode.
 *   - All other logic (lead update, deal advance, activity, notification) unchanged.
 */

import * as callRepo from './call.repository.js';
import {
  CALL_OUTCOME,
  PIPELINE_STAGE_ON_CALL,
  LEAD_STATUS_ON_CALL,
  TRACKING_EVENT_ON_CALL,
} from './call.constants.js';

import { Lead }          from '../leads/lead/lead.model.js';
import { Deal }          from '../pipeline/deals/deal.model.js';
import { ACTIVITY_TYPE } from '../leads/activities/activity.model.js';
import { activityService } from '../leads/activities/activity.service.js';
import Notification      from '../leads/notifications/notification.model.js';
import { AppError, paginationMeta } from '../../shared/helpers/lead.helpers.js';
import { resolveActiveAiProvider, callProviderJSON } from '../integrations/aiProviderClient.js';

// =============================================================================
// PRIVATE HELPERS
// =============================================================================

const buildCtx = (reqUser) => ({
  tenantId: reqUser.tenantId,
  userId:   reqUser.sub,
  role:     reqUser.role,
});

const logActivity = async (ctx, leadId, type, message, meta = {}) => {
  try {
    await activityService.log(ctx, leadId, type, { message, meta });
  } catch (err) {
    console.warn(`[calls] activity log failed for lead ${leadId}: ${err.message}`);
  }
};

const createNotification = async (tenantId, userId, title, body, metadata = {}) => {
  try {
    if (!userId) return;
    await Notification.create({ tenantId, userId, title, body, isRead: false, metadata });
  } catch (err) {
    console.warn(`[calls] notification failed: ${err.message}`);
  }
};

// Attribution tracking service
import { createTrackingEvent } from '../attribution/attribution.service.js';

const emitTrackingEvent = async (eventType, leadId, tenantId, metadata = {}) => {
  await createTrackingEvent({ tenant_id: tenantId, event_type: eventType, lead_id: leadId, ...metadata }).catch(() => {});
};

// =============================================================================
// GEMINI API CALL
// =============================================================================

// =============================================================================
// MOCK FALLBACK
// =============================================================================

const mockSummary = (lead, outcome) => {
  const name    = lead?.name || 'the lead';
  const company = lead?.company || '';

  const summary = `${name}${company ? ` from ${company}` : ''} is experiencing slow lead follow-up causing pipeline leakage. Strong fit for AI qualification + WhatsApp automation. Budget sensitivity noted during the call.`;

  const objections = [
    'Pricing concern',
    'Needs co-founder buy-in',
    outcome === CALL_OUTCOME.NEEDS_FOLLOW_UP
      ? 'Timing — busy quarter'
      : 'Already evaluating a competitor',
  ];

  const next_steps = [
    'Send a proposal within 24 hours',
    'Follow up with pricing breakdown',
    'Schedule a demo with the technical team',
  ];

  const follow_up_draft = `Hi ${name}, thanks for the call today. Based on our conversation, I'll send over a detailed proposal that addresses the points we discussed. Looking forward to moving this forward!`;

  const proposal_outline = outcome === CALL_OUTCOME.PROPOSAL_REQUESTED
    ? `Proposal for ${name}:\n1. Problem: Pipeline leakage from slow follow-up\n2. Solution: InnovateX AI qualification + WhatsApp automation\n3. Investment: Custom pricing based on team size\n4. Timeline: 2-week onboarding`
    : '';

  const scoreMap = {
    [CALL_OUTCOME.INTERESTED]:         8,
    [CALL_OUTCOME.CLOSED_WON]:         9,
    [CALL_OUTCOME.PROPOSAL_REQUESTED]: 7,
    [CALL_OUTCOME.NEEDS_FOLLOW_UP]:    6,
    [CALL_OUTCOME.NO_SHOW]:            3,
    [CALL_OUTCOME.NOT_INTERESTED]:     4,
    [CALL_OUTCOME.CLOSED_LOST]:        2,
  };
  const score = scoreMap[outcome] || 5;

  return { summary, objections, next_steps, follow_up_draft, proposal_outline, score, isAiLive: false, provider: null };
};

// =============================================================================
// MAIN AI SUMMARY FUNCTION — Gemini, OpenAI, Claude, or mock
// =============================================================================

/**
 * generateAiSummary — generates call summary using whichever AI provider
 * this tenant has connected (see aiProviderClient.js's
 * resolveActiveAiProvider). Falls back to mock when no provider resolves
 * or transcript is empty. Once a provider IS resolved but the real call
 * fails, this throws a real error instead of silently degrading to mock.
 */
const generateAiSummary = async (ctx, lead, transcript, outcome) => {
  const { provider, apiKey } = await resolveActiveAiProvider(ctx?.tenantId);
  const hasTranscript  = transcript && transcript.trim().length > 10;

  if (!provider || !apiKey || !hasTranscript) {
    return mockSummary(lead, outcome);
  }

  const prompt = `You are an expert sales call analyst for InnovateX Revenue OS.

Analyse this sales call and return ONLY a valid JSON object with NO markdown:

LEAD: ${lead?.name || 'Unknown'} from ${lead?.company || 'Unknown'}
OUTCOME: ${outcome}
TRANSCRIPT:
${transcript}

Return this exact JSON structure:
{
  "summary": "<2-3 sentence summary of the key points discussed>",
  "objections": ["<objection 1>", "<objection 2>", "<objection 3>"],
  "next_steps": ["<step 1>", "<step 2>", "<step 3>"],
  "follow_up_draft": "<ready-to-send follow-up message personalised to this call>",
  "proposal_outline": "<if outcome is Proposal Requested: outline the proposal, else empty string>",
  "score": <integer 1-10 call quality score>
}

Scoring guide for score field:
- 8-10: Excellent call, clear next steps, strong engagement
- 5-7:  Good call, some unclear areas, moderate engagement  
- 1-4:  Poor call, objections unresolved, low engagement or no-show`;

  try {
    const result = await callProviderJSON(provider, apiKey, prompt);

    if (!result.summary) throw new Error(`Invalid response from ${provider}`);

    return {
      summary:          result.summary          || '',
      objections:       Array.isArray(result.objections)  ? result.objections  : [],
      next_steps:       Array.isArray(result.next_steps)  ? result.next_steps  : [],
      follow_up_draft:  result.follow_up_draft  || '',
      proposal_outline: result.proposal_outline || '',
      score:            Math.max(1, Math.min(10, Math.round(Number(result.score) || 5))),
      isAiLive:         true,
      provider,
    };
  } catch (err) {
    console.error(`[calls] ${provider} request failed for a configured key: ${err.message}`);
    throw new AppError(502, `Call Intelligence AI summary failed (${provider}): ${err.message}`);
  }
};

// =============================================================================
// GET CALLS
// =============================================================================

export const getCalls = async (tenantId, filter = {}, options = {}) => {
  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  const [calls, total] = await Promise.all([
    callRepo.findByTenantId(tenantId, filter, { skip, limit }),
    callRepo.countByTenantId(tenantId, filter),
  ]);

  return { calls, pagination: paginationMeta({ page, limit, total }) };
};

// =============================================================================
// GET SINGLE CALL
// =============================================================================

export const getCallById = async (tenantId, id) => {
  const call = await callRepo.findById(tenantId, id);
  if (!call) throw AppError.notFound('Call not found');
  return call;
};

// =============================================================================
// GET KPI SUMMARY
// =============================================================================

export const getKpiSummary = (tenantId) => callRepo.getKpiCounts(tenantId);

// =============================================================================
// COUNT / GET BY LEAD
// =============================================================================

export const countCallsByLead = (tenantId, leadId) =>
  callRepo.countByLead(tenantId, leadId);

export const getCallsByLead = (tenantId, leadId) =>
  callRepo.findByLead(tenantId, leadId);

// =============================================================================
// CREATE CALL
// =============================================================================

export const createCall = async (data, reqUser) => {
  const ctx = buildCtx(reqUser);

  // 1. Verify lead
  const lead = await Lead.findOne({
    _id:       data.lead_id,
    tenant_id: String(ctx.tenantId),
    archived:  false,
  });
  if (!lead) throw AppError.notFound('Lead not found in this workspace');

  // 2. Generate AI summary (Gemini or mock)
  const aiResult = await generateAiSummary(ctx, lead, data.transcript || '', data.outcome);

  // 3. Create call document
  const call = await callRepo.create({
    tenant_id:        String(ctx.tenantId),
    lead_id:          data.lead_id,
    assigned_user_id: data.assigned_user_id || null,
    outcome:          data.outcome,
    call_date:        data.call_date,
    duration_minutes: data.duration_minutes || 0,
    transcript:       data.transcript       || '',
    source:           lead.source           || null,
    campaign:         lead.campaign         || null,
    summary:          aiResult.summary,
    objections:       aiResult.objections,
    next_steps:       aiResult.next_steps,
    follow_up_draft:  aiResult.follow_up_draft,
    proposal_outline: aiResult.proposal_outline,
    score:            aiResult.score,
    ai_generated:     true,
    created_by:       ctx.userId,
  });

  // 4. Update lead status
  await Lead.findOneAndUpdate(
    { _id: data.lead_id, tenant_id: String(ctx.tenantId) },
    { $set: { status: LEAD_STATUS_ON_CALL } }
  );

  // 5. Advance pipeline deal
  const openDeal = await Deal.findOne({
    tenant_id: String(ctx.tenantId),
    lead_id:   data.lead_id,
    archived:  false,
    stage:     { $nin: ['Won', 'Lost'] },
  }).sort({ created_at: -1 });

  let deal = null;

  if (openDeal) {
    deal = await Deal.findOneAndUpdate(
      { _id: openDeal._id, tenant_id: String(ctx.tenantId) },
      {
        $set:  { stage: PIPELINE_STAGE_ON_CALL },
        $push: {
          stageHistory: {
            stage:   PIPELINE_STAGE_ON_CALL,
            movedAt: new Date(),
            movedBy: ctx.userId,
          },
        },
      },
      { new: true }
    );
  } else {
    deal = await Deal.create({
      tenant_id:        String(ctx.tenantId),
      lead_id:          data.lead_id,
      assigned_user_id: data.assigned_user_id || null,
      title:            `${lead.name || lead.email || 'Lead'} — Call`,
      stage:            PIPELINE_STAGE_ON_CALL,
      probability:      55,
      source:           lead.source || null,
      value:            0,
      stageHistory: [{
        stage:   PIPELINE_STAGE_ON_CALL,
        movedAt: new Date(),
        movedBy: ctx.userId,
      }],
    });
  }

  // 6. Link deal to call
  if (deal) {
    await callRepo.updateById(String(ctx.tenantId), call._id, { deal_id: deal._id });
  }

  // 7. Activity log
  await logActivity(
    ctx,
    data.lead_id,
    ACTIVITY_TYPE.CALL_COMPLETED,
    `Call logged — outcome: ${data.outcome}. Score: ${aiResult.score}/10`,
    { call_id: String(call._id), outcome: data.outcome, call_date: data.call_date, score: aiResult.score }
  );

  // 8. Notification
  await createNotification(
    String(ctx.tenantId),
    data.assigned_user_id,
    'Call Logged',
    `Call with ${lead.name || lead.email} logged — ${data.outcome}. Score: ${aiResult.score}/10`,
    { call_id: String(call._id), lead_id: String(data.lead_id), outcome: data.outcome }
  );

  // 9. Tracking event
  emitTrackingEvent(TRACKING_EVENT_ON_CALL, data.lead_id, ctx.tenantId, {
    call_id: String(call._id),
    outcome: data.outcome,
    score:   aiResult.score,
  });

  return call;
};

// =============================================================================
// UPDATE CALL
// =============================================================================

/**
 * ALLOWED_UPDATE_FIELDS -- real, explicit whitelist for PATCH /api/calls/:id.
 *
 * CRITICAL FIX (confirmed via production audit): updateCall previously
 * spread the ENTIRE raw request body straight into a MongoDB $set with
 * no field restriction -- express-validator's validateUpdateCall only
 * checks the SHAPE of named fields IF present, it does not strip or
 * reject any additional, unlisted fields from req.body. Combined with
 * callRepo.updateById's own `{ $set: patch }` (also unrestricted), any
 * authenticated sales_user could include extra fields in their request
 * body -- including tenant_id itself -- and have them written directly
 * to the document. The query filter only controls WHICH document gets
 * matched; it does not restrict what a $set payload can contain, so a
 * crafted tenant_id in the body could genuinely move a call record to a
 * different tenant. Whitelisted to exactly the fields
 * validateUpdateCall already legitimately validates -- closing the gap
 * between "what the validator checks the shape of" and "what actually
 * reaches the database", rather than inventing a new, separate set of
 * allowed fields.
 */
const ALLOWED_UPDATE_FIELDS = ['outcome', 'call_date', 'duration_minutes', 'transcript', 'summary', 'score'];

export const updateCall = async (tenantId, id, patch, reqUser) => {
  const ctx = buildCtx(reqUser);
  const call = await callRepo.findById(tenantId, id);
  if (!call) throw AppError.notFound('Call not found');

  const safePatch = {};
  for (const key of ALLOWED_UPDATE_FIELDS) {
    if (patch[key] !== undefined) safePatch[key] = patch[key];
  }

  return callRepo.updateById(tenantId, id, { ...safePatch, updated_by: ctx.userId });
};

// =============================================================================
// REGENERATE AI SUMMARY
// =============================================================================

export const regenerateAiSummary = async (tenantId, id, reqUser) => {
  const ctx = buildCtx(reqUser);

  const call = await callRepo.findById(tenantId, id);
  if (!call) throw AppError.notFound('Call not found');

  const lead = await Lead.findOne({
    _id:       call.lead_id,
    tenant_id: String(tenantId),
  });

  // Use current transcript from DB for regeneration
  const aiResult = await generateAiSummary(ctx, lead, call.transcript || '', call.outcome);

  return callRepo.updateById(tenantId, id, {
    summary:          aiResult.summary,
    objections:       aiResult.objections,
    next_steps:       aiResult.next_steps,
    follow_up_draft:  aiResult.follow_up_draft,
    proposal_outline: aiResult.proposal_outline,
    score:            aiResult.score,
    ai_generated:     true,
    updated_by:       ctx.userId,
  });
};