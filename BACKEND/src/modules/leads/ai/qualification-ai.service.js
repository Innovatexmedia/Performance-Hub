/**
 * AI Qualification Service — Gemini powered.
 *
 * FILE: src/modules/leads/ai/qualification-ai.service.js
 *
 * WHAT CHANGED:
 *   - assess() is now async — calls Google Gemini API when a key is available
 *   - BUG FIX: now tries the tenant's own connected Gemini key
 *     (Integrations -> Google Gemini) first, falling back to the
 *     server-wide GEMINI_API_KEY env var -- previously this always read
 *     only the server-wide env var, unlike Call Intelligence and AI
 *     Reply Assistant, which both already resolved the tenant's own key.
 *   - Falls back to deterministic mock when no key is available at all (app never breaks)
 *   - Uses gemini-3.5-flash-lite model — fast, cheap, accurate for structured JSON
 *   - Returns same shape as before — all callers unchanged
 *
 * ENV REQUIRED (server-wide fallback only):
 *   GEMINI_API_KEY — from https://aistudio.google.com/app/apikey
 *
 * CALLER:
 *   qualification.service.js → runQualification() calls:
 *   const assessment = await qualificationAiService.assess(lead, answers, ctx.tenantId)
 *   NOTE: caller must now use await (was sync before); tenantId is optional
 *   (omitting it just skips straight to the server-wide key, same as before).
 */

import { scoreLead, temperatureFor } from '../scoring/scoring.service.js';
import { LEAD_TEMPERATURE } from '../lead/lead.constants.js';
import { findByKey as findIntegrationByKey } from '../../integrations/integration.repository.js';
import { AppError } from '../../../shared/helpers/lead.helpers.js';

const SERVER_GEMINI_API_KEY = () => process.env.GEMINI_API_KEY;

/**
 * resolveGeminiApiKey -- BUG FIX: this module previously only ever read
 * the server-wide GEMINI_API_KEY env var, silently ignoring a tenant's
 * own connected Gemini key even when one existed -- unlike Call
 * Intelligence and AI Reply Assistant, which both already resolve the
 * tenant's own key first. Same real pattern as
 * calls/call.service.js's resolveGeminiApiKey: tries the tenant's own
 * connected integration (Integrations -> Google Gemini,
 * config.api_key, only when status === 'connected') first, falls back
 * to the server-wide env var. Never throws -- a DB hiccup looking up
 * the integration falls through to the server key rather than failing
 * the whole qualification request.
 */
const resolveGeminiApiKey = async (tenantId) => {
  try {
    const integration = tenantId ? await findIntegrationByKey(tenantId, 'gemini') : null;
    const tenantKey = integration?.config?.api_key;
    if (integration?.status === 'connected' && typeof tenantKey === 'string' && tenantKey.trim()) {
      return tenantKey.trim();
    }
  } catch {
    // DB hiccup looking up the integration -- fall through to the server key.
  }
  return SERVER_GEMINI_API_KEY() || null;
};

// Gemini API endpoint -- real model id, matches aiReplyAssistant.service.js's
// GEMINI_MODEL, the currently-supported Gemini model already in real use
// elsewhere in this codebase. gemini-1.5-flash returns 404 on the current API.
const GEMINI_URL = (apiKey) =>
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`;

// =============================================================================
// GEMINI API CALL
// =============================================================================

const callGemini = async (prompt, apiKey) => {
  const response = await fetch(GEMINI_URL(apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }],
      }],
      generationConfig: {
        temperature:     0.3,   // Low temperature = consistent structured output
        maxOutputTokens: 1024,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty response');

  // Strip markdown code fences if Gemini wraps JSON in ```json ... ```
  const clean = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(clean);
};

// =============================================================================
// MOCK FALLBACK (used when no GEMINI_API_KEY)
// =============================================================================

const mockAssess = (lead = {}, answers = {}) => {
  const { score } = scoreLead(lead);

  let fit = score;
  if (answers.budget    === 'high')            fit += 2;
  if (answers.timeline  === 'immediate')        fit += 1;
  if (answers.authority === 'decision_maker')   fit += 1;
  fit = Math.max(0, Math.min(10, fit));

  const temperature  = temperatureFor(fit);
  const buyingIntent = answers.timeline === 'immediate'
    ? 'high' : answers.timeline === 'this_quarter' ? 'medium' : 'low';
  const urgency      = buyingIntent;
  const quality      = fit >= 8 ? 'A' : fit >= 5 ? 'B' : 'C';
  const painPoints   = [].concat(answers.pain_points || answers.challenge || []).filter(Boolean);

  return {
    fitScore:         fit,
    temperature,
    quality,
    buyingIntent,
    urgency,
    painPoints,
    recommendedOffer: temperature === LEAD_TEMPERATURE.HOT
      ? 'Premium / high-touch package'
      : 'Starter package or paid trial',
    nextAction: temperature === LEAD_TEMPERATURE.HOT
      ? 'Book a call within 24 hours'
      : 'Add to a nurture sequence',
    followUpDraft: buildFollowUp(lead, temperature),
    reason: 'Score computed from lead profile and discovery answers.',
    isLive: false,
  };
};

function buildFollowUp(lead, temperature) {
  const name = lead.name || 'there';
  if (temperature === LEAD_TEMPERATURE.HOT) {
    return `Hi ${name}, based on what you shared I think we can help quickly. Do you have 20 minutes this week for a quick call?`;
  }
  return `Hi ${name}, thanks for reaching out! I'll send over a few resources that match your goals and check back in soon.`;
}

// =============================================================================
// EXPORTED SERVICE
// =============================================================================

export const qualificationAiService = {

  /**
   * assess — runs AI qualification on a lead + discovery answers.
   *
   * NOW ASYNC — callers must await this.
   * Returns same shape as before so all downstream code is unchanged.
   *
   * @param {Object} lead     — lead document as plain object
   * @param {Object} answers  — discovery form answers
   * @param {string} tenantId — BUG FIX: now accepted so the tenant's own
   *                            connected Gemini key (if any) is tried
   *                            before falling back to the server-wide key.
   *                            Optional so any other, older caller that
   *                            doesn't pass it still works exactly as
   *                            before (falls straight to the server key).
   * @returns {Promise<{fitScore, temperature, quality, buyingIntent, urgency,
   *                    painPoints, recommendedOffer, nextAction, followUpDraft,
   *                    reason, isLive}>}
   */
  async assess(lead = {}, answers = {}, tenantId = null) {
    const apiKey = await resolveGeminiApiKey(tenantId);

    // Use mock if no key available at all (neither tenant's own nor server-wide)
    if (!apiKey) {
      return mockAssess(lead, answers);
    }

    // Build prompt for Gemini
    const prompt = `You are an expert B2B sales qualification analyst for InnovateX Revenue OS.

Analyse this lead profile and discovery answers to qualify the lead.

LEAD PROFILE:
- Name: ${lead.name || 'Unknown'}
- Company: ${lead.company || 'Unknown'}
- Email: ${lead.email || 'Unknown'}
- Source: ${lead.source || 'Unknown'}
- Current Status: ${lead.status || 'New'}
- Current Score: ${lead.qualification_score || 0}/10
- Temperature: ${lead.lead_temperature || 'Cold'}
- Notes: ${lead.notes || 'None'}

DISCOVERY ANSWERS:
${JSON.stringify(answers, null, 2)}

Based on the above, return ONLY a valid JSON object with NO markdown, no explanation, just JSON:
{
  "fitScore": <integer 0-10>,
  "temperature": <"Hot" | "Warm" | "Cold">,
  "quality": <"A" | "B" | "C">,
  "buyingIntent": <"high" | "medium" | "low">,
  "urgency": <"high" | "medium" | "low">,
  "painPoints": [<string>, ...],
  "recommendedOffer": "<one sentence offer recommendation>",
  "nextAction": "<one sentence next step>",
  "followUpDraft": "<ready-to-send WhatsApp/email follow-up message>",
  "reason": "<2-3 sentence explanation of the score>"
}

Scoring guide:
- 8-10 = Hot: Strong fit, high intent, decision maker, immediate timeline
- 5-7  = Warm: Moderate fit, some intent, needs nurturing  
- 0-4  = Cold: Poor fit, low intent, wrong authority or no budget`;

    try {
      const result = await callGemini(prompt, apiKey);

      // Validate required fields — a malformed/unexpected shape from
      // Gemini is treated the same as a request failure below, not a
      // silent mock fallback.
      if (typeof result.fitScore !== 'number') throw new Error('Gemini returned an invalid response shape (missing/non-numeric fitScore)');

      return {
        fitScore:         Math.max(0, Math.min(10, Math.round(result.fitScore))),
        temperature:      result.temperature      || temperatureFor(result.fitScore),
        quality:          result.quality          || (result.fitScore >= 8 ? 'A' : result.fitScore >= 5 ? 'B' : 'C'),
        buyingIntent:     result.buyingIntent     || 'medium',
        urgency:          result.urgency          || 'medium',
        painPoints:       Array.isArray(result.painPoints) ? result.painPoints : [],
        recommendedOffer: result.recommendedOffer || '',
        nextAction:       result.nextAction       || '',
        followUpDraft:    result.followUpDraft    || '',
        reason:           result.reason           || '',
        isLive:           true,
      };
    } catch (err) {
      // BUG FIX: previously swallowed every Gemini failure and silently
      // returned a mock/deterministic result with isLive:false -- a real,
      // configured key (tenant's own or the platform's) that started
      // failing (revoked, quota exceeded, model error, malformed
      // response) looked EXACTLY like a normal mock-mode result to the
      // end user, with no indication anything was actually wrong. Mock
      // mode is now reserved solely for "no key configured anywhere" (see
      // the isAiLive-equivalent check above, before this try block) --
      // once a key genuinely exists, a failure is a real, surfaced error
      // instead of a silently-degraded response.
      console.error(`[qualification-ai] Gemini request failed for a configured key: ${err.message}`);
      throw new AppError(502, `AI Qualification failed: ${err.message}`);
    }
  },
};