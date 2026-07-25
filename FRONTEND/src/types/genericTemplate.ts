/**
 * Real Generic Template types -- match the backend exactly.
 *
 * Standard envelope. SOURCE: src/modules/templates/template.model.js +
 * .constants.js. Confirmed fully spec-aligned across all 3 spec docs --
 * every word in MASTER_SPEC.md B15's bullet ("create/edit/duplicate/
 * delete/version/copy") maps to a real endpoint. No backend changes
 * needed for this module (unlike Campaigns/Automations).
 *
 * Registered on the backend as 'GenericTemplate' -- explicitly distinct
 * from 'WhatsAppTemplate' (the WhatsApp Panel's Meta-approval template
 * system, a completely separate module deliberately left untouched here).
 */

export type TemplateType = 'Email' | 'Qualification Script' | 'Follow-Up' | 'Proposal Outline' | 'Call Summary Format';
export const TEMPLATE_TYPE_VALUES: TemplateType[] = ['Email', 'Qualification Script', 'Follow-Up', 'Proposal Outline', 'Call Summary Format'];

export type TemplateScope = 'tenant' | 'global';
export const TEMPLATE_SCOPE_VALUES: TemplateScope[] = ['tenant', 'global'];

export interface VersionEntry {
  version: number;
  content: string;
  updated_at: string;
  updated_by: string | null;
}

export interface GenericTemplate {
  id: string;
  tenant_id: string | null;
  scope: TemplateScope;
  type: TemplateType;
  name: string;
  description: string;
  content: string;
  version: number;
  version_history: VersionEntry[];
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTemplateInput {
  name: string;
  type: TemplateType;
  content: string;
  description?: string;
  scope?: TemplateScope;
}

export interface UpdateTemplateInput {
  name?: string;
  type?: TemplateType;
  content?: string;
  description?: string;
}

export interface TemplateListQuery {
  type?: TemplateType;
  scope?: TemplateScope;
  search?: string;
  page?: number;
  limit?: number;
}

export interface TemplateCounts {
  total: number;
  byType: Partial<Record<TemplateType, number>>;
}

export interface VersionEntryWithCurrent extends VersionEntry {
  current: boolean;
}

/** GET /:id/versions response -- confirmed exact shape from real service code. */
export interface TemplateVersionsResult {
  versions: VersionEntryWithCurrent[];
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}