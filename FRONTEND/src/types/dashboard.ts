/**
 * Real Dashboard types -- match the backend exactly.
 *
 * Standard envelope. SOURCE: src/modules/dashboard/dashboard.service.js.
 * Confirmed: all 12 KPIs, all 7 charts, and all 4 sections match
 * MASTER_SPEC.md B2 / FRONTEND_SPEC.md §3 exactly.
 *
 * One genuine backend inconsistency found (not fixed, per instruction to
 * change nothing unasked): the leakageAlerts KPI's inline "booked not
 * paid" calc uses DEAL_STAGE.WON, while the separate getLeakageAlerts()
 * section (same concept) uses DEAL_STAGE.BOOKED_CALL -- the two numbers
 * can disagree.
 */

export interface KpiValue {
  value: number;
  change?: number | null;
  unit?: string;
  label?: string;
  breakdown?: { ghosted: number; idleProposals: number; bookedNotPaid: number };
}

export interface DashboardKpis {
  totalLeads: KpiValue;
  qualifiedLeads: KpiValue;
  hotLeads: KpiValue;
  bookedCalls: KpiValue;
  pipelineValue: KpiValue;
  revenueClosed: KpiValue;
  conversionRate: KpiValue;
  avgResponseTime: KpiValue;
  followUpCompletion: KpiValue;
  waConversations: KpiValue;
  waPendingReplies: KpiValue;
  leakageAlerts: KpiValue;
}

export interface SourceCount { source: string; count: number; }
export interface StageCount { stage: string; count: number; value: number; }
export interface FunnelStage { stage: string; count: number; }
export interface SourceRevenue { source: string; revenue: number; }
export interface DateCount { date: string; count: number; }
export interface CampaignPerf { campaign_name: string; leads_generated: number; bookings: number; revenue: number; spend?: number; }

export interface DashboardCharts {
  leadsBySource: SourceCount[];
  pipelineByStage: StageCount[];
  conversionFunnel: FunnelStage[];
  revenueBySource: SourceRevenue[];
  bookingTrend: DateCount[];
  waConversationTrend: DateCount[];
  campaignPerformance: CampaignPerf[];
}

export interface TrackingActivityEvent {
  _id: string;
  event_type: string;
  source: string;
  created_at: string;
  lead_id: { name: string; email: string; source: string } | string | null;
}

export interface TopCampaign {
  _id: string;
  campaign_name: string;
  leads_generated: number;
  bookings: number;
  revenue: number;
}

export interface LeakageAlerts {
  total: number;
  items: { type: string; label: string; count: number }[];
}

export interface WeeklyBriefing {
  briefing: string;
  isAiLive: boolean;
}

export interface DashboardData {
  kpis: DashboardKpis;
  charts: DashboardCharts;
  recentActivity: TrackingActivityEvent[];
  topCampaigns: TopCampaign[];
  leakageAlerts: LeakageAlerts;
  weeklyBriefing: WeeklyBriefing;
}