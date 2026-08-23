import { apiClientRaw } from '@/lib/apiClient';
import type { Group, GroupInput, GroupListResult, AssignMembersResult } from '@/types/group';

export const groupsApi = {
  list: () => apiClientRaw.get<GroupListResult>('/leads/groups'),

  get: (id: string) => apiClientRaw.get<Group>(`/leads/groups/${id}`),

  create: (input: GroupInput) => apiClientRaw.post<Group>('/leads/groups', input),

  update: (id: string, patch: GroupInput) => apiClientRaw.patch<Group>(`/leads/groups/${id}`, patch),

  delete: (id: string) => apiClientRaw.delete<{ id: string; deleted: boolean }>(`/leads/groups/${id}`),

  assignMembers: (id: string, leadIds: string[]) =>
    apiClientRaw.post<AssignMembersResult>(`/leads/groups/${id}/assign`, { leadIds }),

  setMembers: (id: string, leadIds: string[]) =>
    apiClientRaw.put<AssignMembersResult>(`/leads/groups/${id}/members`, { leadIds }),
};