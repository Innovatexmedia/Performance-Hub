/**
 * Real WhatsApp Delivery Logs types -- match the backend exactly.
 *
 * SOURCE: src/modules/whatsapp/submodules/deliveryLogs/
 *   deliveryLogs.model.js + .constants.js
 *
 * Standard envelope ({success, message, data}), with the LIST endpoint using
 * sendPaginated -- `pagination` is a TOP-LEVEL sibling of `data`, NOT nested
 * under meta.pagination (same convention as Templates). See
 * whatsappDeliveryLogsApi.ts for the custom fetch that handles this shape.
 *
 * NOTE: the model registers as 'WhatsAppDeliveryLogV2' (a separate, newer
 * model from a legacy 'WhatsAppDeliveryLog') -- irrelevant to the frontend,
 * just documented here in case the name is ever confusing elsewhere.
 */

export type DeliveryDirection = 'OUTBOUND' | 'INBOUND';

export type MessageType =
  | 'TEXT' | 'TEMPLATE' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'AUDIO'
  | 'LOCATION' | 'CONTACT' | 'STICKER' | 'INTERACTIVE' | 'BUTTON' | 'LIST' | 'REACTION';

export type DeliveryStatus =
  | 'QUEUED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'EXPIRED' | 'DELETED';

export const DELIVERY_STATUS_VALUES: DeliveryStatus[] = [
  'QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'EXPIRED', 'DELETED',
];

/** Only messages in one of these statuses can be retried (see RETRYABLE_STATUSES). */
export const RETRYABLE_STATUSES: DeliveryStatus[] = ['FAILED'];

export type FailureReason =
  | 'INVALID_NUMBER' | 'USER_BLOCKED' | 'OPTED_OUT' | 'RATE_LIMITED'
  | 'PROVIDER_ERROR' | 'NETWORK_ERROR' | 'INVALID_TEMPLATE' | 'MEDIA_ERROR' | 'UNKNOWN';

export type DeliveryProvider =
  | 'META_CLOUD' | 'WATI' | 'INTERAKT' | 'AISENSY' | 'GALLABOX'
  | 'TWILIO' | '360DIALOG' | 'CUSTOM_WEBHOOK' | 'SIMULATION';

export const DELIVERY_PROVIDER_VALUES: DeliveryProvider[] = [
  'META_CLOUD', 'WATI', 'INTERAKT', 'AISENSY', 'GALLABOX',
  'TWILIO', '360DIALOG', 'CUSTOM_WEBHOOK', 'SIMULATION',
];

export type DeliverySource =
  | 'CAMPAIGN' | 'BROADCAST' | 'NURTURE' | 'AI_REPLY' | 'AUTOMATION_RULE' | 'MANUAL_INBOX' | 'OTHER';

export interface WebhookEvent {
  status: string;
  timestamp: string;
  providerPayload: unknown;
  receivedAt: string;
}

export interface DeliveryLog {
  id: string;
  tenantId: string;
  messageId: string | null;
  conversationId: string | null;
  contactId: string | null;
  leadId: string | null;
  campaignId: string | null;
  broadcastId: string | null;
  automationRuleId: string | null;
  templateId: string | null;
  contactName: string;
  leadName: string;
  source: DeliverySource;
  provider: DeliveryProvider;
  providerMessageId: string | null;
  phoneNumber: string;
  direction: DeliveryDirection;
  messageType: MessageType;
  status: DeliveryStatus;
  failureReason: FailureReason | null;
  failureCode: string | null;
  retryCount: number;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  webhookEvents: WebhookEvent[];
  providerMetadata: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryLogListQuery {
  page?: number;
  limit?: number;
  status?: DeliveryStatus;
  provider?: DeliveryProvider;
  messageType?: MessageType;
  direction?: DeliveryDirection;
  source?: DeliverySource;
  campaignId?: string;
  broadcastId?: string;
  automationRuleId?: string;
  contactId?: string;
  leadId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface DeliveryLogStats {
  totalMessages: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  queued: number;
  sending: number;
  expired: number;
  deliveryRate: number;
  readRate: number;
  failureRate: number;
  retryCount: number;
}