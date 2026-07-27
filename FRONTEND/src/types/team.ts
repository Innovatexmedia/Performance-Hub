/**
 * Real Team types -- match the backend exactly.
 *
 * Standard envelope. SOURCE: src/modules/team/team.service.js +
 * team.controller.js. Confirmed against real code, not assumed:
 *   - getTeamMembers/getTeamMember include `assignedLeads`
 *   - addTeamMember/updateRole/setStatus return User.getPublicProfile()
 *     directly, which does NOT include assignedLeads -- a genuinely
 *     different (slightly smaller) shape for the mutation endpoints.
 *
 * Roles here reuse AuthRole exactly -- validateAddMember explicitly
 * excludes 'super_admin' from the addable set (SOURCE: team.validator.js
 * comment: "Excludes super_admin -- cannot be assigned via team
 * management UI"), matching FRONTEND_SPEC §17's "(Super Admin protected)".
 */

import type { AuthRole } from './auth';

/** The 4 roles assignable via Team management -- deliberately excludes super_admin, per team.validator.js. */
export type AssignableRole = Exclude<AuthRole, 'super_admin'>;
export const ASSIGNABLE_ROLES: AssignableRole[] = ['tenant_owner', 'tenant_admin', 'sales_user', 'read_only_user'];

export type MemberStatus = 'active' | 'inactive';

/** Shape returned by GET /team and GET /team/:id -- includes assignedLeads. */
export interface TeamMember {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  role: AuthRole;
  status: MemberStatus;
  isActive: boolean;
  isEmailVerified: boolean;
  profileImage: string | null;
  lastLogin: string | null;
  createdAt: string;
  assignedLeads: number;
}

/** Shape returned by POST /team, PATCH /team/:id/role, PATCH /team/:id/status -- User.getPublicProfile(), no assignedLeads. */
export interface TeamMemberProfile {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phoneNumber: string | null;
  role: AuthRole;
  tenantId: string | null;
  profileImage: string | null;
  status: MemberStatus;
  isActive: boolean;
  isEmailVerified: boolean;
  permissions: string[];
  lastLogin: string | null;
  createdAt: string;
}

/** SOURCE: team.service.js buildKpis() -- exactly these 4 fields, no others. */
export interface TeamKpis {
  totalMembers: number;
  active: number;
  salesUsers: number;
  admins: number;
}

export interface TeamMembersResult {
  members: TeamMember[];
  kpis: TeamKpis;
}

/** POST /team body -- firstName, lastName, email, role required; password optional (SOURCE: team.validator.js). */
export interface AddTeamMemberInput {
  firstName: string;
  lastName: string;
  email: string;
  role: AssignableRole;
  password?: string;
}