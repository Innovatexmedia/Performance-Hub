/**
 * SOURCE: BACKEND/src/modules/whatsapp/submodules/savedReplies/
 * Standard { success, message, data } envelope -- consumed via apiClient
 * (not apiClientRaw), same convention as the rest of the WhatsApp module.
 */

export interface SavedReply {
  id: string;
  tenantId: string;
  title: string;
  content: string;
  /** True for the 3 auto-seeded defaults (Greeting / Lead / Thanks-Won).
   * Informational only -- defaults can still be edited or deleted. */
  isDefault: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SavedReplyInput {
  title: string;
  content: string;
}