/**
 * Real Attribution types -- match the backend exactly.
 *
 * Standard envelope. No toJSON transform on TrackingEvent -- raw `_id`.
 * lead_id is populated with { _id, name, email, source } on recent events.
 *
 * GET /api/attribution/dashboard returns everything this page needs in ONE
 * call (kpis + all 4 charts + breakdown table + recent events) -- built
 * that way deliberately on the backend for the initial page load, so this
 * integration uses it instead of firing 6 separate requests.
 */

export type TrackingEventType =
  | 'Page View' | 'Form Submitted' | 'WhatsApp Click' | 'WhatsApp Inbound Message'
  | 'WhatsApp Outbound Message' | 'Lead Created' | 'AI Qualified' | 'Booking Created'
  | 'Call Completed' | 'Proposal Sent' | 'Payment Created' | 'Payment Completed'
  | 'Deal Won' | 'Deal Lost' | 'Nurture Step Sent' | 'Pipeline Stage Changed'
  | 'Campaign Sent' | 'Broadcast Sent';

export interface EventLeadRef {
  _id: string;
  name: string;
  email: string;
  source: string;
}

export interface TrackingEvent {
  _id: string;
  tenant_id: string;
  event_type: TrackingEventType;
  lead_id: EventLeadRef | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  provider_name: string | null;
  lifecycle_stage: string | null;
  revenue: number;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** GET /api/attribution/kpis -- SOURCE: attribution.repository.js getKpiCounts. */
export interface AttributionKpis {
  totalEvents: number;
  attributedRevenue: number;
  topSource: string;
  uniqueSources: number;
}

export interface SourceCount {
  source: string;
  count: number;
}

export interface SourceRevenue {
  source: string;
  revenue: number;
  count: number;
}

export interface EventTypeCount {
  event_type: TrackingEventType;
  count: number;
}

/** SOURCE: attribution.repository.js getSourceToRevenueBreakdown. */
export interface SourceToRevenueRow {
  source: string;
  leads: number;
  qualified: number;
  booked: number;
  calls: number;
  revenue: number;
  booking_conversion: number;
}

export interface AttributionFilter {
  event_type?: TrackingEventType;
  source?: string;
  campaign?: string;
  date_from?: string;
  date_to?: string;
}

/** GET /api/attribution/dashboard -- the full page-load bundle. */
/** SOURCE: attribution.service.js getAdSpendSummary() -- real, synced Google Ads campaign data. */
export interface AdSpendCampaign {
  campaignId: string;
  campaignName: string;
  status: string | null;
  channelType: string | null;
  /** Always the workspace's own display currency (Settings' currency
   * selector) -- real conversion happens server-side, this is never the
   * ad account's own raw billing currency. */
  currency: string;
  /** Real, unconverted figures the ad platform actually reported, in
   * ITS OWN billing currency -- kept for transparency/audit. */
  spendOriginal: number;
  currencyOriginal: string | null;
  /** Real rate used to convert spendOriginal -> spend, or null if a
   * conversion was needed but couldn't be resolved right now. */
  exchangeRate: number | null;
  /** True only when a real conversion was needed but genuinely could
   * not be resolved right now (rate service unreachable, no cached
   * fallback) -- `roas` is null and `spend`/`conversionsValue` reflect
   * the UNCONVERTED original in this case. */
  currencyMismatch: boolean;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  conversionsValue: number;
  matchedRevenue: number | null;
  roas: number | null;
  syncedAt: string;
}

export interface AdSpendSummary {
  connected: boolean;
  /** Real workspace display currency every figure below is denominated
   * in (Settings' currency selector) -- present even when connected is
   * false is not guaranteed, only meaningful alongside real campaigns. */
  currency?: string;
  totalSpend: number;
  totalConversions: number;
  /** Real accounting for campaigns whose spend could NOT be safely
   * converted (unknown ad-account currency, or exchange rate genuinely
   * unavailable right now) -- their spend is shown on their own row but
   * deliberately excluded from totalSpend above to avoid a meaningless
   * mixed-currency sum. Empty/zero when every campaign converted fine. */
  excludedFromTotal?: { count: number; campaignNames: string[] };
  lastSyncedAt: string | null;
  campaigns: AdSpendCampaign[];
}

export interface AttributionDashboard {
  kpis: AttributionKpis;
  leadsBySource: SourceCount[];
  revenueBySource: SourceRevenue[];
  bookingsBySource: SourceCount[];
  eventsByType: EventTypeCount[];
  sourceToRevenue: SourceToRevenueRow[];
  recentEvents: TrackingEvent[];
  adSpend: AdSpendSummary;
}

/** GET /api/attribution/export row shape -- SOURCE: attribution.controller.js exportCsv. */
export interface AttributionExportRow {
  event_type: string;
  lead_name: string;
  lead_email: string;
  source: string;
  medium: string;
  campaign: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  provider_name: string;
  revenue: number;
  created_at: string;
}