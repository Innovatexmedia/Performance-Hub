import { AppError } from '../../../shared/helpers/lead.helpers.js';
import { conversationRepository } from '../conversations/conversation.repository.js';
import { conversationService } from '../conversations/conversation.service.js';
import { emitToTenant } from '../../../realtime/socket.js';

async function ensureConversation(ctx, conversationId) {
  const conversation = await conversationRepository.findById(ctx.tenantId, conversationId);
  if (!conversation) throw AppError.notFound('Conversation not found');
  return conversation;
}

export const tagService = {
  async addTag(ctx, conversationId, tag) {
    const clean = String(tag || '').trim();
    if (!clean) throw AppError.badRequest('tag is required');
    await ensureConversation(ctx, conversationId);

    const updated = await conversationRepository.addTag(ctx.tenantId, conversationId, clean);
    const dto = conversationService.toConversationDTO(updated);
    emitToTenant(ctx.tenantId, 'whatsapp:conversation', { conversation: dto });
    return dto;
  },

  async removeTag(ctx, conversationId, tag) {
    const clean = String(tag || '').trim();
    if (!clean) throw AppError.badRequest('tag is required');
    await ensureConversation(ctx, conversationId);

    const updated = await conversationRepository.removeTag(ctx.tenantId, conversationId, clean);
    const dto = conversationService.toConversationDTO(updated);
    emitToTenant(ctx.tenantId, 'whatsapp:conversation', { conversation: dto });
    return dto;
  },
};