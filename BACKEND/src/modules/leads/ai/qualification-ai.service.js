/**
 * AI Qualification Service — multi-provider (Gemini / OpenAI / Claude).
 *
 * FILE: src/modules/leads/ai/qualification-ai.service.js
 *
 * WHAT CHANGED:
 *   - assess() now goes through the shared resolveActiveAiProvider() (see
 *     integrations/aiProviderClient.js) instead of being hardcoded to
 *     Gemini only. A tenant "chooses" the provider simply by connecting
 *     it (with a real, verified key) on the Integrations page -- whoever
 *     was most recently connected/re-verified wins if more than one is
 *     connected. Only Gemini has a platform-wide fallback
 *     (process.env.GEMINI_API_KEY); OpenAI/Claude are BYO-key only.
 *   - Falls back to deterministic mock ONLY when no key is available
 *     anywhere -- this is the original, intentional "Mock AI" demo mode,
 *     not an error state.
 *   - Once a key IS available but the real API call fails, this throws a
 *     real error instead of silently degrading to a mock result -- a
 *     configured key that stops working should never look identical to
 *     normal mock mode.
 *   - Returns the same shape as before — all callers unchanged.
 *
 * CALLER:
 *   qualification.service.js → runQualification() calls:
 *   const assessment = await qualificationAiService.assess(lead, answers, ctx.tenantId)
 */

import { scoreLead, temperatureFor } from '../scoring/scoring.service.js';
import { LEAD_TEMPERATURE } from '../lead/lead.constants.js';
import { resolveActiveAiProvider, callProviderJSON } from '../../integrations/aiProviderClient.js';
import { AppError } from '../../../shared/helpers/lead.helpers.js';

// =============================================================================
// MOCK FALLBACK (used when no AI provider is configured anywhere)
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
    provider: null,
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
   * @param {Object} lead     — lead document as plain object
   * @param {Object} answers  — discovery form answers
   * @param {string} tenantId — used to resolve which AI provider (if any)
   *                            this tenant has connected. Optional --
   *                            omitting it just skips straight to the
   *                            platform Gemini fallback (or mock).
   * @returns {Promise<{fitScore, temperature, quality, buyingIntent, urgency,
   *                    painPoints, recommendedOffer, nextAction, followUpDraft,
   *                    reason, isLive, provider}>}
   */
  async assess(lead = {}, answers = {}, tenantId = null) {
    const { provider, apiKey } = await resolveActiveAiProvider(tenantId);

    if (!provider || !apiKey) {
      return mockAssess(lead, answers);
    }

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
      const result = await callProviderJSON(provider, apiKey, prompt);

      if (typeof result.fitScore !== 'number') throw new Error(`${provider} returned an invalid response shape (missing/non-numeric fitScore)`);

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
        provider,
      };
    } catch (err) {
      console.error(`[qualification-ai] ${provider} request failed for a configured key: ${err.message}`);
      throw new AppError(502, `AI Qualification failed (${provider}): ${err.message}`);
    }
  },
};
