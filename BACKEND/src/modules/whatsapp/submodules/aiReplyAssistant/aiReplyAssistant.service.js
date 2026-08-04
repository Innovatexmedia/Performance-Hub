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
import { AppError } from "../../../../shared/helpers/lead.helpers.js";
import { aiReplyAssistantRepository } from "./aiReplyAssistant.repository.js";
import { templatesService } from "../templates/templates.service.js";
import { findByKey as findIntegrationByKey } from "../../../integrations/integration.repository.js";
import {
  PROMPT_CATEGORY,
  TONE,
  REWRITE_STYLE,
  VARIABLE_PATTERN,
  ACTIVE_AI_PROVIDER,
  AI_PROVIDER,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_PROMPT_LENGTH,
  MAX_GENERATED_TEXT_LENGTH,
} from "./aiReplyAssistant.constants.js";

// ── Real Gemini call (same pattern as leads/ai/qualification-ai.service.js) ──

const SERVER_GEMINI_API_KEY = () => process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-3.5-flash-lite";

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
    const integration = ctx?.tenantId
      ? await findIntegrationByKey(ctx.tenantId, "gemini")
      : null;
    const tenantKey = integration?.config?.api_key;
    if (
      integration?.status === "connected" &&
      typeof tenantKey === "string" &&
      tenantKey.trim()
    ) {
      return tenantKey.trim();
    }
  } catch {
    // DB hiccup looking up the integration -- fall through to the server key rather than fail the whole request.
  }
  return SERVER_GEMINI_API_KEY() || null;
}

/** Plain-text Gemini call -- for generate/rewrite/summarize, which just need natural language back, not structured JSON. */
async function callGeminiText(prompt, apiKey) {
  const response = await fetch(geminiUrl(apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 512 },
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned empty response");
  return text.trim();
}

/** Structured-JSON Gemini call -- for suggestions, which needs 4 distinct fields back. */
async function callGeminiJSON(prompt, apiKey) {
  const response = await fetch(geminiUrl(apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 512 },
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned empty response");
  const clean = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return JSON.parse(clean);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function toDTO(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === "function" ? doc.toObject() : doc;
  const { _id, ...rest } = o;
  return { id: String(_id ?? o.id), ...rest };
}

// Re-export SEARCHABLE_FIELDS from constants using the same pattern as campaigns/broadcasts.
const SEARCHABLE = ["title", "description", "prompt"];

/** Replace {{variable}} tokens with supplied values. */
function interpolate(text, variables = {}) {
  if (!text) return "";
  const re = new RegExp(VARIABLE_PATTERN, "g");
  return String(text).replace(re, (full, name) => {
    const val = variables[name];
    return val != null ? String(val) : full;
  });
}

/** Collect all {{variable}} names from a string. */
function extractVariableNames(text = "") {
  const re = new RegExp(VARIABLE_PATTERN, "g");
  const found = new Set();
  let m;
  while ((m = re.exec(text)) !== null) found.add(m[1]);
  return [...found];
}

function escapeRegex(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFilter(query = {}) {
  const filter = {};
  if (query.category) filter.category = query.category;
  if (query.tone) filter.tone = query.tone;
  if (query.isSystem !== undefined)
    filter.isSystem = query.isSystem === true || query.isSystem === "true";
  // Default: only show active prompts unless explicitly asked for inactive.
  if (query.active !== undefined) {
    filter.isActive = query.active === true || query.active === "true";
  } else {
    filter.isActive = true;
  }
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = SEARCHABLE.map((f) => ({ [f]: rx }));
  }
  return filter;
}

function buildSort(sort) {
  const valid = ["createdAt", "updatedAt", "usageCount", "title"];
  if (!sort) return { createdAt: -1 };
  const desc = sort.startsWith("-");
  const key = desc ? sort.slice(1) : sort;
  return valid.includes(key) ? { [key]: desc ? -1 : 1 } : { createdAt: -1 };
}

function paging(query = {}) {
  const page = Math.max(Number(query.page) || DEFAULT_PAGE, 1);
  const limit = Math.min(
    Math.max(Number(query.limit) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );
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

const mockProvider = {
  async generate({
    conversation = [],
    lead = {},
    goal = "",
    tone = "Professional",
    language = "en",
  }) {
    const start = Date.now();
    const leadName = lead.name || "there";
    const company = lead.company || "your company";

    const toneMap = {
      Professional: `I hope this message finds you well.`,
      Friendly: `Hey ${leadName}! Hope you're doing great!`,
      Persuasive: `${leadName}, this is an opportunity you don't want to miss.`,
      Formal: `Dear ${leadName}, I am writing to follow up.`,
      Empathetic: `${leadName}, I completely understand your concerns.`,
      Urgent: `${leadName}, time is running out — act now!`,
      Casual: `Hey ${leadName}, just checking in!`,
    };

    const goalMap = {
      follow_up: `Following up on our last conversation about ${company}.`,
      booking: `I'd love to schedule a quick 15-minute call. Are you available this week?`,
      payment: `Your payment link is ready. Please complete the payment at your earliest convenience.`,
      objection: `I hear you, ${leadName}. Let me address that concern directly.`,
      qualification: `To better understand your needs, could you share a bit more about your current setup?`,
    };

    const opener = toneMap[tone] || toneMap["Professional"];
    const body = goalMap[goal] || `Thank you for your interest in InnovateX.`;

    const text = `${opener}\n\n${body}\n\nLooking forward to hearing from you, ${leadName}!`;

    return {
      text,
      provider: AI_PROVIDER.MOCK,
      confidence: 0.87,
      tokens: (text.split(" ").length * 1.3) | 0,
      latency: Date.now() - start,
      isLive: false,
    };
  },

  async rewrite({ text = "", style = "PROFESSIONAL" }) {
    const start = Date.now();
    const styleTransformations = {
      SHORTER: (t) => t.split(". ").slice(0, 2).join(". ") + ".",
      LONGER: (t) =>
        `${t}\n\nI'd be happy to elaborate further and provide additional details at your convenience. Please don't hesitate to reach out.`,
      PROFESSIONAL: (t) =>
        t.replace(/hey|hi there|sup/gi, "Hello").replace(/!/g, "."),
      FRIENDLY: (t) => t.replace(/Dear|Good day/gi, "Hi") + " 😊",
      PERSUASIVE: (t) =>
        `${t}\n\nThis is a limited-time opportunity — don't miss out!`,
      FORMAL: (t) => `Dear valued contact,\n\n${t}\n\nYours sincerely,`,
      EMPATHETIC: (t) =>
        `I completely understand where you're coming from. ${t}`,
      GRAMMAR: (t) =>
        t
          .trim()
          .replace(/\s+/g, " ")
          .replace(/([.?!])([A-Z])/g, "$1 $2"),
      SIMPLIFY: (t) =>
        t
          .replace(/utilise/gi, "use")
          .replace(/commence/gi, "start")
          .replace(/terminate/gi, "end"),
    };
    const transform =
      styleTransformations[style] || styleTransformations["PROFESSIONAL"];
    const rewritten = transform(text);
    return {
      text: rewritten,
      provider: AI_PROVIDER.MOCK,
      tokens: rewritten.split(" ").length | 0,
      latency: Date.now() - start,
      isLive: false,
    };
  },

  async summarize({ conversation = [], lead = {} }) {
    const start = Date.now();
    const msgCount = Array.isArray(conversation) ? conversation.length : 0;
    const leadName = lead.name || "the lead";
    const lastMessage =
      Array.isArray(conversation) && conversation.length > 0
        ? conversation[conversation.length - 1]?.content || ""
        : "";

    const summary =
      `Conversation with ${leadName} — ${msgCount} message(s). ` +
      (lastMessage
        ? `Last message: "${String(lastMessage).slice(0, 100)}..."`
        : "No messages yet.") +
      ` Overall sentiment appears positive. Recommended next step: follow up within 24 hours.`;

    return {
      summary,
      provider: AI_PROVIDER.MOCK,
      tokens: summary.split(" ").length | 0,
      latency: Date.now() - start,
      isLive: false,
    };
  },

  async suggestions({ conversation = [], lead = {} }) {
    const start = Date.now();
    const leadName = lead.name || "the lead";
    return {
      nextAction: `Send a personalised follow-up to ${leadName} within 24 hours.`,
      bookingSuggestion: `Schedule a 15-minute discovery call with ${leadName} to understand their requirements better.`,
      paymentSuggestion: `Send the payment link to ${leadName} and follow up if not completed within 48 hours.`,
      followUp: `Hi ${leadName}! Just checking in — were you able to review the information I sent? Happy to jump on a quick call!`,
      provider: AI_PROVIDER.MOCK,
      latency: Date.now() - start,
      isLive: false,
    };
  },
};

/**
 * Real Gemini provider -- same interface/result shape as mockProvider so
 * nothing else in the service needs to change. Falls back to mockProvider
 * on any Gemini failure (bad key, rate limit, network issue, malformed
 * response) rather than surfacing a 500 to the user -- the app should
 * never actually break because of an AI provider hiccup.
 */
const createGeminiProvider = (apiKey) => ({
  async generate({
    conversation = [],
    lead = {},
    goal = "",
    tone = "Professional",
    language = "en",
  }) {
    const start = Date.now();
    try {
      const history =
        Array.isArray(conversation) && conversation.length
          ? conversation
              .map(
                (m) =>
                  `${m.direction === "INBOUND" ? "Customer" : "Us"}: ${m.content || m.text || ""}`,
              )
              .join("\n")
          : "(no prior conversation history)";

      const prompt = `You are a helpful, natural-sounding WhatsApp sales assistant for InnovateX Revenue OS.

CONVERSATION SO FAR:
${history}

LEAD CONTEXT:
- Name: ${lead.name || "the customer"}
- Company: ${lead.company || "unknown"}

TASK: Write a WhatsApp reply.
- Tone: ${tone}
- Goal: ${goal || "continue the conversation naturally and helpfully"}
- Language: ${language}

Rules: Sound like a real person texting, not a corporate email. Keep it under 60 words. No markdown, no headers -- just the message text, ready to send as-is. Do not include quotation marks around it.`;

      const text = await callGeminiText(prompt, apiKey);
      return {
        text,
        provider: AI_PROVIDER.GEMINI,
        confidence: 0.9,
        tokens: text.split(" ").length,
        latency: Date.now() - start,
        isLive: true,
      };
    } catch (err) {
      console.warn(
        `[aiReplyAssistant] Gemini generate() failed, using mock fallback: ${err.message}`,
      );
      const fallback = await mockProvider.generate({
        conversation,
        lead,
        goal,
        tone,
        language,
      });
      return { ...fallback, isLive: false };
    }
  },

  async rewrite({ text = "", style = "PROFESSIONAL" }) {
    const start = Date.now();
    try {
      const styleInstruction =
        {
          SHORTER: "Make it noticeably shorter while keeping the core message.",
          LONGER: "Expand it with a bit more helpful detail.",
          PROFESSIONAL: "Rewrite it in a more professional, polished tone.",
          FRIENDLY: "Rewrite it in a warmer, more friendly and casual tone.",
          PERSUASIVE:
            "Rewrite it to be more persuasive and compelling, without being pushy.",
          FORMAL: "Rewrite it in a formal, business-letter style tone.",
          EMPATHETIC: "Rewrite it to lead with empathy and understanding.",
          GRAMMAR:
            "Fix any grammar, spelling, or punctuation issues -- keep the meaning and tone exactly the same.",
          SIMPLIFY:
            "Simplify the language -- shorter words, simpler sentences, same meaning.",
        }[style] || "Rewrite it to be clearer and more polished.";

      const prompt = `Rewrite this WhatsApp message. ${styleInstruction}

ORIGINAL MESSAGE:
${text}

Return ONLY the rewritten message, ready to send as-is -- no explanation, no quotation marks, no markdown.`;

      const rewritten = await callGeminiText(prompt, apiKey);
      return {
        text: rewritten,
        provider: AI_PROVIDER.GEMINI,
        tokens: rewritten.split(" ").length,
        latency: Date.now() - start,
        isLive: true,
      };
    } catch (err) {
      console.warn(
        `[aiReplyAssistant] Gemini rewrite() failed, using mock fallback: ${err.message}`,
      );
      const fallback = await mockProvider.rewrite({ text, style });
      return { ...fallback, isLive: false };
    }
  },

  async summarize({ conversation = [], lead = {} }) {
    const start = Date.now();
    try {
      const history =
        Array.isArray(conversation) && conversation.length
          ? conversation
              .map(
                (m) =>
                  `${m.direction === "INBOUND" ? "Customer" : "Us"}: ${m.content || m.text || ""}`,
              )
              .join("\n")
          : "(no messages yet)";

      const prompt = `Summarize this WhatsApp conversation with ${lead.name || "a customer"} in 2-3 sentences. Include overall sentiment and a recommended next step.

CONVERSATION:
${history}

Return ONLY the summary text, no markdown, no headers.`;

      const summary = await callGeminiText(prompt, apiKey);
      return {
        summary,
        provider: AI_PROVIDER.GEMINI,
        tokens: summary.split(" ").length,
        latency: Date.now() - start,
        isLive: true,
      };
    } catch (err) {
      console.warn(
        `[aiReplyAssistant] Gemini summarize() failed, using mock fallback: ${err.message}`,
      );
      const fallback = await mockProvider.summarize({ conversation, lead });
      return { ...fallback, isLive: false };
    }
  },

  async suggestions({ conversation = [], lead = {} }) {
    const start = Date.now();
    try {
      const history =
        Array.isArray(conversation) && conversation.length
          ? conversation
              .map(
                (m) =>
                  `${m.direction === "INBOUND" ? "Customer" : "Us"}: ${m.content || m.text || ""}`,
              )
              .join("\n")
          : "(no messages yet)";

      const prompt = `Based on this WhatsApp conversation with ${lead.name || "a customer"}, suggest next steps.

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
        nextAction: result.nextAction || "",
        bookingSuggestion: result.bookingSuggestion || "",
        paymentSuggestion: result.paymentSuggestion || "",
        followUp: result.followUp || "",
        provider: AI_PROVIDER.GEMINI,
        latency: Date.now() - start,
        isLive: true,
      };
    } catch (err) {
      console.warn(
        `[aiReplyAssistant] Gemini suggestions() failed, using mock fallback: ${err.message}`,
      );
      const fallback = await mockProvider.suggestions({ conversation, lead });
      return { ...fallback, isLive: false };
    }
  },
});

/**
 * Provider factory.
 * Add new providers here — the rest of the service is unchanged.
 *
 * Real Gemini is used whenever a usable API key is available -- checked
 * in order: the tenant's OWN key (Integrations → Google Gemini), then the
 * server-wide GEMINI_API_KEY env var. Explicitly setting AI_PROVIDER=MOCK
 * still forces mock even with a key present, for local testing without
 * burning real API calls.
 */
async function getProvider(ctx, name = ACTIVE_AI_PROVIDER) {
  if (name === AI_PROVIDER.MOCK) {
    return mockProvider;
  }

  const apiKey = await resolveGeminiApiKey(ctx);
  if (apiKey) {
    return createGeminiProvider(apiKey);
  }

  return mockProvider;
}

// ── Service ────────────────────────────────────────────────────────────────────

export const aiReplyAssistantService = {
  // ── Prompt CRUD ────────────────────────────────────────────────────────────

  async createPrompt(ctx, data) {
    const prompt = await aiReplyAssistantRepository.createPrompt({
      ...data,
      tenantId: ctx.tenantId,
      isSystem: data.isSystem === true ? true : false,
      isActive: true,
      usageCount: 0,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    });
    return toDTO(prompt);
  },

  async getPrompt(ctx, id) {
    const prompt = await aiReplyAssistantRepository.findPromptById(
      ctx.tenantId,
      id,
    );
    if (!prompt) throw new AppError(404, "Prompt not found");
    return toDTO(prompt);
  },

  async listPrompts(ctx, query) {
    const filter = buildFilter(query);
    const sort = buildSort(query.sort);
    const { page, limit, skip } = paging(query);
    const [items, total] = await Promise.all([
      aiReplyAssistantRepository.listPrompts(ctx.tenantId, filter, {
        sort,
        skip,
        limit,
      }),
      aiReplyAssistantRepository.countPrompts(ctx.tenantId, filter),
    ]);
    return {
      data: items.map(toDTO),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  },

  async updatePrompt(ctx, id, patch) {
    const existing = await aiReplyAssistantRepository.findPromptById(
      ctx.tenantId,
      id,
    );
    if (!existing) throw new AppError(404, "Prompt not found");
    patch.updatedBy = ctx.userId;
    const updated = await aiReplyAssistantRepository.updatePrompt(
      ctx.tenantId,
      id,
      patch,
    );
    return toDTO(updated);
  },

  async deletePrompt(ctx, id) {
    const existing = await aiReplyAssistantRepository.findPromptById(
      ctx.tenantId,
      id,
    );
    if (!existing) throw new AppError(404, "Prompt not found");
    if (existing.isSystem)
      throw new AppError(403, "System prompts cannot be deleted");
    await aiReplyAssistantRepository.softDeletePrompt(ctx.tenantId, id);
    return { id: String(existing._id), deleted: true };
  },

  async duplicatePrompt(ctx, id) {
    const source = await aiReplyAssistantRepository.findPromptById(
      ctx.tenantId,
      id,
    );
    if (!source) throw new AppError(404, "Prompt not found");
    const src = source.toObject ? source.toObject() : source;
    const clone = await aiReplyAssistantRepository.createPrompt({
      tenantId: ctx.tenantId,
      title: `${src.title} (Copy)`,
      description: src.description,
      category: src.category,
      prompt: src.prompt,
      tone: src.tone,
      languageCode: src.languageCode,
      isSystem: false, // copies are never system prompts
      isActive: true,
      usageCount: 0,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    });
    return toDTO(clone);
  },

  async togglePrompt(ctx, id) {
    const existing = await aiReplyAssistantRepository.findPromptById(
      ctx.tenantId,
      id,
    );
    if (!existing) throw new AppError(404, "Prompt not found");
    const newState = !existing.isActive;
    const updated = await aiReplyAssistantRepository.toggleActive(
      ctx.tenantId,
      id,
      newState,
    );
    return toDTO(updated);
  },

  async usePrompt(ctx, id) {
    const existing = await aiReplyAssistantRepository.findPromptById(
      ctx.tenantId,
      id,
    );
    if (!existing) throw new AppError(404, "Prompt not found");
    if (!existing.isActive) throw new AppError(409, "Prompt is inactive");
    const updated = await aiReplyAssistantRepository.incrementUsageCount(
      ctx.tenantId,
      id,
    );
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

  async generateReply(
    ctx,
    { conversation, lead, goal, tone, language, variables = {} },
  ) {
    const provider = await getProvider(ctx);
    const result = await provider.generate({
      conversation,
      lead,
      goal,
      tone,
      language,
    });
    // Replace variables in the generated text.
    result.text = interpolate(result.text, {
      ...this._leadVariables(lead),
      ...variables,
    });
    result.generatedReply = result.text;
    delete result.text;
    return result;
  },

  async rewriteText(ctx, { text, style, variables = {} }) {
    const provider = await getProvider(ctx);
    const result = await provider.rewrite({ text, style });
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
    const result = await provider.suggestions({ conversation, lead });
    // Interpolate variables into all text fields.
    const vars = { ...this._leadVariables(lead), ...variables };
    result.nextAction = interpolate(result.nextAction, vars);
    result.bookingSuggestion = interpolate(result.bookingSuggestion, vars);
    result.paymentSuggestion = interpolate(result.paymentSuggestion, vars);
    result.followUp = interpolate(result.followUp, vars);
    return result;
  },

  // ── Save-as-template (delegates to Templates service) ──────────────────────

  async saveAsTemplate(ctx, { generatedReply, templateData = {} }) {
    if (!generatedReply) throw new AppError(400, "generatedReply is required");
    const data = {
      name: templateData.name || "AI Generated Reply",
      category: templateData.category || "MARKETING",
      languageCode: templateData.languageCode || "en",
      body: generatedReply,
      description:
        templateData.description || "Created from AI Reply Assistant",
      provider: templateData.provider || "SIMULATION",
      ...templateData,
    };
    return templatesService.createTemplate(ctx, data);
  },

  // ── Save-as-prompt (creates a prompt from a generated reply) ───────────────

  async saveAsPrompt(
    ctx,
    { text, title, category, tone, languageCode, description },
  ) {
    if (!text) throw new AppError(400, "text is required");
    if (!title) throw new AppError(400, "title is required");
    return this.createPrompt(ctx, {
      title,
      description: description || "",
      category: category || PROMPT_CATEGORY.CUSTOM,
      prompt: text,
      tone: tone || TONE.PROFESSIONAL,
      languageCode: languageCode || "en",
    });
  },

  // ── Internal helper: build variable map from a lead object ─────────────────

  _leadVariables(lead = {}) {
    return {
      lead_name: lead.name || lead.lead_name || "",
      company_name: lead.company || lead.company_name || "",
      sales_rep_name: lead.salesRep || lead.sales_rep_name || "",
      lead_problem: lead.problem || lead.lead_problem || "",
      qualification_score: lead.score || lead.qualification_score || "",
    };
  },
};