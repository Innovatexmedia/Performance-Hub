import { apiClient } from '@/lib/apiClient';

export interface PublicCaptureInput {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  notes?: string;
  segment?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  /** Real ad-group/ad-set, ad, and click identifiers -- automatically
   * filled in by each ad platform's own dynamic URL parameters. */
  ad_group_id?: string;
  ad_id?: string;
  click_id?: string;
}

export interface PublicCaptureResult {
  id: string;
  name: string;
}

/**
 * SOURCE: src/modules/leads/capture/publicCapture.controller.js
 * Hits a genuinely public (unauthenticated) backend surface -- no token
 * required or sent, same real pattern as publicCalcomApi.ts. Creates a
 * REAL Lead in the tenant's own database (previously this form only
 * ever wrote to browser localStorage -- see CaptureForm.tsx's own
 * comment on the real fix).
 */
export const publicCaptureApi = {
  /** POST /api/public/capture/:tenantId */
  submit: (tenantId: string, input: PublicCaptureInput) =>
    apiClient.post<PublicCaptureResult>(`/public/capture/${tenantId}`, input),
};
