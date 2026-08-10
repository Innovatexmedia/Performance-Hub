import { useEffect } from 'react';
import { getSocket } from '@/lib/socket';
import type { Conversation, Message } from '@/types/whatsapp';
import type { WhatsAppTemplate } from '@/types/whatsappTemplate';
import type { DeliveryLog } from '@/types/whatsappDeliveryLog';
import type { Consent, ConsentStatus } from '@/types/whatsappConsent';
import type { WhatsAppCampaign } from '@/types/whatsappCampaign';

interface UseWhatsAppRealtimeOptions {
  onMessage?: (payload: { conversationId: string; message: Message }) => void;
  onConversation?: (payload: { conversation: Conversation }) => void;
  onTemplate?: (payload: { templateId: string; template: WhatsAppTemplate }) => void;
  onDeliveryLog?: (payload: { deliveryLogId: string; deliveryLog: DeliveryLog }) => void;
  /**
   * Fires on 'whatsapp:consent' -- emitted by consent.service.js on every
   * status-changing action (opt-in/opt-out/block/unblock/create, plus the
   * silent server-side auto-expiry). `previousStatus` is included
   * specifically so the receiver can call the same local
   * bump(toStatus, fromStatus) it already uses for its own actions --
   * zero extra fetch needed to reflect another user's change.
   */
  onConsent?: (payload: { consentId: string; consent: Consent; previousStatus: ConsentStatus | null }) => void;
  /**
   * Fires on 'whatsapp:campaign' -- emitted by campaignSender.service.js
   * on every per-recipient send AND on the final auto COMPLETED/FAILED
   * transition, so a campaign card can update live while it's running,
   * not just after a manual reload.
   */
  onCampaign?: (payload: { campaignId: string; campaign: WhatsAppCampaign }) => void;
  /** Same as onCampaign, but for the separate Broadcasts resource. */
  onBroadcast?: (payload: { broadcastId: string; broadcast: WhatsAppCampaign }) => void;
}

/**
 * useWhatsAppRealtime -- subscribes to the 'whatsapp:message',
 * 'whatsapp:conversation', 'whatsapp:template', 'whatsapp:deliveryLog',
 * 'whatsapp:consent', 'whatsapp:campaign', and 'whatsapp:broadcast' events
 * (see src/realtime/socket.js). The socket itself is a tenant-scoped
 * singleton connected once at login (authStore.ts) -- this hook only
 * attaches/detaches listeners.
 */
export function useWhatsAppRealtime({ onMessage, onConversation, onTemplate, onDeliveryLog, onConsent, onCampaign, onBroadcast }: UseWhatsAppRealtimeOptions): void {
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleMessage = (payload: { conversationId: string; message: Message }) => onMessage?.(payload);
    const handleConversation = (payload: { conversation: Conversation }) => onConversation?.(payload);
    const handleTemplate = (payload: { templateId: string; template: WhatsAppTemplate }) => onTemplate?.(payload);
    const handleDeliveryLog = (payload: { deliveryLogId: string; deliveryLog: DeliveryLog }) => onDeliveryLog?.(payload);
    const handleConsent = (payload: { consentId: string; consent: Consent; previousStatus: ConsentStatus | null }) => onConsent?.(payload);
    const handleCampaign = (payload: { campaignId: string; campaign: WhatsAppCampaign }) => onCampaign?.(payload);
    const handleBroadcast = (payload: { broadcastId: string; broadcast: WhatsAppCampaign }) => onBroadcast?.(payload);

    if (onMessage) socket.on('whatsapp:message', handleMessage);
    if (onConversation) socket.on('whatsapp:conversation', handleConversation);
    if (onTemplate) socket.on('whatsapp:template', handleTemplate);
    if (onDeliveryLog) socket.on('whatsapp:deliveryLog', handleDeliveryLog);
    if (onConsent) socket.on('whatsapp:consent', handleConsent);
    if (onCampaign) socket.on('whatsapp:campaign', handleCampaign);
    if (onBroadcast) socket.on('whatsapp:broadcast', handleBroadcast);

    return () => {
      socket.off('whatsapp:message', handleMessage);
      socket.off('whatsapp:conversation', handleConversation);
      socket.off('whatsapp:template', handleTemplate);
      socket.off('whatsapp:deliveryLog', handleDeliveryLog);
      socket.off('whatsapp:consent', handleConsent);
      socket.off('whatsapp:campaign', handleCampaign);
      socket.off('whatsapp:broadcast', handleBroadcast);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onMessage, onConversation, onTemplate, onDeliveryLog, onConsent, onCampaign, onBroadcast]);
}