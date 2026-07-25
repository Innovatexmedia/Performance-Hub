/**
 * Real Reports types -- match the (now spec-aligned) backend exactly.
 *
 * SOURCE: src/modules/reports/report.service.js
 *
 * Standard envelope. All 9 tabs are GET-only, read directly against
 * report.repository.js aggregations (or reuse Attribution/WhatsApp
 * Analytics services directly for those 2 tabs).
 *
 * THREE BACKEND FIXES made before this integration, to match what the
 * actual frontend (verified against the real Reports.tsx source, matching
 * the reference screenshot) needs -- MASTER_SPEC/DEVELOPER_HANDOFF only say
 * "KPIs + charts + table" generically, without naming exact fields, so
 * these weren't spec VIOLATIONS the way Campaigns' extra endpoints were --
 * just gaps versus what the real frontend actually renders:
 *   1. Lead report KPIs was missing hotLeads + qualifiedLeads entirely.
 *   2. AI Qualification KPIs was missing hotLeads. The old mock's
 *      "Conversion (hot)" was a literal hardcoded "34%" fake constant --
 *      NOT reproduced. Replaced with a real computed hotConversionRate
 *      (applied-rate among Hot-temperature qualifications specifically).
 *   3. WhatsApp report KPIs had no revenue field at all -- added a real
 *      aggregation over WhatsAppCampaign.revenueGenerated.
 */

export type ReportTab =
  | 'lead' | 'pipeline' | 'attribution' | 'whatsapp' | 'campaign'
  | 'revenue' | 'sales-activity' | 'nurture' | 'ai-qualification';

export const REPORT_TABS: { id: ReportTab; label: string }[] = [
  { id: 'lead', label: 'Lead' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'attribution', label: 'Attribution' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'campaign', label: 'Campaign' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'sales-activity', label: 'Sales Activity' },
  { id: 'nurture', label: 'Nurture' },
  { id: 'ai-qualification', label: 'AI Qualification' },
];

export interface ReportFilter {
  date_from?: string;
  date_to?: string;
  source?: string;
}

export interface NameValue {
  name: string;
  value: number;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface LeadReport {
  kpis: { totalLeads: number; wonLeads: number; hotLeads: number; qualifiedLeads: number; conversionRate: number; avgQualificationScore: number };
  charts: {
    byStatus: { status: string; count: number }[];
    bySource: { source: string; count: number }[];
    byTemperature: { temperature: string; count: number }[];
    trend: { date: string; count: number }[];
  };
  table: { rows: { name: string; email: string; company: string; source: string; status: string; lead_temperature: string; qualification_score: number; value: number; created_at: string }[]; pagination: Pagination };
}

export interface PipelineReport {
  kpis: { totalDeals: number; pipelineValue: number; wonDeals: number; lostDeals: number; wonValue: number; winRate: number; avgDealSize: number };
  charts: { byStage: { stage: string; count: number; value: number }[] };
  table: { rows: { title: string; stage: string; value: number; probability: number; source: string; assigned_user_id: string | null; expected_close_date: string | null; created_at: string }[]; pagination: Pagination };
}

export interface AttributionReport {
  kpis: { totalEvents: number; attributedRevenue: number; topSource: string; uniqueSources: number };
  leadsBySource: { source: string; count: number }[];
  revenueBySource: { source: string; revenue: number; count: number }[];
  bookingsBySource: { source: string; count: number }[];
  eventsByType: { event_type: string; count: number }[];
  sourceToRevenue: { source: string; leads: number; qualified: number; booked: number; calls: number; revenue: number; booking_conversion: number }[];
  recentEvents: { _id: string; event_type: string; lead_id: { name: string } | null; source: string | null; campaign: string | null; created_at: string }[];
}

export interface WhatsAppReport {
  kpis: {
    totalConversations: number; activeConversations: number; closedConversations: number;
    totalContacts: number; totalMessages: number; incomingMessages: number; outgoingMessages: number;
    templates: number; campaigns: number; broadcasts: number; activeAutomations: number;
    activeNurtures: number; deliverySuccessRate: number; readRate: number; revenue: number;
  };
  charts: { messagesTrend: unknown[]; conversationsTrend: unknown[]; deliveriesTrend: unknown[] };
}

export interface CampaignReport {
  kpis: { totalCampaigns: number; totalBudget: number; totalSpend: number; totalRevenue: number; totalLeads: number; totalBookings: number; roas: number };
  charts: { byStatus: { status: string; count: number }[]; byType: { type: string; count: number; revenue: number }[] };
  table: { rows: { id: string; campaignName: string; source: string; medium: string; campaignType: string; status: string; budget: number; spend: number; revenue: number; leadsGenerated: number; bookings: number; roas: number; createdAt: string }[]; pagination: Pagination };
}

export interface RevenueReport {
  kpis: { totalRevenue: number; paidCount: number; pendingAmount: number; pendingCount: number; refundedAmount: number; refundedCount: number; avgPaymentSize: number };
  charts: {
    byStatus: { status: string; count: number; amount: number }[];
    byMethod: { method: string; count: number; amount: number }[];
    trend: { date: string; amount: number; count: number }[];
  };
  table: { rows: { id: string; leadName: string; leadEmail: string; amount: number; currency: string; paymentMethod: string; status: string; paymentDate: string | null; createdAt: string }[]; pagination: Pagination };
}

export interface SalesActivityReport {
  kpis: { totalAgents: number; totalCalls: number; totalBookings: number; totalDealsWon: number; mostActiveAgent: string | null };
  charts: {
    callsByAgent: { agent: string; count: number }[];
    bookingsByAgent: { agent: string; count: number }[];
    dealsWonByAgent: { agent: string; count: number }[];
  };
  table: { rows: { agentId: string; agentName: string; agentEmail: string; calls: number; avgCallScore: number; bookings: number; dealsWon: number; revenue: number; leadsAssigned: number; totalActivities: number }[] };
}

export interface NurtureReport {
  kpis: { activeFlows: number; completedFlows: number; contactsEnrolled: number; messagesSent: number; failures: number };
  charts: { enrollmentBreakdown: NameValue[] };
}

export interface AiQualificationReport {
  kpis: { totalQualifications: number; avgFitScore: number; applied: number; appliedRate: number; hotLeads: number; hotConversionRate: number };
  charts: {
    byTemperature: { temperature: string; count: number }[];
    byQuality: { quality: string; count: number }[];
    trend: { date: string; count: number; avgFitScore: number }[];
  };
  table: { rows: { id: string; leadName: string; leadEmail: string; fitScore: number; temperature: string; quality: string; buyingIntent: string; applied: boolean; createdAt: string }[]; pagination: Pagination };
}