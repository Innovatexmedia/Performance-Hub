import { apiClientRaw } from '@/lib/apiClient';
import type { Group, GroupInput, GroupListResult, AssignMembersResult } from '@/types/group';

/**
 * SOURCE: src/modules/leads/groups/group.routes.js
 * Mounted at /api/leads/groups (a static path composed into lead.routes.js
 * ahead of its '/:id' route). Raw JSON responses, no {success,data} wrapper
 * -- same convention as leadsApi.ts, since this lives in the Leads domain.
 */
export const groupsApi = {
  list: () => apiClientRaw.get<GroupListResult>('/leads/groups'),

  get: (id: string) => apiClientRaw.get<Group>(`/leads/groups/${id}`),

  create: (input: GroupInput) => apiClientRaw.post<Group>('/leads/groups', input),

  update: (id: string, patch: GroupInput) => apiClientRaw.patch<Group>(`/leads/groups/${id}`, patch),

  delete: (id: string) => apiClientRaw.delete<{ id: string; deleted: boolean }>(`/leads/groups/${id}`),

  /** Bulk-assign: sets group_id on every listed lead in one call. */
  assignMembers: (id: string, leadIds: string[]) =>
    apiClientRaw.post<AssignMembersResult>(`/leads/groups/${id}/assign`, { leadIds }),

  /** Full reconciliation for the checklist UI: leadIds is the COMPLETE
   * desired member list -- anything missing gets unassigned, not left alone. */
  setMembers: (id: string, leadIds: string[]) =>
    apiClientRaw.put<AssignMembersResult>(`/leads/groups/${id}/members`, { leadIds }),
};