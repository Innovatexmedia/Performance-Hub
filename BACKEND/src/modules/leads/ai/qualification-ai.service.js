/**
 * AI Qualification Service — Gemini powered.
 *
 * FILE: src/modules/leads/ai/qualification-ai.service.js
 *
 * WHAT CHANGED:
 *   - assess() is now async — calls Google Gemini API when GEMINI_API_KEY is set
 *   - Falls back to deterministic mock when key is missing (app never breaks)
 *   - Uses gemini-3.5-flash-lite model — fast, cheap, accurate for structured JSON
 *   - Returns same shape as before — all callers unchanged
 *
 * ENV REQUIRED:
 *   GEMINI_API_KEY — from https://aistudio.google.com/app/apikey
 *
 * CALLER:
 *   qualification.service.js → runQualification() calls:
 *   const assessment = await qualificationAiService.assess(lead, answers)
 *   NOTE: caller must now use await (was sync before)
 */

import { scoreLead, temperatureFor } from '../scoring/scoring.service.js';
import { LEAD_TEMPERATURE } from '../lead/lead.constants.js';

const GEMINI_API_KEY = () => process.env.GEMINI_API_KEY;
const isAiLive = () => Boolean(GEMINI_API_KEY());

// Gemini API endpoint -- real model id, matches aiReplyAssistant.service.js's
// GEMINI_MODEL, the currently-supported Gemini model already in real use
// elsewhere in this codebase. gemini-1.5-flash returns 404 on the current API.
const GEMINI_URL = () =>
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${GEMINI_API_KEY()}`;

// =============================================================================
// GEMINI API CALL
// =============================================================================

const callGemini = async (prompt) => {
  const response = await fetch(GEMINI_URL(), {
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
   * @param {Object} lead    — lead document as plain object
   * @param {Object} answers — discovery form answers
   * @returns {Promise<{fitScore, temperature, quality, buyingIntent, urgency,
   *                    painPoints, recommendedOffer, nextAction, followUpDraft,
   *                    reason, isLive}>}
   */
  async assess(lead = {}, answers = {}) {
    // Use mock if no API key set
    if (!isAiLive()) {
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
      const result = await callGemini(prompt);

      // Validate required fields — fall back to mock if Gemini returns bad JSON
      if (typeof result.fitScore !== 'number') throw new Error('Invalid fitScore from Gemini');

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
      console.warn(`[qualification-ai] Gemini failed, using mock fallback: ${err.message}`);
      return { ...mockAssess(lead, answers), isLive: false };
    }
  },
};