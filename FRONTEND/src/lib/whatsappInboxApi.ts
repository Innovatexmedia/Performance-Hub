import { apiClientRaw } from '@/lib/apiClient';
import type {
  Conversation, ConversationDetails, ConversationListQuery, ConversationListResult,
  ConversationNote, Message, MessageType, SendMessageResult,
} from '@/types/whatsapp';

/**
 * SOURCE: src/modules/whatsapp/conversations/, messages/, notes/, tags/
 * Raw response family -- same convention as Leads/Pipeline (requestRaw).
 *
 * GET /api/whatsapp/inbox and GET /api/whatsapp/conversations are
 * functionally IDENTICAL -- confirmed from source, inbox.service.js just
 * calls the same filter builder and repository as conversations. Using
 * /conversations directly as the more canonical resource path.
 */
export const whatsappInboxApi = {
  listConversations: (query?: ConversationListQuery) =>
    apiClientRaw.get<ConversationListResult>('/whatsapp/conversations', query as Record<string, string | number | boolean | undefined>),

  getConversationDetails: (id: string) =>
    apiClientRaw.get<ConversationDetails>(`/whatsapp/conversations/${id}`),

  assignConversation: (id: string, userId: string) =>
    apiClientRaw.post<Conversation>(`/whatsapp/conversations/${id}/assign`, { userId }),

  changeStatus: (id: string, status: string) =>
    apiClientRaw.patch<Conversation>(`/whatsapp/conversations/${id}/status`, { status }),

  listNotes: (id: string) => apiClientRaw.get<ConversationNote[]>(`/whatsapp/conversations/${id}/notes`),

  addNote: (id: string, body: string) =>
    apiClientRaw.post<ConversationNote>(`/whatsapp/conversations/${id}/notes`, { body }),

  addTag: (id: string, tag: string) =>
    apiClientRaw.post<Conversation>(`/whatsapp/conversations/${id}/tags`, { tag }),

  removeTag: (id: string, tag: string) =>
    apiClientRaw.delete<Conversation>(`/whatsapp/conversations/${id}/tags/${encodeURIComponent(tag)}`),

  send: (conversationId: string, content: string, type: MessageType = 'text') =>
    apiClientRaw.post<SendMessageResult>('/whatsapp/messages/send', { conversationId, content, type }),

  simulateInbound: (conversationId: string, content: string, type: MessageType = 'text') =>
    apiClientRaw.post<{ message: Message; conversation: Conversation }>('/whatsapp/messages/simulate-inbound', { conversationId, content, type }),
};