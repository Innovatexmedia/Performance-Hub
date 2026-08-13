import { apiClient } from '@/lib/apiClient';

/**
 * SOURCE: src/modules/whatsapp/submodules/whatsappAnalytics/{routes.js, controller.js, service.js}
 * Mounted at /api/whatsapp/analytics. Standard envelope (apiClient unwraps .data).
 *
 * Previously the "WhatsApp Analytics" tab computed everything client-side from
 * the local seed-data store (useDb()), so it never reflected real tenant data
 * and one chart (template performance) was literally Math.random(). This file
 * wires the tab up to the real, already-existing backend analytics module.
 */

export interface DashboardAnalytics {
  totalConversations: number;
  activeConversations: number;
  closedConversations: number;
  totalContacts: number;
  totalMessages: number;
  incomingMessages: number;
  outgoingMessages: number;
  templates: number;
  campaigns: number;
  broadcasts: number;
  activeAutomations: number;
  activeNurtures: number;
  deliverySuccessRate: number;
  readRate: number;
}

export interface MessageAnalytics {
  queued: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  expired: number;
  total: number;
  deliveryRate: number;
  readRate: number;
  failureRate: number;
  averageDeliveryTimeMs: number;
  averageDeliveryTimeSeconds: number;
}

export interface ConversationAnalytics {
  open: number;
  closed: number;
  unread: number;
  statusBreakdown: Record<string, number>;
  averageFirstResponseTime: number | null;
  averageResolutionTime: number | null;
  messagesPerConversation: number;
}

export interface CampaignAnalytics {
  totalCampaigns: number;
  running: number;
  scheduled: number;
  completed: number;
  failed: number;
  recipients: number;
  delivered: number;
  read: number;
  failedMessages: number;
  successRate: number;
}

export interface TemplateSummary {
  templateId: string;
  templateName: string;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  total: number;
  successRate: number;
}

export interface TemplateAnalytics {
  templateUsage: {
    templateId: string;
    templateName: string;
    category?: string;
    status?: string;
    usageCount: number;
  }[];
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  successRate: number;
  top10Templates: TemplateSummary[];
}

export type TrendPeriod = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface TrendPoint {
  period: string;
  total: number;
}

export interface Trends {
  period: TrendPeriod;
  messages: { period: string; total: number; inbound: number; outbound: number }[];
  conversations: TrendPoint[];
  deliveries: { period: string; delivered: number }[];
  reads: { period: string; read: number }[];
  campaigns: TrendPoint[];
  broadcasts: TrendPoint[];
}

export interface AnalyticsQuery {
  dateFrom?: string;
  dateTo?: string;
  provider?: string;
  // Index signature so this satisfies apiClient.get's generic query param
  // type (Record<string, string | number | boolean | undefined>) --
  // without it, every call site below fails to typecheck even though the
  // 3 named fields are all plain strings already.
  [key: string]: string | number | boolean | undefined;
}

export const whatsappAnalyticsApi = {
  dashboard: (query?: AnalyticsQuery) =>
    apiClient.get<DashboardAnalytics>('/whatsapp/analytics/dashboard', query),

  messages: (query?: AnalyticsQuery) =>
    apiClient.get<MessageAnalytics>('/whatsapp/analytics/messages', query),

  conversations: (query?: AnalyticsQuery) =>
    apiClient.get<ConversationAnalytics>('/whatsapp/analytics/conversations', query),

  campaigns: (query?: AnalyticsQuery) =>
    apiClient.get<CampaignAnalytics>('/whatsapp/analytics/campaigns', query),

  templates: (query?: AnalyticsQuery) =>
    apiClient.get<TemplateAnalytics>('/whatsapp/analytics/templates', query),

  trends: (period: TrendPeriod = 'DAILY', query?: AnalyticsQuery) =>
    apiClient.get<Trends>('/whatsapp/analytics/trends', { period, ...query }),
};