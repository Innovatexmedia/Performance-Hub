/**
 * WhatsApp Campaigns & Broadcasts — frontend types.
 *
 * SOURCE (verified against real backend files, not assumed):
 *   BACKEND/src/modules/whatsapp/submodules/campaigns/{campaigns.model.js, campaigns.constants.js}
 *   BACKEND/src/modules/whatsapp/submodules/broadcasts/{broadcasts.model.js, broadcasts.constants.js}
 *
 * Campaigns and Broadcasts are two SEPARATE backend resources (separate
 * Mongo collections, separate routes) with an identical shape and lifecycle.
 * `resource` below picks which one a given API/hook call targets.
 */

export type CampaignResource = 'campaigns' | 'broadcasts';

/** Mirrors CAMPAIGN_STATUS / BROADCAST_STATUS (identical values on both). */
export type CampaignStatus =
  | 'DRAFT' | 'APPROVED' | 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/** Mirrors CAMPAIGN_TYPE (campaigns.constants.js). */
export type CampaignType =
  | 'MARKETING' | 'PROMOTIONAL' | 'BOOKING' | 'FOLLOW_UP' | 'PAYMENT'
  | 'REMINDER' | 'NURTURE' | 'BROADCAST' | 'CUSTOM';

/** Mirrors BROADCAST_TYPE (broadcasts.constants.js) -- a DIFFERENT list from CampaignType. */
export type BroadcastType =
  | 'MARKETING' | 'PROMOTIONAL' | 'ANNOUNCEMENT' | 'OFFER'
  | 'REMINDER' | 'FESTIVAL' | 'PRODUCT_UPDATE' | 'CUSTOM';

export interface AudienceFilters {
  groupId?: string;
  tags?: string[];
  source?: string;
  minimumScore?: number;
  maximumScore?: number;
  consentStatus?: string;
  optOutStatus?: string;
  assignedUserId?: string;
  status?: string;
  createdAfter?: string;
  createdBefore?: string;
  lastContactedAfter?: string;
  lastContactedBefore?: string;
}

export interface Audience {
  filters?: AudienceFilters;
  includedContacts?: string[];
  excludedContacts?: string[];
}

export interface CampaignMetrics {
  recipientCount: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  repliedCount: number;
  failedCount: number;
  /** Recipients skipped because they'd already opted out -- distinct
   * from failedCount (a real send attempt that errored). See BACKEND
   * campaigns.model.js's skippedCount comment. */
  skippedCount: number;
  bookingCount: number;
  paymentCount: number;
  revenueGenerated: number;
}

export interface CampaignAuditEntry {
  fromStatus: string | null;
  toStatus: string;
  action: string;
  performedBy: string | null;
  performedAt: string;
  comment: string;
}

export interface WhatsAppCampaign {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  type: CampaignType | BroadcastType;
  status: CampaignStatus;
  templateId: string | null;
  templateName: string;
  provider: string;
  audience: Audience;
  recipientCount: number;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  metrics: CampaignMetrics;
  auditLog: CampaignAuditEntry[];
  failureReason: string | null;
  isActive: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCampaignInput {
  name: string;
  description?: string;
  type: CampaignType | BroadcastType;
  templateId: string;
  audience?: Audience;
  scheduledAt?: string;
}

export type UpdateCampaignInput = Partial<CreateCampaignInput>;

export interface CampaignListQuery {
  page?: number;
  limit?: number;
  status?: CampaignStatus;
  type?: string;
  templateId?: string;
  search?: string;
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

export interface AudiencePreviewContact {
  id: string;
  name: string;
  phone: string;
  source: string;
  qualificationScore: number | null;
}

export interface AudiencePreview {
  recipientCount: number;
  /** Only present for Broadcasts -- Campaigns don't compute this breakdown. */
  excludedRecipientCount?: number;
  optedOutCount?: number;
  suppressedCount?: number;
  sample: AudiencePreviewContact[];
  sampleTruncated: boolean;
}