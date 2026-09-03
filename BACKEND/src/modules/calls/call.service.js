/**
 * Call Intelligence Service — Gemini powered.
 *
 * FILE: src/modules/calls/call.service.js
 *
 * WHAT CHANGED:
 *   - generateAiSummaryMock renamed to generateAiSummary (now async)
 *   - When a usable Gemini key is available → calls Gemini API with real transcript
 *   - Falls back to deterministic mock when key missing or transcript empty
 *   - All other logic (lead update, deal advance, activity, notification) unchanged
 *
 * BUG FIX: credential resolution now matches the established, real
 * per-tenant pattern already used by aiReplyAssistant.service.js --
 * the tenant's OWN connected Gemini key (Integrations -> Google Gemini)
 * is tried first, falling back to the server-wide GEMINI_API_KEY env var
 * only if the tenant hasn't connected their own. Previously this only
 * ever read the server-wide env var, so a tenant's own connected key was
 * silently ignored for Call Intelligence specifically, even though it
 * already worked for AI Reply Assistant.
 */

import * as callRepo from './call.repository.js';
import {
  CALL_OUTCOME,
  PIPELINE_STAGE_ON_CALL,
  LEAD_STATUS_ON_CALL,
  TRACKING_EVENT_ON_CALL,
  AI_API_KEY_ENV,
} from './call.constants.js';

import { Lead }          from '../leads/lead/lead.model.js';
import { Deal }          from '../pipeline/deals/deal.model.js';
import { ACTIVITY_TYPE } from '../leads/activities/activity.model.js';
import { activityService } from '../leads/activities/activity.service.js';
import Notification      from '../leads/notifications/notification.model.js';
import { AppError, paginationMeta } from '../../shared/helpers/lead.helpers.js';
import { findByKey as findIntegrationByKey } from '../integrations/integration.repository.js';

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

const SERVER_GEMINI_API_KEY = () => process.env.GEMINI_API_KEY || process.env[AI_API_KEY_ENV];

/**
 * resolveGeminiApiKey -- BUG FIX: same real pattern as
 * aiReplyAssistant.service.js's resolveGeminiApiKey. Tries the tenant's
 * own connected key first (Integrations -> Google Gemini,
 * config.api_key, only when status === 'connected'), falls back to the
 * server-wide env var. Never throws -- a DB hiccup looking up the
 * integration falls through to the server key rather than failing the
 * whole call-logging request.
 */
const resolveGeminiApiKey = async (ctx) => {
  try {
    const integration = ctx?.tenantId ? await findIntegrationByKey(ctx.tenantId, 'gemini') : null;
    const tenantKey = integration?.config?.api_key;
    if (integration?.status === 'connected' && typeof tenantKey === 'string' && tenantKey.trim()) {
      return tenantKey.trim();
    }
  } catch {
    // DB hiccup looking up the integration -- fall through to the server key.
  }
  return SERVER_GEMINI_API_KEY() || null;
};

const GEMINI_URL = (apiKey) =>
  // Real model id -- matches aiReplyAssistant.service.js's GEMINI_MODEL,
  // the currently-supported Gemini model already in real use elsewhere
  // in this codebase. gemini-1.5-flash returns 404 on the current API.
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`;

const callGemini = async (prompt, apiKey) => {
  const response = await fetch(GEMINI_URL(apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty response');

  // Strip markdown code fences if present
  const clean = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(clean);
};

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

  return { summary, objections, next_steps, follow_up_draft, proposal_outline, score, isAiLive: false };
};

// =============================================================================
// MAIN AI SUMMARY FUNCTION — Gemini or mock
// =============================================================================

/**
 * generateAiSummary — generates call summary using Gemini when a usable
 * key is available (tenant's own connected key, or server fallback).
 * Falls back to mock when no key resolves or transcript is empty.
 * NOW ASYNC — all callers use await, and now take `ctx` to resolve the
 * right tenant's credentials.
 */
const generateAiSummary = async (ctx, lead, transcript, outcome) => {
  const apiKey         = await resolveGeminiApiKey(ctx);
  const hasTranscript  = transcript && transcript.trim().length > 10;

  // Use mock if no usable key or no real transcript to analyse
  if (!apiKey || !hasTranscript) {
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
    const result = await callGemini(prompt, apiKey);

    if (!result.summary) throw new Error('Invalid response from Gemini');

    return {
      summary:          result.summary          || '',
      objections:       Array.isArray(result.objections)  ? result.objections  : [],
      next_steps:       Array.isArray(result.next_steps)  ? result.next_steps  : [],
      follow_up_draft:  result.follow_up_draft  || '',
      proposal_outline: result.proposal_outline || '',
      score:            Math.max(1, Math.min(10, Math.round(Number(result.score) || 5))),
      isAiLive:         true,
    };
  } catch (err) {
    console.warn(`[calls] Gemini failed, using mock fallback: ${err.message}`);
    return mockSummary(lead, outcome);
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

export const updateCall = async (tenantId, id, patch, reqUser) => {
  const ctx = buildCtx(reqUser);
  const call = await callRepo.findById(tenantId, id);
  if (!call) throw AppError.notFound('Call not found');
  return callRepo.updateById(tenantId, id, { ...patch, updated_by: ctx.userId });
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