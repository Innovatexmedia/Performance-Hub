/**
 * =============================================================================
 * InnovateX Revenue OS — Shared AI Provider Client
 * =============================================================================
 *
 * FILE: src/modules/integrations/aiProviderClient.js
 *
 * Single, shared place for "which LLM provider/key does this tenant's
 * request actually use" and "how do we actually call each of the three
 * supported providers (Gemini / OpenAI / Claude)". Used by:
 *   - leads/ai/qualification-ai.service.js  (AI Qualification)
 *   - calls/call.service.js                 (Call Intelligence)
 *
 * aiReplyAssistant.service.js keeps its own per-action prompt-building
 * and provider wrapper functions (it already had working, separately
 * tuned Gemini/Claude prompts before this file existed) -- it only uses
 * resolveActiveAiProvider() from here for its own OpenAI addition, to
 * avoid three independently-drifting copies of "which key wins".
 *
 * PROVIDER SELECTION
 * ──────────────────
 * A tenant "chooses" a provider simply by connecting it (with a real,
 * verified key -- see integration.service.js's verifyGeminiApiKey /
 * verifyOpenAiApiKey / verifyClaudeApiKey) on the Integrations page --
 * no separate settings toggle needed. When more than one of
 * Gemini/OpenAI/Claude is genuinely connected for a tenant, whichever
 * was most recently connected or re-verified (`last_sync`) wins, so
 * connecting (or re-syncing) a different provider is what makes it "the"
 * active one for every AI feature going forward.
 *
 * Only Gemini has an optional platform-wide fallback
 * (process.env.GEMINI_API_KEY) if the tenant hasn't connected anything at
 * all. OpenAI/Claude have no platform-wide default, matching this app's
 * BYO-first design for AI credentials.
 */

import { findByKey as findIntegrationByKey } from './integration.repository.js';

const AI_KEYS = ['gemini', 'openai', 'claude'];

/**
 * resolveActiveAiProvider -- returns { provider, apiKey } for whichever
 * provider this tenant's request should actually use, or
 * { provider: null, apiKey: null } if nothing is available anywhere
 * (caller should fall back to its own deterministic mock in that case).
 * Never throws -- a DB hiccup looking up integrations falls through to
 * the platform fallback rather than failing the whole request.
 */
export const resolveActiveAiProvider = async (tenantId) => {
  if (tenantId) {
    try {
      const docs = await Promise.all(AI_KEYS.map((key) => findIntegrationByKey(tenantId, key)));
      const connected = docs
        .filter((doc) => doc?.status === 'connected' && typeof doc?.config?.api_key === 'string' && doc.config.api_key.trim())
        .sort((a, b) => new Date(b.last_sync || 0) - new Date(a.last_sync || 0));

      if (connected.length > 0) {
        const winner = connected[0];
        return { provider: winner.key, apiKey: winner.config.api_key.trim() };
      }
    } catch {
      // DB hiccup looking up integrations -- fall through to the platform fallback below.
    }
  }

  if (process.env.GEMINI_API_KEY) {
    return { provider: 'gemini', apiKey: process.env.GEMINI_API_KEY };
  }

  return { provider: null, apiKey: null };
};

// =============================================================================
// PER-PROVIDER REAL API CALLS
// =============================================================================

const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const OPENAI_MODEL = 'gpt-4.1-mini';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

async function callGemini(prompt, apiKey) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
      }),
    },
  );
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty response');
  return text.trim();
}

async function callOpenAi(prompt, apiKey) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1024,
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${err}`);
  }
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI returned empty response');
  return text.trim();
}

async function callClaude(prompt, apiKey) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }
  const data = await response.json();
  const text = data?.content?.[0]?.text;
  if (!text) throw new Error('Claude returned empty response');
  return text.trim();
}

const CALL_BY_PROVIDER = { gemini: callGemini, openai: callOpenAi, claude: callClaude };

export const callProviderText = (provider, apiKey, prompt) => {
  const fn = CALL_BY_PROVIDER[provider];
  if (!fn) throw new Error(`Unsupported AI provider: ${provider}`);
  return fn(prompt, apiKey);
};

export const callProviderJSON = async (provider, apiKey, prompt) => {
  const text = await callProviderText(provider, apiKey, prompt);
  const clean = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(clean);
};
