/**
 * WhatsApp AI Reply Assistant — service.
 *
 * Contains ALL business logic:
 *   • Prompt CRUD (create, read, list, update, soft-delete, duplicate, toggle)
 *   • AI generation via provider abstraction (MOCK → plug in OpenAI/Gemini/Claude)
 *   • Rewrite, summarise, suggestions
 *   • Variable replacement
 *   • Usage tracking
 *   • Save-as-template (delegates to templatesService)
 *   • Save-as-prompt
 *
 * Provider selection: set AI_PROVIDER env var to MOCK | OPENAI | GEMINI | CLAUDE.
 * Only MOCK is implemented here; the others follow the same interface.
 */
import { AppError } from '../../../../shared/helpers/lead.helpers.js';
import { aiReplyAssistantRepository } from './aiReplyAssistant.repository.js';
import { templatesService } from '../templates/templates.service.js';
import { findByKey as findIntegrationByKey } from '../../../integrations/integration.repository.js';
import { resolveActiveAiProvider } from '../../../integrations/aiProviderClient.js';
import { tenantProfileService } from '../../../tenant/tenantProfile.service.js';
import {
  PROMPT_CATEGORY,
  TONE,
  REWRITE_STYLE,
  VARIABLE_PATTERN,
  AI_PROVIDER,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_PROMPT_LENGTH,
  MAX_GENERATED_TEXT_LENGTH,
} from './aiReplyAssistant.constants.js';

// ── Real Gemini call (same pattern as leads/ai/qualification-ai.service.js) ──

const SERVER_GEMINI_API_KEY = () => process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const geminiUrl = (apiKey) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

/**
 * Resolves which Gemini API key to actually use for this tenant:
 *   1. The tenant's OWN key, saved via Integrations → Google Gemini
 *      (config.api_key, real per-tenant storage -- see integration.model.js).
 *      Previously this was saved but never read by anything ("simulation
 *      mode" per that page's own disclaimer) -- this is the first real
 *      consumer of it.
 *   2. Falls back to the server-wide GEMINI_API_KEY env var if the tenant
 *      hasn't configured their own (or their integration isn't marked
 *      'connected').
 *   3. Returns null if neither exists -- caller falls back to the mock.
 */
async function resolveGeminiApiKey(ctx) {
  try {
    const integration = ctx?.tenantId ? await findIntegrationByKey(ctx.tenantId, 'gemini') : null;
    const tenantKey = integration?.config?.api_key;
    if (integration?.status === 'connected' && typeof tenantKey === 'string' && tenantKey.trim()) {
      return tenantKey.trim();
    }
  } catch {
    // DB hiccup looking up the integration -- fall through to the server key rather than fail the whole request.
  }
  return SERVER_GEMINI_API_KEY() || null;
}

/** Same real pattern as resolveGeminiApiKey, checking the 'claude' Integrations card instead. */
async function resolveClaudeApiKey(ctx) {
  try {
    const integration = ctx?.tenantId ? await findIntegrationByKey(ctx.tenantId, 'claude') : null;
    const tenantKey = integration?.config?.api_key;
    if (integration?.status === 'connected' && typeof tenantKey === 'string' && tenantKey.trim()) {
      return tenantKey.trim();
    }
  } catch {
    // DB hiccup -- fall through to the server key rather than fail the whole request.
  }
  return process.env.ANTHROPIC_API_KEY || null;
}

/** Same real pattern as resolveClaudeApiKey, checking the 'openai' Integrations card instead. */
async function resolveOpenAiApiKey(ctx) {
  try {
    const integration = ctx?.tenantId ? await findIntegrationByKey(ctx.tenantId, 'openai') : null;
    const tenantKey = integration?.config?.api_key;
    if (integration?.status === 'connected' && typeof tenantKey === 'string' && tenantKey.trim()) {
      return tenantKey.trim();
    }
  } catch {
    // DB hiccup -- fall through to the server key rather than fail the whole request.
  }
  return process.env.OPENAI_API_KEY || null;
}

/** Plain-text Gemini call -- for generate/rewrite/summarize, which just need natural language back, not structured JSON. */
async function callGeminiText(prompt, apiKey) {
  const response = await fetch(geminiUrl(apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 512 },
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty response');
  return text.trim();
}

/** Structured-JSON Gemini call -- for suggestions, which needs 4 distinct fields back. */
async function callGeminiJSON(prompt, apiKey) {
  const response = await fetch(geminiUrl(apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 512 },
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty response');
  const clean = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(clean);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001'; // fast, cost-effective -- appropriate for real-time WhatsApp reply generation

/**
 * Plain-text Claude call. SOURCE: real, confirmed Anthropic Messages API
 * (docs.anthropic.com/en/api/messages) -- POST https://api.anthropic.com/v1/messages,
 * headers x-api-key + anthropic-version: 2023-06-01, body {model, max_tokens, messages}.
 * Response text lives at content[0].text -- NOT choices[0].message.content
 * (that's OpenAI's shape, not Anthropic's) -- confirmed before writing this,
 * not assumed from familiarity with either API.
 */
async function callClaudeText(prompt, apiKey) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 512,
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

/** Same real Claude call, but expects the model to return parsable JSON -- same strip-markdown-fences pattern as callGeminiJSON. */
async function callClaudeJSON(prompt, apiKey) {
  const text = await callClaudeText(prompt, apiKey);
  const clean = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(clean);
}

const OPENAI_MODEL = 'gpt-4.1-mini'; // fast, cheap, strong at short conversational replies

/**
 * Plain-text OpenAI call. SOURCE: real OpenAI Chat Completions API --
 * POST https://api.openai.com/v1/chat/completions, header
 * Authorization: Bearer <key>. Response text lives at
 * choices[0].message.content -- NOT content[0].text (that's Anthropic's shape).
 */
async function callOpenAiText(prompt, apiKey) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 512,
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

async function callOpenAiJSON(prompt, apiKey) {
  const text = await callOpenAiText(prompt, apiKey);
  const clean = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(clean);
}

function toDTO(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const { _id, ...rest } = o;
  return { id: String(_id ?? o.id), ...rest };
}

// Re-export SEARCHABLE_FIELDS from constants using the same pattern as campaigns/broadcasts.
const SEARCHABLE = ['title', 'description', 'prompt'];

/** Replace {{variable}} tokens with supplied values. */
function interpolate(text, variables = {}) {
  if (!text) return '';
  const re = new RegExp(VARIABLE_PATTERN, 'g');
  return String(text).replace(re, (full, name) => {
    const val = variables[name];
    return val != null ? String(val) : full;
  });
}

/** Collect all {{variable}} names from a string. */
function extractVariableNames(text = '') {
  const re = new RegExp(VARIABLE_PATTERN, 'g');
  const found = new Set();
  let m;
  while ((m = re.exec(text)) !== null) found.add(m[1]);
  return [...found];
}

function escapeRegex(str = '') {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFilter(query = {}) {
  const filter = {};
  if (query.category) filter.category = query.category;
  if (query.tone)     filter.tone = query.tone;
  if (query.isSystem !== undefined) filter.isSystem = query.isSystem === true || query.isSystem === 'true';
  // Default: only show active prompts unless explicitly asked for inactive.
  if (query.active !== undefined) {
    filter.isActive = query.active === true || query.active === 'true';
  } else {
    filter.isActive = true;
  }
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = SEARCHABLE.map((f) => ({ [f]: rx }));
  }
  return filter;
}

function buildSort(sort) {
  const valid = ['createdAt', 'updatedAt', 'usageCount', 'title'];
  if (!sort) return { createdAt: -1 };
  const desc = sort.startsWith('-');
  const key  = desc ? sort.slice(1) : sort;
  return valid.includes(key) ? { [key]: desc ? -1 : 1 } : { createdAt: -1 };
}

function paging(query = {}) {
  const page  = Math.max(Number(query.page)  || DEFAULT_PAGE, 1);
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  return { page, limit, skip: (page - 1) * limit };
}

// ── AI Provider Abstraction ────────────────────────────────────────────────────
//
// Each provider exposes the same interface:
//   generate(params)     → { text, provider, confidence, tokens, latency }
//   rewrite(params)      → { text, provider, tokens, latency }
//   summarize(params)    → { summary, provider, tokens, latency }
//   suggestions(params)  → { nextAction, bookingSuggestion, paymentSuggestion, followUp, provider }
//
// To add OpenAI: create providers/openai.js with the same exports and import
// it in the factory below.

const createMockProvider = (businessContext) => ({
  async generate({ conversation = [], lead = {}, goal = '', tone = 'Professional', language = 'en' }) {
    const start = Date.now();
    const leadName = lead.name || 'there';
    const company  = lead.company || 'your company';

    const toneMap = {
      Professional: `I hope this message finds you well.`,
      Friendly:     `Hey ${leadName}! Hope you're doing great!`,
      Persuasive:   `${leadName}, this is an opportunity you don't want to miss.`,
      Formal:       `Dear ${leadName}, I am writing to follow up.`,
      Empathetic:   `${leadName}, I completely understand your concerns.`,
      Urgent:       `${leadName}, time is running out — act now!`,
      Casual:       `Hey ${leadName}, just checking in!`,
    };

    const goalMap = {
      follow_up:   `Following up on our last conversation about ${company}.`,
      booking:     `I'd love to schedule a quick 15-minute call. Are you available this week?`,
      payment:     `Your payment link is ready. Please complete the payment at your earliest convenience.`,
      objection:   `I hear you, ${leadName}. Let me address that concern directly.`,
      qualification:`To better understand your needs, could you share a bit more about your current setup?`,
    };

    const opener = toneMap[tone] || toneMap['Professional'];
    const body   = goalMap[goal] || `Thank you for your interest in ${businessContext?.name || 'our business'}.`;

    const text = `${opener}\n\n${body}\n\nLooking forward to hearing from you, ${leadName}!`;

    return {
      text,
      provider:    AI_PROVIDER.MOCK,
      confidence:  0.87,
      tokens:      text.split(' ').length * 1.3 | 0,
      latency:     Date.now() - start,
      isLive:      false,
    };
  },

  async rewrite({ text = '', style = 'PROFESSIONAL' }) {
    const start = Date.now();
    const styleTransformations = {
      SHORTER:      (t) => t.split('. ').slice(0, 2).join('. ') + '.',
      LONGER:       (t) => `${t}\n\nI'd be happy to elaborate further and provide additional details at your convenience. Please don't hesitate to reach out.`,
      PROFESSIONAL: (t) => t.replace(/hey|hi there|sup/gi, 'Hello').replace(/!/g, '.'),
      FRIENDLY:     (t) => t.replace(/Dear|Good day/gi, 'Hi') + ' 😊',
      PERSUASIVE:   (t) => `${t}\n\nThis is a limited-time opportunity — don't miss out!`,
      FORMAL:       (t) => `Dear valued contact,\n\n${t}\n\nYours sincerely,`,
      EMPATHETIC:   (t) => `I completely understand where you're coming from. ${t}`,
      GRAMMAR:      (t) => t.trim().replace(/\s+/g, ' ').replace(/([.?!])([A-Z])/g, '$1 $2'),
      SIMPLIFY:     (t) => t.replace(/utilise/gi, 'use').replace(/commence/gi, 'start').replace(/terminate/gi, 'end'),
    };
    const transform = styleTransformations[style] || styleTransformations['PROFESSIONAL'];
    const rewritten = transform(text);
    return {
      text:      rewritten,
      provider:  AI_PROVIDER.MOCK,
      tokens:    rewritten.split(' ').length | 0,
      latency:   Date.now() - start,
      isLive:    false,
    };
  },

  async summarize({ conversation = [], lead = {} }) {
    const start       = Date.now();
    const msgCount    = Array.isArray(conversation) ? conversation.length : 0;
    const leadName    = lead.name || 'the lead';
    const lastMessage = Array.isArray(conversation) && conversation.length > 0
      ? conversation[conversation.length - 1]?.content || ''
      : '';

    const summary = `Conversation with ${leadName} — ${msgCount} message(s). `
      + (lastMessage ? `Last message: "${String(lastMessage).slice(0, 100)}..."` : 'No messages yet.')
      + ` Overall sentiment appears positive. Recommended next step: follow up within 24 hours.`;

    return {
      summary,
      provider: AI_PROVIDER.MOCK,
      tokens:   summary.split(' ').length | 0,
      latency:  Date.now() - start,
      isLive:   false,
    };
  },

  async suggestions({ conversation = [], lead = {} }) {
    const start    = Date.now();
    const leadName = lead.name || 'the lead';
    return {
      nextAction:         `Send a personalised follow-up to ${leadName} within 24 hours.`,
      bookingSuggestion:  `Schedule a 15-minute discovery call with ${leadName} to understand their requirements better.`,
      paymentSuggestion:  `Send the payment link to ${leadName} and follow up if not completed within 48 hours.`,
      followUp:           `Hi ${leadName}! Just checking in — were you able to review the information I sent? Happy to jump on a quick call!`,
      provider:           AI_PROVIDER.MOCK,
      latency:            Date.now() - start,
      isLive:             false,
    };
  },
});

/**
 * Real Gemini provider -- same interface/result shape as mockProvider so
 * nothing else in the service needs to change. Falls back to mockProvider
 * on any Gemini failure (bad key, rate limit, network issue, malformed
 * response) rather than surfacing a 500 to the user -- the app should
 * never actually break because of an AI provider hiccup.
 */
const createGeminiProvider = (apiKey, businessContext) => ({
  async generate({ conversation = [], lead = {}, goal = '', tone = 'Professional', language = 'en' }) {
    const start = Date.now();
    try {
      const history = Array.isArray(conversation) && conversation.length
        ? conversation.map((m) => `${m.direction === 'INBOUND' ? 'Customer' : 'Us'}: ${m.content || m.text || ''}`).join('\n')
        : '(no prior conversation history)';

      const businessLine = businessContext?.name
        ? `You are a helpful, natural-sounding WhatsApp assistant for ${businessContext.name}${businessContext.industry ? ` (${businessContext.industry})` : ''}.${businessContext.description ? ` About this business: ${businessContext.description}` : ''}`
        : 'You are a helpful, natural-sounding WhatsApp sales assistant.';

      const prompt = `${businessLine}

CONVERSATION SO FAR:
${history}

LEAD CONTEXT:
- Name: ${lead.name || 'the customer'}
- Company: ${lead.company || 'unknown'}

TASK: Write a WhatsApp reply.
- Tone: ${tone}
- Goal: ${goal || 'continue the conversation naturally and helpfully'}
- Language: ${language}

Rules: Sound like a real person texting, not a corporate email. Keep it under 60 words. No markdown, no headers -- just the message text, ready to send as-is. Do not include quotation marks around it.`;

      const text = await callGeminiText(prompt, apiKey);
      return { text, provider: AI_PROVIDER.GEMINI, confidence: 0.9, tokens: text.split(' ').length, latency: Date.now() - start, isLive: true };
    } catch (err) {
      console.warn(`[aiReplyAssistant] Gemini generate() failed, using mock fallback: ${err.message}`);
      const fallback = await createMockProvider(businessContext).generate({ conversation, lead, goal, tone, language });
      return { ...fallback, isLive: false };
    }
  },

  async rewrite({ text = '', style = 'PROFESSIONAL' }) {
    const start = Date.now();
    try {
      const styleInstruction = {
        SHORTER: 'Make it noticeably shorter while keeping the core message.',
        LONGER: 'Expand it with a bit more helpful detail.',
        PROFESSIONAL: 'Rewrite it in a more professional, polished tone.',
        FRIENDLY: 'Rewrite it in a warmer, more friendly and casual tone.',
        PERSUASIVE: 'Rewrite it to be more persuasive and compelling, without being pushy.',
        FORMAL: 'Rewrite it in a formal, business-letter style tone.',
        EMPATHETIC: 'Rewrite it to lead with empathy and understanding.',
        GRAMMAR: 'Fix any grammar, spelling, or punctuation issues -- keep the meaning and tone exactly the same.',
        SIMPLIFY: 'Simplify the language -- shorter words, simpler sentences, same meaning.',
      }[style] || 'Rewrite it to be clearer and more polished.';

      const prompt = `Rewrite this WhatsApp message. ${styleInstruction}

ORIGINAL MESSAGE:
${text}

Return ONLY the rewritten message, ready to send as-is -- no explanation, no quotation marks, no markdown.`;

      const rewritten = await callGeminiText(prompt, apiKey);
      return { text: rewritten, provider: AI_PROVIDER.GEMINI, tokens: rewritten.split(' ').length, latency: Date.now() - start, isLive: true };
    } catch (err) {
      console.warn(`[aiReplyAssistant] Gemini rewrite() failed, using mock fallback: ${err.message}`);
      const fallback = await createMockProvider(businessContext).rewrite({ text, style });
      return { ...fallback, isLive: false };
    }
  },

  async summarize({ conversation = [], lead = {} }) {
    const start = Date.now();
    try {
      const history = Array.isArray(conversation) && conversation.length
        ? conversation.map((m) => `${m.direction === 'INBOUND' ? 'Customer' : 'Us'}: ${m.content || m.text || ''}`).join('\n')
        : '(no messages yet)';

      const prompt = `Summarize this WhatsApp conversation with ${lead.name || 'a customer'} in 2-3 sentences. Include overall sentiment and a recommended next step.

CONVERSATION:
${history}

Return ONLY the summary text, no markdown, no headers.`;

      const summary = await callGeminiText(prompt, apiKey);
      return { summary, provider: AI_PROVIDER.GEMINI, tokens: summary.split(' ').length, latency: Date.now() - start, isLive: true };
    } catch (err) {
      console.warn(`[aiReplyAssistant] Gemini summarize() failed, using mock fallback: ${err.message}`);
      const fallback = await createMockProvider(businessContext).summarize({ conversation, lead });
      return { ...fallback, isLive: false };
    }
  },

  async suggestions({ conversation = [], lead = {} }) {
    const start = Date.now();
    try {
      const history = Array.isArray(conversation) && conversation.length
        ? conversation.map((m) => `${m.direction === 'INBOUND' ? 'Customer' : 'Us'}: ${m.content || m.text || ''}`).join('\n')
        : '(no messages yet)';

      const prompt = `Based on this WhatsApp conversation with ${lead.name || 'a customer'}, suggest next steps.

CONVERSATION:
${history}

Return ONLY a valid JSON object, no markdown, no explanation:
{
  "nextAction": "<one sentence recommended next action>",
  "bookingSuggestion": "<one sentence suggestion for booking a call, or empty string if not relevant>",
  "paymentSuggestion": "<one sentence suggestion about payment follow-up, or empty string if not relevant>",
  "followUp": "<a ready-to-send WhatsApp follow-up message>"
}`;

      const result = await callGeminiJSON(prompt, apiKey);
      return {
        nextAction: result.nextAction || '',
        bookingSuggestion: result.bookingSuggestion || '',
        paymentSuggestion: result.paymentSuggestion || '',
        followUp: result.followUp || '',
        provider: AI_PROVIDER.GEMINI,
        latency: Date.now() - start,
        isLive: true,
      };
    } catch (err) {
      console.warn(`[aiReplyAssistant] Gemini suggestions() failed, using mock fallback: ${err.message}`);
      const fallback = await createMockProvider(businessContext).suggestions({ conversation, lead });
      return { ...fallback, isLive: false };
    }
  },
});

/**
 * createClaudeProvider -- mirrors createGeminiProvider exactly: same 4
 * functions, same prompts, same honest mock-fallback-on-error behavior.
 * Only the underlying API call (callClaudeText/callClaudeJSON) and the
 * real Anthropic response shape differ.
 */
const createClaudeProvider = (apiKey, businessContext) => ({
  async generate({ conversation = [], lead = {}, goal = '', tone = 'Professional', language = 'en' }) {
    const start = Date.now();
    try {
      const history = Array.isArray(conversation) && conversation.length
        ? conversation.map((m) => `${m.direction === 'INBOUND' ? 'Customer' : 'Us'}: ${m.content || m.text || ''}`).join('\n')
        : '(no prior conversation history)';

      const businessLine = businessContext?.name
        ? `You are a helpful, natural-sounding WhatsApp assistant for ${businessContext.name}${businessContext.industry ? ` (${businessContext.industry})` : ''}.${businessContext.description ? ` About this business: ${businessContext.description}` : ''}`
        : 'You are a helpful, natural-sounding WhatsApp sales assistant.';

      const prompt = `${businessLine}

CONVERSATION SO FAR:
${history}

LEAD CONTEXT:
- Name: ${lead.name || 'the customer'}
- Company: ${lead.company || 'unknown'}

TASK: Write a WhatsApp reply.
- Tone: ${tone}
- Goal: ${goal || 'continue the conversation naturally and helpfully'}
- Language: ${language}

Rules: Sound like a real person texting, not a corporate email. Keep it under 60 words. No markdown, no headers -- just the message text, ready to send as-is. Do not include quotation marks around it.`;

      const text = await callClaudeText(prompt, apiKey);
      return { text, provider: AI_PROVIDER.CLAUDE, confidence: 0.9, tokens: text.split(' ').length, latency: Date.now() - start, isLive: true };
    } catch (err) {
      console.warn(`[aiReplyAssistant] Claude generate() failed, using mock fallback: ${err.message}`);
      const fallback = await createMockProvider(businessContext).generate({ conversation, lead, goal, tone, language });
      return { ...fallback, isLive: false };
    }
  },

  async rewrite({ text = '', style = 'PROFESSIONAL' }) {
    const start = Date.now();
    try {
      const styleInstruction = {
        SHORTER: 'Make it noticeably shorter while keeping the core message.',
        LONGER: 'Expand it with a bit more helpful detail.',
        PROFESSIONAL: 'Rewrite it in a more professional, polished tone.',
        FRIENDLY: 'Rewrite it in a warmer, more friendly and casual tone.',
        PERSUASIVE: 'Rewrite it to be more persuasive and compelling, without being pushy.',
        FORMAL: 'Rewrite it in a formal, business-letter style tone.',
        EMPATHETIC: 'Rewrite it to lead with empathy and understanding.',
        GRAMMAR: 'Fix any grammar, spelling, or punctuation issues -- keep the meaning and tone exactly the same.',
        SIMPLIFY: 'Simplify the language -- shorter words, simpler sentences, same meaning.',
      }[style] || 'Rewrite it to be clearer and more polished.';

      const prompt = `Rewrite this WhatsApp message. ${styleInstruction}

ORIGINAL MESSAGE:
${text}

Return ONLY the rewritten message, ready to send as-is -- no explanation, no quotation marks, no markdown.`;

      const rewritten = await callClaudeText(prompt, apiKey);
      return { text: rewritten, provider: AI_PROVIDER.CLAUDE, tokens: rewritten.split(' ').length, latency: Date.now() - start, isLive: true };
    } catch (err) {
      console.warn(`[aiReplyAssistant] Claude rewrite() failed, using mock fallback: ${err.message}`);
      const fallback = await createMockProvider(businessContext).rewrite({ text, style });
      return { ...fallback, isLive: false };
    }
  },

  async summarize({ conversation = [], lead = {} }) {
    const start = Date.now();
    try {
      const history = Array.isArray(conversation) && conversation.length
        ? conversation.map((m) => `${m.direction === 'INBOUND' ? 'Customer' : 'Us'}: ${m.content || m.text || ''}`).join('\n')
        : '(no messages yet)';

      const prompt = `Summarize this WhatsApp conversation with ${lead.name || 'a customer'} in 2-3 sentences. Include overall sentiment and a recommended next step.

CONVERSATION:
${history}

Return ONLY the summary text, no markdown, no headers.`;

      const summary = await callClaudeText(prompt, apiKey);
      return { summary, provider: AI_PROVIDER.CLAUDE, tokens: summary.split(' ').length, latency: Date.now() - start, isLive: true };
    } catch (err) {
      console.warn(`[aiReplyAssistant] Claude summarize() failed, using mock fallback: ${err.message}`);
      const fallback = await createMockProvider(businessContext).summarize({ conversation, lead });
      return { ...fallback, isLive: false };
    }
  },

  async suggestions({ conversation = [], lead = {} }) {
    const start = Date.now();
    try {
      const history = Array.isArray(conversation) && conversation.length
        ? conversation.map((m) => `${m.direction === 'INBOUND' ? 'Customer' : 'Us'}: ${m.content || m.text || ''}`).join('\n')
        : '(no messages yet)';

      const prompt = `Based on this WhatsApp conversation with ${lead.name || 'a customer'}, suggest next steps.

CONVERSATION:
${history}

Return ONLY a valid JSON object, no markdown, no explanation:
{
  "nextAction": "<one sentence recommended next action>",
  "bookingSuggestion": "<one sentence suggestion for booking a call, or empty string if not relevant>",
  "paymentSuggestion": "<one sentence suggestion about payment follow-up, or empty string if not relevant>",
  "followUp": "<a ready-to-send WhatsApp follow-up message>"
}`;

      const result = await callClaudeJSON(prompt, apiKey);
      return {
        nextAction: result.nextAction || '',
        bookingSuggestion: result.bookingSuggestion || '',
        paymentSuggestion: result.paymentSuggestion || '',
        followUp: result.followUp || '',
        provider: AI_PROVIDER.CLAUDE,
        latency: Date.now() - start,
        isLive: true,
      };
    } catch (err) {
      console.warn(`[aiReplyAssistant] Claude suggestions() failed, using mock fallback: ${err.message}`);
      const fallback = await createMockProvider(businessContext).suggestions({ conversation, lead });
      return { ...fallback, isLive: false };
    }
  },
});

/**
 * createOpenAiProvider -- mirrors createGeminiProvider/createClaudeProvider
 * exactly: same 4 functions, same prompts, same honest
 * mock-fallback-on-error behavior. Only the underlying API call
 * (callOpenAiText/callOpenAiJSON) and the real OpenAI response shape differ.
 */
const createOpenAiProvider = (apiKey, businessContext) => ({
  async generate({ conversation = [], lead = {}, goal = '', tone = 'Professional', language = 'en' }) {
    const start = Date.now();
    try {
      const history = Array.isArray(conversation) && conversation.length
        ? conversation.map((m) => `${m.direction === 'INBOUND' ? 'Customer' : 'Us'}: ${m.content || m.text || ''}`).join('\n')
        : '(no prior conversation history)';

      const businessLine = businessContext?.name
        ? `You are a helpful, natural-sounding WhatsApp assistant for ${businessContext.name}${businessContext.industry ? ` (${businessContext.industry})` : ''}.${businessContext.description ? ` About this business: ${businessContext.description}` : ''}`
        : 'You are a helpful, natural-sounding WhatsApp sales assistant.';

      const prompt = `${businessLine}

CONVERSATION SO FAR:
${history}

LEAD CONTEXT:
- Name: ${lead.name || 'the customer'}
- Company: ${lead.company || 'unknown'}

TASK: Write a WhatsApp reply.
- Tone: ${tone}
- Goal: ${goal || 'continue the conversation naturally and helpfully'}
- Language: ${language}

Rules: Sound like a real person texting, not a corporate email. Keep it under 60 words. No markdown, no headers -- just the message text, ready to send as-is. Do not include quotation marks around it.`;

      const text = await callOpenAiText(prompt, apiKey);
      return { text, provider: AI_PROVIDER.OPENAI, confidence: 0.9, tokens: text.split(' ').length, latency: Date.now() - start, isLive: true };
    } catch (err) {
      console.warn(`[aiReplyAssistant] OpenAI generate() failed, using mock fallback: ${err.message}`);
      const fallback = await createMockProvider(businessContext).generate({ conversation, lead, goal, tone, language });
      return { ...fallback, isLive: false };
    }
  },

  async rewrite({ text = '', style = 'PROFESSIONAL' }) {
    const start = Date.now();
    try {
      const styleInstruction = {
        SHORTER: 'Make it noticeably shorter while keeping the core message.',
        LONGER: 'Expand it with a bit more helpful detail.',
        PROFESSIONAL: 'Rewrite it in a more professional, polished tone.',
        FRIENDLY: 'Rewrite it in a warmer, more friendly and casual tone.',
        PERSUASIVE: 'Rewrite it to be more persuasive and compelling, without being pushy.',
        FORMAL: 'Rewrite it in a formal, business-letter style tone.',
        EMPATHETIC: 'Rewrite it to lead with empathy and understanding.',
        GRAMMAR: 'Fix any grammar, spelling, or punctuation issues -- keep the meaning and tone exactly the same.',
        SIMPLIFY: 'Simplify the language -- shorter words, simpler sentences, same meaning.',
      }[style] || 'Rewrite it to be clearer and more polished.';

      const prompt = `Rewrite this WhatsApp message. ${styleInstruction}

ORIGINAL MESSAGE:
${text}

Return ONLY the rewritten message, ready to send as-is -- no explanation, no quotation marks, no markdown.`;

      const rewritten = await callOpenAiText(prompt, apiKey);
      return { text: rewritten, provider: AI_PROVIDER.OPENAI, tokens: rewritten.split(' ').length, latency: Date.now() - start, isLive: true };
    } catch (err) {
      console.warn(`[aiReplyAssistant] OpenAI rewrite() failed, using mock fallback: ${err.message}`);
      const fallback = await createMockProvider(businessContext).rewrite({ text, style });
      return { ...fallback, isLive: false };
    }
  },

  async summarize({ conversation = [], lead = {} }) {
    const start = Date.now();
    try {
      const history = Array.isArray(conversation) && conversation.length
        ? conversation.map((m) => `${m.direction === 'INBOUND' ? 'Customer' : 'Us'}: ${m.content || m.text || ''}`).join('\n')
        : '(no messages yet)';

      const prompt = `Summarize this WhatsApp conversation with ${lead.name || 'a customer'} in 2-3 sentences. Include overall sentiment and a recommended next step.

CONVERSATION:
${history}

Return ONLY the summary text, no markdown, no headers.`;

      const summary = await callOpenAiText(prompt, apiKey);
      return { summary, provider: AI_PROVIDER.OPENAI, tokens: summary.split(' ').length, latency: Date.now() - start, isLive: true };
    } catch (err) {
      console.warn(`[aiReplyAssistant] OpenAI summarize() failed, using mock fallback: ${err.message}`);
      const fallback = await createMockProvider(businessContext).summarize({ conversation, lead });
      return { ...fallback, isLive: false };
    }
  },

  async suggestions({ conversation = [], lead = {} }) {
    const start = Date.now();
    try {
      const history = Array.isArray(conversation) && conversation.length
        ? conversation.map((m) => `${m.direction === 'INBOUND' ? 'Customer' : 'Us'}: ${m.content || m.text || ''}`).join('\n')
        : '(no messages yet)';

      const prompt = `Based on this WhatsApp conversation with ${lead.name || 'a customer'}, suggest next steps.

CONVERSATION:
${history}

Return ONLY a valid JSON object, no markdown, no explanation:
{
  "nextAction": "<one sentence recommended next action>",
  "bookingSuggestion": "<one sentence suggestion for booking a call, or empty string if not relevant>",
  "paymentSuggestion": "<one sentence suggestion about payment follow-up, or empty string if not relevant>",
  "followUp": "<a ready-to-send WhatsApp follow-up message>"
}`;

      const result = await callOpenAiJSON(prompt, apiKey);
      return {
        nextAction: result.nextAction || '',
        bookingSuggestion: result.bookingSuggestion || '',
        paymentSuggestion: result.paymentSuggestion || '',
        followUp: result.followUp || '',
        provider: AI_PROVIDER.OPENAI,
        latency: Date.now() - start,
        isLive: true,
      };
    } catch (err) {
      console.warn(`[aiReplyAssistant] OpenAI suggestions() failed, using mock fallback: ${err.message}`);
      const fallback = await createMockProvider(businessContext).suggestions({ conversation, lead });
      return { ...fallback, isLive: false };
    }
  },
});

/**
 * Provider factory.
 *
 * BUG FIX #1: OpenAI is now genuinely wired up (it was previously a
 * commented-out stub -- `// case AI_PROVIDER.OPENAI: return
 * openaiProvider;` -- meaning OpenAI could never actually be selected no
 * matter what was connected).
 *
 * BUG FIX #2: the default `name` used to be ACTIVE_AI_PROVIDER, which
 * itself defaults to AI_PROVIDER.MOCK whenever process.env.AI_PROVIDER
 * isn't set (the normal case) -- and the very first line of this
 * function forces mock whenever name === AI_PROVIDER.MOCK. That meant
 * this feature ALWAYS returned mock, unconditionally, regardless of any
 * tenant-connected key or the platform Gemini fallback, unless
 * AI_PROVIDER was explicitly set to something else in the environment.
 * Default is now `undefined` (no override requested) so the
 * shared-resolver path below is genuinely reachable by default; MOCK is
 * only forced when a caller (or AI_PROVIDER env var) EXPLICITLY asks for it.
 *
 * When no explicit provider is requested (the normal case), this defers
 * to the same shared resolveActiveAiProvider() used by AI Qualification
 * and Call Intelligence, so all three features follow one consistent
 * rule: a tenant "chooses" a provider simply by connecting it (with a
 * real, verified key) on the Integrations page -- whichever was most
 * recently connected/re-verified wins if more than one is connected --
 * and if the tenant hasn't connected ANY of the three, the platform's
 * .env GEMINI_API_KEY is the one shared fallback for all three features.
 */
async function getProvider(ctx, name = process.env.AI_PROVIDER || undefined) {
  const businessContext = await tenantProfileService.getContextForAI(ctx?.tenantId);

  // Only forces mock when EXPLICITLY requested (env var or caller-passed
  // name) -- no longer the silent default.
  if (name === AI_PROVIDER.MOCK) return createMockProvider(businessContext);

  // Explicit override: try the SPECIFICALLY requested provider's own real
  // key first, before falling back to the tenant's actual active one.
  if (name === AI_PROVIDER.CLAUDE) {
    const claudeKey = await resolveClaudeApiKey(ctx);
    if (claudeKey) return createClaudeProvider(claudeKey, businessContext);
  }
  if (name === AI_PROVIDER.OPENAI) {
    const openaiKey = await resolveOpenAiApiKey(ctx);
    if (openaiKey) return createOpenAiProvider(openaiKey, businessContext);
  }
  if (name === AI_PROVIDER.GEMINI) {
    const geminiKey = await resolveGeminiApiKey(ctx);
    if (geminiKey) return createGeminiProvider(geminiKey, businessContext);
  }

  // No explicit override resolved (or none was requested) -- defer to
  // whichever provider this tenant has actually connected, same shared
  // priority AI Qualification and Call Intelligence use. Falls through to
  // the platform Gemini .env fallback inside resolveActiveAiProvider
  // itself if the tenant hasn't connected anything at all.
  const { provider, apiKey } = await resolveActiveAiProvider(ctx?.tenantId);
  if (provider === 'claude') return createClaudeProvider(apiKey, businessContext);
  if (provider === 'openai') return createOpenAiProvider(apiKey, businessContext);
  if (provider === 'gemini') return createGeminiProvider(apiKey, businessContext);

  return createMockProvider(businessContext);
}

// ── Service ────────────────────────────────────────────────────────────────────

export const aiReplyAssistantService = {
  // ── Prompt CRUD ────────────────────────────────────────────────────────────

  async createPrompt(ctx, data) {
    const prompt = await aiReplyAssistantRepository.createPrompt({
      ...data,
      tenantId:  ctx.tenantId,
      isSystem:  data.isSystem === true ? true : false,
      isActive:  true,
      usageCount: 0,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    });
    return toDTO(prompt);
  },

  async getPrompt(ctx, id) {
    const prompt = await aiReplyAssistantRepository.findPromptById(ctx.tenantId, id);
    if (!prompt) throw new AppError(404, 'Prompt not found');
    return toDTO(prompt);
  },

  async listPrompts(ctx, query) {
    const filter = buildFilter(query);
    const sort   = buildSort(query.sort);
    const { page, limit, skip } = paging(query);
    const [items, total] = await Promise.all([
      aiReplyAssistantRepository.listPrompts(ctx.tenantId, filter, { sort, skip, limit }),
      aiReplyAssistantRepository.countPrompts(ctx.tenantId, filter),
    ]);
    return {
      data: items.map(toDTO),
      pagination: {
        page, limit, total,
        totalPages: Math.ceil(total / limit) || 0,
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  },

  async updatePrompt(ctx, id, patch) {
    const existing = await aiReplyAssistantRepository.findPromptById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Prompt not found');
    patch.updatedBy = ctx.userId;
    const updated = await aiReplyAssistantRepository.updatePrompt(ctx.tenantId, id, patch);
    return toDTO(updated);
  },

  async deletePrompt(ctx, id) {
    const existing = await aiReplyAssistantRepository.findPromptById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Prompt not found');
    if (existing.isSystem) throw new AppError(403, 'System prompts cannot be deleted');
    await aiReplyAssistantRepository.softDeletePrompt(ctx.tenantId, id);
    return { id: String(existing._id), deleted: true };
  },

  async duplicatePrompt(ctx, id) {
    const source = await aiReplyAssistantRepository.findPromptById(ctx.tenantId, id);
    if (!source) throw new AppError(404, 'Prompt not found');
    const src = source.toObject ? source.toObject() : source;
    const clone = await aiReplyAssistantRepository.createPrompt({
      tenantId:     ctx.tenantId,
      title:        `${src.title} (Copy)`,
      description:  src.description,
      category:     src.category,
      prompt:       src.prompt,
      tone:         src.tone,
      languageCode: src.languageCode,
      isSystem:     false,   // copies are never system prompts
      isActive:     true,
      usageCount:   0,
      createdBy:    ctx.userId,
      updatedBy:    ctx.userId,
    });
    return toDTO(clone);
  },

  async togglePrompt(ctx, id) {
    const existing = await aiReplyAssistantRepository.findPromptById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Prompt not found');
    const newState = !existing.isActive;
    const updated  = await aiReplyAssistantRepository.toggleActive(ctx.tenantId, id, newState);
    return toDTO(updated);
  },

  async usePrompt(ctx, id) {
    const existing = await aiReplyAssistantRepository.findPromptById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Prompt not found');
    if (!existing.isActive) throw new AppError(409, 'Prompt is inactive');
    const updated = await aiReplyAssistantRepository.incrementUsageCount(ctx.tenantId, id);
    return toDTO(updated);
  },

  // ── Variable replacement ───────────────────────────────────────────────────

  replaceVariables(text, variables = {}) {
    return interpolate(text, variables);
  },

  extractVariables(text) {
    return extractVariableNames(text);
  },

  // ── AI Generation ──────────────────────────────────────────────────────────

  async generateReply(ctx, { conversation, lead, goal, tone, language, variables = {} }) {
    const provider = await getProvider(ctx);
    const result   = await provider.generate({ conversation, lead, goal, tone, language });
    // Replace variables in the generated text.
    result.text = interpolate(result.text, { ...this._leadVariables(lead), ...variables });
    result.generatedReply = result.text;
    delete result.text;
    return result;
  },

  async rewriteText(ctx, { text, style, variables = {} }) {
    const provider  = await getProvider(ctx);
    const result    = await provider.rewrite({ text, style });
    result.rewritten = interpolate(result.text, variables);
    delete result.text;
    return result;
  },

  async summarizeConversation(ctx, { conversation, lead }) {
    const provider = await getProvider(ctx);
    return provider.summarize({ conversation, lead });
  },

  async generateSuggestions(ctx, { conversation, lead, variables = {} }) {
    const provider = await getProvider(ctx);
    const result   = await provider.suggestions({ conversation, lead });
    // Interpolate variables into all text fields.
    const vars = { ...this._leadVariables(lead), ...variables };
    result.nextAction        = interpolate(result.nextAction, vars);
    result.bookingSuggestion = interpolate(result.bookingSuggestion, vars);
    result.paymentSuggestion = interpolate(result.paymentSuggestion, vars);
    result.followUp          = interpolate(result.followUp, vars);
    return result;
  },

  // ── Save-as-template (delegates to Templates service) ──────────────────────

  async saveAsTemplate(ctx, { generatedReply, templateData = {} }) {
    if (!generatedReply) throw new AppError(400, 'generatedReply is required');
    const data = {
      name:         templateData.name        || 'AI Generated Reply',
      category:     templateData.category    || 'MARKETING',
      languageCode: templateData.languageCode || 'en',
      body:         generatedReply,
      description:  templateData.description  || 'Created from AI Reply Assistant',
      provider:     templateData.provider     || 'SIMULATION',
      ...templateData,
    };
    return templatesService.createTemplate(ctx, data);
  },

  // ── Save-as-prompt (creates a prompt from a generated reply) ───────────────

  async saveAsPrompt(ctx, { text, title, category, tone, languageCode, description }) {
    if (!text)  throw new AppError(400, 'text is required');
    if (!title) throw new AppError(400, 'title is required');
    return this.createPrompt(ctx, {
      title,
      description: description || '',
      category:    category    || PROMPT_CATEGORY.CUSTOM,
      prompt:      text,
      tone:        tone        || TONE.PROFESSIONAL,
      languageCode: languageCode || 'en',
    });
  },

  // ── Internal helper: build variable map from a lead object ─────────────────

  _leadVariables(lead = {}) {
    return {
      lead_name:          lead.name         || lead.lead_name        || '',
      company_name:       lead.company      || lead.company_name     || '',
      sales_rep_name:     lead.salesRep     || lead.sales_rep_name   || '',
      lead_problem:       lead.problem      || lead.lead_problem     || '',
      qualification_score: lead.score       || lead.qualification_score || '',
    };
  },
};