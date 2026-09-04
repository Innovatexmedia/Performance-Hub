import { apiClient } from '@/lib/apiClient';
import type {
  TeamMember, TeamMemberProfile, TeamMembersResult, AddTeamMemberInput, MemberStatus,
  PermissionCatalogGroup,
} from '@/types/team';

/**
 * SOURCE: src/modules/team/team.controller.js
 * Standard envelope. `list()` below is the ORIGINAL lightweight version --
 * kept exactly as-is since Inbox/LeadDrawer already depend on it for name
 * lookups via useTeamMembers(). The full Team page uses the richer
 * functions below instead, added when the module was fully migrated.
 */
export interface TeamMemberSummary {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  role: string;
  status: 'active' | 'inactive';
}

interface TeamMembersListResult {
  members: TeamMemberSummary[];
  kpis: unknown;
}

export const teamApi = {
  /** Original lightweight version -- unchanged, still used by useTeamMembers() for name lookups. */
  list: () => apiClient.get<TeamMembersListResult>('/team').then((r) => r.members),

  /** Full version for the Team page -- includes KPIs and assignedLeads per member. */
  getAll: () => apiClient.get<TeamMembersResult>('/team'),

  get: (id: string) => apiClient.get<{ member: TeamMember }>(`/team/${id}`).then((r) => r.member),

  add: (input: AddTeamMemberInput) =>
    apiClient.post<{ member: TeamMemberProfile }>('/team', input).then((r) => r.member),

  updateRole: (id: string, role: string) =>
    apiClient.patch<{ member: TeamMemberProfile }>(`/team/${id}/role`, { role }).then((r) => r.member),

  setStatus: (id: string, status: MemberStatus) =>
    apiClient.patch<{ member: TeamMemberProfile }>(`/team/${id}/status`, { status }).then((r) => r.member),

  /** Owner-only. Member must already be inactive with zero assigned
   * leads -- the backend enforces both and returns a clear error
   * message if not, which the caller should surface as-is rather than
   * a generic failure toast. */
  deleteMember: (id: string) => apiClient.delete<void>(`/team/${id}`),

  /** GET /team/permissions/catalog -- every grantable permission, grouped + labeled. */
  getPermissionCatalog: () =>
    apiClient.get<{ catalog: PermissionCatalogGroup[] }>('/team/permissions/catalog').then((r) => r.catalog),

  /** Full replace of a member's permission set (not additive -- the modal always sends the complete desired list). */
  updatePermissions: (id: string, permissions: string[]) =>
    apiClient.patch<{ member: TeamMemberProfile }>(`/team/${id}/permissions`, { permissions }).then((r) => r.member),

  /** Powers "reset to role default" in the permissions modal. */
  getRoleDefaultPermissions: (role: string) =>
    apiClient.get<{ permissions: string[] }>(`/team/permissions/role-default/${role}`).then((r) => r.permissions),
};