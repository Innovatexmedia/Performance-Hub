/**
 * Real Campaign (marketing) types -- match the backend exactly.
 *
 * Standard envelope. No toJSON transform -- raw `_id`.
 * SOURCE: src/modules/campaigns/campaign.model.js + campaign.constants.js
 *
 * IMPORTANT: utm_tracking_link is generated and stored SERVER-SIDE on
 * create (campaign.service.js generateUtmLink()). The old mock computed
 * this client-side via string interpolation -- this integration uses the
 * real stored value instead, since that's always correct even if the
 * backend's generation format changes.
 */

export type CampaignStatus =
  | 'Draft' | 'Pending Approval' | 'Approved' | 'Scheduled' | 'Sending'
  | 'Sent' | 'Paused' | 'Completed' | 'Failed';

export const CAMPAIGN_STATUS_VALUES: CampaignStatus[] = [
  'Draft', 'Pending Approval', 'Approved', 'Scheduled', 'Sending', 'Sent', 'Paused', 'Completed', 'Failed',
];

export type CampaignType =
  | 'Paid Ads' | 'Retargeting' | 'Email' | 'ABM' | 'Organic' | 'Referral' | 'Social' | 'Webinar' | 'Content';

export const CAMPAIGN_TYPE_VALUES: CampaignType[] = [
  'Paid Ads', 'Retargeting', 'Email', 'ABM', 'Organic', 'Referral', 'Social', 'Webinar', 'Content',
];

export type CampaignSource =
  | 'Meta Ads' | 'Google Ads' | 'YouTube' | 'LinkedIn' | 'Organic'
  | 'Cold Outreach' | 'Webinar' | 'Referral' | 'WhatsApp' | 'Email';

export const CAMPAIGN_SOURCE_VALUES: CampaignSource[] = [
  'Meta Ads', 'Google Ads', 'YouTube', 'LinkedIn', 'Organic', 'Cold Outreach', 'Webinar', 'Referral', 'WhatsApp', 'Email',
];

export type CampaignMedium = 'paid' | 'organic' | 'email' | 'social' | 'referral' | 'direct';

export const CAMPAIGN_MEDIUM_VALUES: CampaignMedium[] = ['paid', 'organic', 'email', 'social', 'referral', 'direct'];

export interface Campaign {
  _id: string;
  tenant_id: string;
  campaign_name: string;
  source: CampaignSource;
  medium: CampaignMedium;
  campaign_type: CampaignType;
  status: CampaignStatus;
  budget: number;
  spend: number;
  revenue: number;
  leads_generated: number;
  bookings: number;
  start_date: string | null;
  end_date: string | null;
  utm_tracking_link: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/** POST body -- campaign_name, source, campaign_type required; regex: letters/numbers/_/-/spaces only. */
export interface CampaignInput {
  campaign_name: string;
  source: CampaignSource;
  campaign_type: CampaignType;
  medium?: CampaignMedium;
  budget?: number;
  start_date?: string;
  end_date?: string;
}

export interface CampaignListQuery {
  status?: CampaignStatus;
  source?: CampaignSource;
  campaign_type?: CampaignType;
  page?: number;
  limit?: number;
}

/** GET /api/campaigns/kpis -- SOURCE: campaign.repository.js getKpiCounts. */
export interface CampaignKpis {
  totalCampaigns: number;
  totalSpend: number;
  totalRevenue: number;
  blendedRoas: number;
  totalBudget: number;
  totalLeads: number;
  totalBookings: number;
}

/** GET /api/campaigns/chart row -- partial projection, all campaigns (not paginated). */
export interface CampaignChartRow {
  _id: string;
  campaign_name: string;
  revenue: number;
  spend: number;
  leads_generated: number;
  bookings: number;
  status: CampaignStatus;
}