import { apiClient } from '@/lib/apiClient';

/**
 * SOURCE: src/modules/whatsapp/submodules/aiReplyAssistant/{aiReplyAssistant.routes.js, .validator.js}
 * Mounted at /api/whatsapp/ai. Standard envelope (apiClient unwraps .data).
 */

export type ReplyGoal = '' | 'booking' | 'payment' | 'objection' | 'follow_up' | 'qualification';
export type ReplyTone = 'Professional' | 'Friendly' | 'Persuasive' | 'Formal' | 'Empathetic' | 'Urgent' | 'Casual';
export type RewriteStyle = 'SHORTER' | 'LONGER' | 'PROFESSIONAL' | 'FRIENDLY' | 'PERSUASIVE' | 'FORMAL' | 'EMPATHETIC' | 'GRAMMAR' | 'SIMPLIFY';

export interface GenerateReplyInput {
  goal?: ReplyGoal;
  tone?: ReplyTone;
  language?: string;
  /** Free-form context -- the message the customer sent, used as the last
   * turn of a single-message "conversation" for the AI's context. */
  conversation?: { direction: 'INBOUND' | 'OUTBOUND'; content: string }[];
  lead?: { name?: string; company?: string };
}

export interface GenerateReplyResult {
  generatedReply: string;
  provider: string;
  confidence?: number;
  tokens?: number;
  latency?: number;
  /** True if this genuinely came from Gemini; false if it fell back to the
   * canned mock (no API key configured, or Gemini call failed). */
  isLive: boolean;
}

export interface RewriteResult {
  rewritten: string;
  provider: string;
  tokens?: number;
  latency?: number;
  isLive: boolean;
}

export const aiReplyAssistantApi = {
  generate: (input: GenerateReplyInput) =>
    apiClient.post<GenerateReplyResult>('/whatsapp/ai/generate', input),

  rewrite: (text: string, style: RewriteStyle) =>
    apiClient.post<RewriteResult>('/whatsapp/ai/rewrite', { text, style }),
};