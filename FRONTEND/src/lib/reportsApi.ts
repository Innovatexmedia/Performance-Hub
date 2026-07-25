import { apiClient } from '@/lib/apiClient';
import type {
  ReportFilter, ReportTab, LeadReport, PipelineReport, AttributionReport, WhatsAppReport,
  CampaignReport, RevenueReport, SalesActivityReport, NurtureReport, AiQualificationReport,
} from '@/types/report';

/**
 * SOURCE: src/modules/reports/report.controller.js
 * Standard envelope -- each function returns the tab's data object directly.
 * Nurture does not accept date_from/date_to/source (no validateReportQuery
 * on that route server-side -- it reuses whatsappAnalyticsService.getNurtureAnalytics()
 * which doesn't support date filtering), so it takes no filter argument.
 */
export const reportsApi = {
  getLead: (filter?: ReportFilter) => apiClient.get<LeadReport>('/reports/lead', filter as Record<string, string | undefined>),
  getPipeline: (filter?: ReportFilter) => apiClient.get<PipelineReport>('/reports/pipeline', filter as Record<string, string | undefined>),
  getAttribution: (filter?: ReportFilter) => apiClient.get<AttributionReport>('/reports/attribution', filter as Record<string, string | undefined>),
  getWhatsApp: (filter?: ReportFilter) => apiClient.get<WhatsAppReport>('/reports/whatsapp', filter as Record<string, string | undefined>),
  getCampaign: (filter?: ReportFilter) => apiClient.get<CampaignReport>('/reports/campaign', filter as Record<string, string | undefined>),
  getRevenue: (filter?: ReportFilter) => apiClient.get<RevenueReport>('/reports/revenue', filter as Record<string, string | undefined>),
  getSalesActivity: (filter?: ReportFilter) => apiClient.get<SalesActivityReport>('/reports/sales-activity', filter as Record<string, string | undefined>),
  getNurture: () => apiClient.get<NurtureReport>('/reports/nurture'),
  getAiQualification: (filter?: ReportFilter) => apiClient.get<AiQualificationReport>('/reports/ai-qualification', filter as Record<string, string | undefined>),

  exportData: (tab: ReportTab, filter?: ReportFilter) =>
    apiClient.get<Record<string, unknown>[]>('/reports/export', { tab, ...filter } as Record<string, string | undefined>),
};