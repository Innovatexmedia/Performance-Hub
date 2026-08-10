import { apiClient } from '@/lib/apiClient';

/** SOURCE: src/modules/tenant/{tenantProfile.routes.js, tenantProfile.constants.js} */

export type BusinessType =
  | 'agency' | 'edtech' | 'coaching' | 'healthcare' | 'ecommerce'
  | 'real_estate' | 'fitness' | 'finance' | 'saas' | 'other';

export const BUSINESS_TYPE_OPTIONS: { value: BusinessType; label: string }[] = [
  { value: 'agency', label: 'Agency' },
  { value: 'edtech', label: 'EdTech' },
  { value: 'coaching', label: 'Coaching' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'ecommerce', label: 'E-commerce' },
  { value: 'real_estate', label: 'Real Estate' },
  { value: 'fitness', label: 'Fitness' },
  { value: 'finance', label: 'Finance' },
  { value: 'saas', label: 'SaaS' },
  { value: 'other', label: 'Other' },
];

export interface BusinessProfile {
  name: string;
  description: string;
  businessType: BusinessType;
  industry: string;
}

export interface UpdateBusinessProfileInput {
  description?: string;
  businessType?: BusinessType;
  industry?: string;
}

export const tenantProfileApi = {
  get: () => apiClient.get<BusinessProfile>('/tenant/profile'),
  update: (input: UpdateBusinessProfileInput) => apiClient.patch<BusinessProfile>('/tenant/profile', input),
};