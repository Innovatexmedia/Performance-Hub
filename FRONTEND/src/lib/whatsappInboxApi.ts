import { apiClientRaw, requestFormDataRaw } from '@/lib/apiClient';
import type {
  Conversation, ConversationDetails, ConversationListQuery, ConversationListResult,
  ConversationNote, Message, MessageType, SendMessageResult, LoadOlderMessagesResult,
  UploadedMedia,
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

  /** Real infinite-scroll-up backing -- fetches messages strictly older than the given timestamp. */
  loadOlderMessages: (id: string, beforeCreatedAt: string) =>
    apiClientRaw.get<LoadOlderMessagesResult>(`/whatsapp/conversations/${id}/older-messages`, { before: beforeCreatedAt }),

  /** Real, safe entry point for "open WhatsApp for this lead" — used by the Lead Detail drawer's WhatsApp quick action. */
  findOrCreateForLead: (leadId: string) =>
    apiClientRaw.post<Conversation>(`/whatsapp/conversations/for-lead/${leadId}`),

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

  send: (conversationId: string, content: string, type: MessageType = 'text', media?: { url: string; filename?: string } | null) =>
    apiClientRaw.post<SendMessageResult>('/whatsapp/messages/send', { conversationId, content, type, media: media || undefined }),

  /** Uploads a file to durable storage (Cloudinary) BEFORE it's attached
   * to any message -- call this first, then pass the returned url into
   * send()'s `media` param. Separate from send() so the UI can show real
   * upload progress and a failed send doesn't mean re-uploading. */
  uploadMedia: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return requestFormDataRaw<UploadedMedia>('/whatsapp/messages/upload', formData);
  },

  simulateInbound: (conversationId: string, content: string, type: MessageType = 'text') =>
    apiClientRaw.post<{ message: Message; conversation: Conversation }>('/whatsapp/messages/simulate-inbound', { conversationId, content, type }),
};