import { apiClient } from '@/lib/apiClient';
import type { SavedReply, SavedReplyInput } from '@/types/savedReply';

/**
 * SOURCE: BACKEND/src/modules/whatsapp/submodules/savedReplies/savedReplies.routes.js
 * Mounted at /api/whatsapp/saved-replies.
 */
export const savedRepliesApi = {
  list: () => apiClient.get<SavedReply[]>('/whatsapp/saved-replies'),

  create: (input: SavedReplyInput) => apiClient.post<SavedReply>('/whatsapp/saved-replies', input),

  update: (id: string, patch: SavedReplyInput) => apiClient.patch<SavedReply>(`/whatsapp/saved-replies/${id}`, patch),

  delete: (id: string) => apiClient.delete<{ id: string; deleted: boolean }>(`/whatsapp/saved-replies/${id}`),
};