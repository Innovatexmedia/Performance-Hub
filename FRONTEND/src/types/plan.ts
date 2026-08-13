/** Mirrors BACKEND/src/modules/plans/plan.model.js exactly. */

export type PlanTrack = 'full' | 'whatsapp_only';
export type PlanTier = 'starter' | 'mid' | 'premium';

export interface PlanLimits {
  maxUsers: number;
  maxLeads: number;
  maxCampaigns: number;
  maxWorkspaces: number;
}

export interface Plan {
  id: string;
  key: string;
  name: string;
  track: PlanTrack;
  tier: PlanTier;
  price: number;
  currency: string;
  limits: PlanLimits;
  isActive: boolean;
  isDefault: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlanInput {
  key: string;
  name: string;
  track: PlanTrack;
  tier: PlanTier;
  price?: number;
  limits: PlanLimits;
  isDefault?: boolean;
}

export type UpdatePlanInput = Partial<Pick<Plan, 'name' | 'price' | 'limits' | 'isActive' | 'isDefault' | 'sortOrder'>>;
