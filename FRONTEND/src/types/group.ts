/**
 * SOURCE: src/modules/leads/groups/{group.model.js, group.service.js, group.controller.js}
 * Same "raw body, no envelope" convention as the rest of the Leads domain
 * -- see lead.ts's header comment for why. Consumed via apiClientRaw.
 */

export interface Group {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Always computed live against Lead.group_ids (multi-membership array)
   * -- never stored/stale. */
  memberCount: number;
}

export interface GroupInput {
  name?: string;
  description?: string;
}

export interface GroupListResult {
  data: Group[];
}

export interface AssignMembersResult {
  id: string;
  matched: number;
}