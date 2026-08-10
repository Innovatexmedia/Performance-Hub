/**
 * Team Service — manages team members within a tenant.
 *
 * FILE: src/modules/team/team.service.js
 *
 * SOURCE: MASTER_SPEC.md §B17 Team:
 *   "Add user modal, inline role change, activate/deactivate,
 *    assigned-lead counts, last-active.
 *    Roles: Owner / Admin / Sales / Read-Only (Super Admin protected)."
 *
 * SOURCE: FRONTEND_SPEC.md §17:
 *   "KPI row + members table.
 *    Features: add user modal, inline role change, activate/deactivate,
 *    assigned-lead counts, last-active."
 *
 * SOURCE: FRONTEND_SPEC §17 table columns (from screenshot):
 *   User | Role (inline dropdown) | Status | Assigned Leads | Last Active | Actions (Deactivate)
 *
 * CONNECTED MODULES:
 *   User model       — all team operations use the existing User document
 *   Lead model       — assigned_user_id used to count assigned leads per user
 *   Auth module      — User.js, user.repository.js, roles.js, auth.constants.js
 *   Email service    — sends invite email when adding a new team member
 *   Notifications    — not needed for team operations
 */

import User             from '../auth/models/User.js';
import * as userRepo    from '../auth/repositories/user.repository.js';
import * as tenantRepo  from '../auth/repositories/tenant.repository.js';
import Membership, { MEMBERSHIP_STATUS } from '../auth/models/Membership.js';
import { Lead }         from '../leads/lead/lead.model.js';
import { AppError }     from '../../shared/helpers/lead.helpers.js';
import { ROLES, ROLE_HIERARCHY, isTenantScopedRole } from '../auth/constants/roles.js';
import { PERMISSIONS } from '../auth/constants/permissions.js';
import { getRolePermissions } from '../auth/constants/rolePermissions.js';
import { USER_STATUS, TOKEN_EXPIRY } from '../auth/constants/auth.constants.js';
import { hashPassword } from '../../utils/password.js';
import { generateSecureToken, hashToken } from '../../utils/crypto.js';
import * as tokenRepo    from '../auth/repositories/token.repository.js';
import { sendTeamInvite } from '../auth/services/email.service.js';
import { emitToUser } from '../../realtime/socket.js';

// =============================================================================
// PRIVATE HELPERS
// =============================================================================

const buildCtx = (reqUser) => ({
  tenantId: reqUser.tenantId,
  userId:   reqUser.sub,
  role:     reqUser.role,
});

/**
 * assertCanManageRole — prevents privilege escalation.
 * A tenant_admin cannot change someone to tenant_owner.
 * A tenant_owner cannot manage super_admin.
 * SOURCE: MASTER_SPEC §A4 RBAC matrix
 */
const assertCanManageRole = (requesterRole, targetRole) => {
  const requesterRank = ROLE_HIERARCHY[requesterRole] || 0;
  const targetRank    = ROLE_HIERARCHY[targetRole]    || 0;
  if (targetRank >= requesterRank) {
    throw AppError.forbidden(
      `You cannot assign a role equal to or higher than your own (${requesterRole})`
    );
  }
};

/**
 * getAssignedLeadCounts — returns lead count per user for a tenant.
 * Used to populate "Assigned Leads" column in the team table.
 * SOURCE: FRONTEND_SPEC §17 "assigned-lead counts"
 */
const getAssignedLeadCounts = async (tenantId, userIds) => {
  if (!userIds.length) return {};
  const counts = await Lead.aggregate([
    {
      $match: {
        tenant_id:        String(tenantId),
        assigned_user_id: { $in: userIds.map(String) },
        archived:         false,
      },
    },
    { $group: { _id: '$assigned_user_id', count: { $sum: 1 } } },
  ]);
  const map = {};
  counts.forEach(({ _id, count }) => { map[_id] = count; });
  return map;
};

// =============================================================================
// GET TEAM MEMBERS — with assigned lead counts
// =============================================================================

/**
 * getTeamMembers — all users in the tenant with their assigned lead counts.
 * SOURCE: FRONTEND_SPEC §17 Team Members table
 */
export const getTeamMembers = async (tenantId) => {
  const users = await userRepo.findByTenantId(tenantId);

  if (!users.length) return { members: [], kpis: buildKpis([]) };

  // Get assigned lead counts for all users in one aggregation query
  const userIds     = users.map((u) => String(u._id));
  const leadCounts  = await getAssignedLeadCounts(tenantId, userIds);

  const members = users.map((u) => ({
    id:              u._id,
    firstName:       u.firstName,
    lastName:        u.lastName,
    fullName:        u.fullName,
    email:           u.email,
    role:            u.role,
    status:          u.status,
    isActive:        u.isActive,
    isEmailVerified: u.isEmailVerified,
    profileImage:    u.profileImage,
    lastLogin:       u.lastLogin,
    createdAt:       u.createdAt,
    permissions:     u.permissions,
    assignedLeads:   leadCounts[String(u._id)] || 0,
  }));

  return { members, kpis: buildKpis(users) };
};

/**
 * buildKpis — computes the 4 KPI cards from the user list.
 * SOURCE: FRONTEND_SPEC §17 KPI row:
 *   Team Members | Active | Sales Users | Admins
 * Screenshot values: 5 | 5 | 1 | 3
 */
const buildKpis = (users) => ({
  totalMembers: users.length,
  active:       users.filter((u) => u.status === USER_STATUS.ACTIVE).length,
  salesUsers:   users.filter((u) => u.role   === ROLES.SALES_USER).length,
  admins:       users.filter((u) =>
    u.role === ROLES.TENANT_ADMIN || u.role === ROLES.TENANT_OWNER
  ).length,
});

// =============================================================================
// ADD TEAM MEMBER
// =============================================================================

/**
 * addTeamMember — creates a new user in the tenant and sends an invite email.
 *
 * SOURCE: FRONTEND_SPEC §17 "+ Add User" modal
 * SOURCE: MASTER_SPEC §B17 "Add user modal, Roles: Owner/Admin/Sales/Read-Only"
 *
 * CONNECTED EFFECTS:
 *   1. Check email not already taken
 *   2. Validate requester can assign the target role (no privilege escalation)
 *   3. Create User document with tenantId
 *   4. Send invite email via email.service.js
 *
 * @param {Object} data     — { firstName, lastName, email, role, password? }
 * @param {Object} reqUser  — req.user from authenticate middleware
 */
export const addTeamMember = async (data, reqUser) => {
  const ctx = buildCtx(reqUser);

  // 1. Only tenant_owner and tenant_admin can add team members
  if (!isTenantScopedRole(ctx.role) || ROLE_HIERARCHY[ctx.role] < ROLE_HIERARCHY[ROLES.TENANT_ADMIN]) {
    throw AppError.forbidden('Only Tenant Admin or above can add team members');
  }

  // 2. No privilege escalation — cannot create a user with equal/higher role
  assertCanManageRole(ctx.role, data.role);

  // 3. Check email globally unique
  const existingUser = await userRepo.existsByEmail(data.email);
  if (existingUser) {
    throw AppError.conflict(`Email ${data.email} is already registered`);
  }

  // 3b. Tenant must be genuinely accessible (not suspended/expired) and
  // under its plan's user limit -- these checks existed on the old public
  // self-registration path but were never present here, meaning a tenant
  // admin could add unlimited members regardless of plan, even onto a
  // suspended workspace.
  const tenant = await tenantRepo.findById(ctx.tenantId);
  if (!tenant) throw AppError.notFound('Workspace not found');

  const access = tenant.isAccessible();
  if (!access.allowed) {
    throw AppError.forbidden(`Cannot add a team member to this workspace: ${access.reason}`);
  }
  if (!tenant.canCreateUser()) {
    throw AppError.forbidden(
      `This workspace has reached its maximum user limit (${tenant.maxUsers}). Upgrade your plan to add more team members.`
    );
  }

  // 4. Create user in PENDING state -- no usable password yet. The
  // invitee sets their own real password when they accept (see
  // acceptInvitation in auth.service.js). A cryptographically random
  // placeholder is hashed into the password field purely so the schema's
  // required-password constraint is satisfied; it is never sent anywhere
  // and login is blocked for PENDING accounts regardless (see
  // auth.service.js login()), so this placeholder can never actually be
  // used to authenticate even if someone guessed it.
  const placeholderPassword = generateSecureToken(24);

  const newUser = await userRepo.create({
    firstName:  data.firstName,
    lastName:   data.lastName,
    email:      data.email,
    password:   placeholderPassword,
    role:       data.role,
    tenantId:   ctx.tenantId,
    status:     USER_STATUS.PENDING,
    createdBy:  ctx.userId,
  });

  // 4b. Real Membership record, also PENDING -- becomes ACTIVE only when
  // the invitation is actually accepted (see acceptInvitation).
  await Membership.create({
    userId:    newUser._id,
    tenantId:  ctx.tenantId,
    role:      data.role,
    status:    MEMBERSHIP_STATUS.PENDING,
    invitedBy: ctx.userId,
    joinedAt:  null,
  });

  // 4c. Real invitation token -- plain token goes in the email link, only
  // its SHA-256 hash is ever stored (same pattern as password reset /
  // email verification tokens).
  const plainToken = generateSecureToken(32);
  const expiresAt  = new Date(Date.now() + TOKEN_EXPIRY.INVITATION_SECONDS * 1000);

  await tokenRepo.createInvitationToken({
    userId:     newUser._id,
    tenantId:   ctx.tenantId,
    email:      data.email,
    role:       data.role,
    invitedBy:  ctx.userId,
    tokenHash:  hashToken(plainToken),
    expiresAt,
  });

  // NOTE: currentUserCount is intentionally NOT incremented here anymore.
  // A pending, unaccepted invitation shouldn't consume real plan
  // capacity -- canCreateUser()'s check above already prevents new
  // invites once at the limit; the counter itself only increments at
  // real acceptance (see acceptInvitation), so it reflects genuinely
  // active members, not pending invites that may never be accepted.

  // 5. Send the real invitation email (non-blocking — invite creation
  // succeeds even if the email fails to send; same resilience as before).
  try {
    await sendTeamInvite({
      to:         data.email,
      firstName:  data.firstName,
      tenantName: tenant.name,
      role:       data.role,
      token:      plainToken,
    });
  } catch (err) {
    console.warn(`[team] invite email failed for ${data.email}: ${err.message}`);
  }

  return newUser.getPublicProfile();
};

// =============================================================================
// UPDATE TEAM MEMBER ROLE — inline role change
// =============================================================================

/**
 * updateMemberRole — inline role change in the team table.
 *
 * SOURCE: FRONTEND_SPEC §17 "inline role change"
 * Screenshot: Role column shows dropdown (Super Admin ↓, Tenant Owner ↓, etc.)
 *
 * RULES:
 *   - Cannot change your own role
 *   - Cannot assign role >= your own rank
 *   - Cannot change the tenant_owner role (Super Admin only)
 *
 * @param {string} memberId — user._id to update
 * @param {string} newRole  — new role value from ROLES
 * @param {Object} reqUser
 */
export const updateMemberRole = async (memberId, newRole, reqUser) => {
  const ctx = buildCtx(reqUser);

  if (!isValidRole(newRole)) {
    throw AppError.badRequest(`Invalid role: ${newRole}`);
  }

  if (String(memberId) === String(ctx.userId)) {
    throw AppError.badRequest('You cannot change your own role');
  }

  // Load target user — must be in same tenant
  const member = await User.findOne({ _id: memberId, tenantId: ctx.tenantId });
  if (!member) throw AppError.notFound('Team member not found');

  // Prevent non-super-admins from touching tenant_owner role
  if (
    member.role  === ROLES.TENANT_OWNER &&
    ctx.role     !== ROLES.SUPER_ADMIN
  ) {
    throw AppError.forbidden('Only Super Admin can change the Tenant Owner role');
  }

  // No privilege escalation
  assertCanManageRole(ctx.role, newRole);

  const updated = await userRepo.updateById(memberId, {
    $set: { role: newRole, updatedBy: ctx.userId },
  });

  emitToUser(memberId, 'auth:permissions-updated', { role: updated.role, permissions: updated.permissions });

  return updated.getPublicProfile();
};

// =============================================================================
// UPDATE TEAM MEMBER PERMISSIONS — granular overrides beyond role defaults
// =============================================================================

/**
 * A human-readable catalog of every definable permission, grouped for the
 * Team page's permissions modal. Purely presentational metadata -- the
 * actual enforced values are always PERMISSIONS.* from permissions.js.
 * Platform-only permissions (manage_tenants etc.) are deliberately
 * excluded -- a tenant owner granting a sales user platform-level access
 * makes no sense and isn't offered as an option.
 */
const PERMISSION_CATALOG = Object.freeze([
  {
    group: 'Team & Settings',
    items: [
      { value: PERMISSIONS.MANAGE_TEAM, label: 'Manage team members' },
      { value: PERMISSIONS.MANAGE_SETTINGS, label: 'Manage workspace settings' },
      { value: PERMISSIONS.MANAGE_INTEGRATIONS, label: 'Manage integrations' },
    ],
  },
  {
    group: 'Leads & Pipeline',
    items: [
      { value: PERMISSIONS.MANAGE_LEADS, label: 'Manage all leads (not just assigned)' },
      { value: PERMISSIONS.VIEW_LEADS, label: 'View all leads' },
      { value: PERMISSIONS.UPDATE_LEADS, label: 'Edit leads' },
      { value: PERMISSIONS.UPDATE_PIPELINE, label: 'Move deals through pipeline' },
    ],
  },
  {
    group: 'WhatsApp Templates',
    items: [
      { value: PERMISSIONS.SUBMIT_TEMPLATES, label: 'Create & submit templates for review' },
      { value: PERMISSIONS.APPROVE_TEMPLATES, label: 'Approve templates & submit directly to Meta (skips internal review)' },
      { value: PERMISSIONS.MANAGE_TEMPLATES, label: 'Full template management' },
    ],
  },
  {
    group: 'Campaigns & Broadcasts',
    items: [
      { value: PERMISSIONS.MANAGE_CAMPAIGNS, label: 'Create campaigns/broadcasts' },
      { value: PERMISSIONS.APPROVE_CAMPAIGNS, label: 'Approve & send campaigns directly (skips owner approval)' },
    ],
  },
  {
    group: 'Conversations & Bookings',
    items: [
      { value: PERMISSIONS.MANAGE_CONVERSATIONS, label: 'Manage WhatsApp conversations' },
      { value: PERMISSIONS.ASSIGN_CONVERSATIONS, label: 'Reassign conversations to other team members' },
      { value: PERMISSIONS.MANAGE_BOOKINGS, label: 'Manage bookings' },
      { value: PERMISSIONS.MANAGE_CALLS, label: 'Manage call records' },
      { value: PERMISSIONS.MANAGE_PAYMENTS, label: 'Manage payments' },
    ],
  },
  {
    group: 'Automation & AI',
    items: [
      { value: PERMISSIONS.MANAGE_AUTOMATIONS, label: 'Manage automation rules' },
      { value: PERMISSIONS.MANAGE_NURTURE, label: 'Manage nurture sequences' },
      { value: PERMISSIONS.MANAGE_AI, label: 'Manage AI reply assistant' },
    ],
  },
  {
    group: 'Reporting',
    items: [
      { value: PERMISSIONS.VIEW_DASHBOARD, label: 'View dashboard' },
      { value: PERMISSIONS.VIEW_REPORTS, label: 'View reports' },
      { value: PERMISSIONS.MANAGE_REPORTS, label: 'Manage/export reports' },
      { value: PERMISSIONS.VIEW_ATTRIBUTION, label: 'View attribution' },
      { value: PERMISSIONS.MANAGE_ATTRIBUTION, label: 'Manage attribution settings' },
    ],
  },
]);

/** GET /api/team/permissions/catalog -- feeds the permissions modal's checklist. */
export const getPermissionCatalog = () => PERMISSION_CATALOG;

/**
 * updateMemberPermissions — full replace of a member's permission set.
 * This is what lets an owner give one specific sales_user extra rights
 * (e.g. APPROVE_CAMPAIGNS so they can send without waiting for the
 * owner) without changing their role or affecting anyone else with that
 * same role -- permissions here are per-user, not per-role.
 *
 * RULES (mirrors updateMemberRole's guard shape):
 *   - Cannot edit your own permissions (self-escalation risk)
 *   - Cannot edit a member whose role rank >= your own
 *   - Cannot touch the tenant_owner's permissions unless you ARE super_admin
 *   - Every value must be a real PERMISSIONS.* string (validator also
 *     checks this, but re-checked here since this is the actual guard
 *     that matters for anyone calling the service directly)
 */
export const updateMemberPermissions = async (memberId, permissions, reqUser) => {
  const ctx = buildCtx(reqUser);

  if (String(memberId) === String(ctx.userId)) {
    throw AppError.badRequest('You cannot change your own permissions');
  }

  const member = await User.findOne({ _id: memberId, tenantId: ctx.tenantId });
  if (!member) throw AppError.notFound('Team member not found');

  if (member.role === ROLES.TENANT_OWNER && ctx.role !== ROLES.SUPER_ADMIN) {
    throw AppError.forbidden('Only Super Admin can change the Tenant Owner\'s permissions');
  }
  assertCanManageRole(ctx.role, member.role);

  const validValues = Object.values(PERMISSIONS);
  const invalid = permissions.filter((p) => !validValues.includes(p));
  if (invalid.length) {
    throw AppError.badRequest(`Unknown permission(s): ${invalid.join(', ')}`);
  }

  const updated = await userRepo.updateById(memberId, {
    $set: { permissions, updatedBy: ctx.userId },
  });

  // The whole point: the affected user's live session should reflect this
  // immediately, not just on their next login. Their frontend listens for
  // this and silently calls /api/auth/refresh, which re-derives a fresh
  // JWT from THIS updated DB record (see token.service.js's issueTokenPair
  // -- it already reads user.permissions fresh, not cached).
  emitToUser(memberId, 'auth:permissions-updated', { role: updated.role, permissions: updated.permissions });

  return updated.getPublicProfile();
};

/** Used by the permissions modal to show "reset to role default". */
export const getRoleDefaultPermissions = (role) => getRolePermissions(role);

// =============================================================================
// ACTIVATE / DEACTIVATE TEAM MEMBER
// =============================================================================

/**
 * setMemberStatus — activates or deactivates a team member.
 *
 * SOURCE: FRONTEND_SPEC §17 "activate/deactivate"
 * Screenshot: Actions column shows "Deactivate" button on all active rows
 *
 * @param {string} memberId — user._id
 * @param {string} status   — 'active' or 'inactive'
 * @param {Object} reqUser
 */
export const setMemberStatus = async (memberId, status, reqUser) => {
  const ctx = buildCtx(reqUser);

  if (!Object.values(USER_STATUS).includes(status)) {
    throw AppError.badRequest(`Status must be 'active' or 'inactive'`);
  }

  if (String(memberId) === String(ctx.userId)) {
    throw AppError.badRequest('You cannot deactivate your own account');
  }

  const member = await User.findOne({ _id: memberId, tenantId: ctx.tenantId });
  if (!member) throw AppError.notFound('Team member not found');

  // Cannot deactivate the tenant owner
  if (member.role === ROLES.TENANT_OWNER && ctx.role !== ROLES.SUPER_ADMIN) {
    throw AppError.forbidden('Cannot deactivate the Tenant Owner');
  }

  // status + isActive synced by User.js pre-save Hook 4
  const updated = await userRepo.updateById(memberId, {
    $set: {
      status,
      isActive:  status === USER_STATUS.ACTIVE,
      updatedBy: ctx.userId,
    },
  });

  return updated.getPublicProfile();
};

// =============================================================================
// GET SINGLE TEAM MEMBER
// =============================================================================

export const getTeamMember = async (memberId, tenantId) => {
  const member = await User.findOne({ _id: memberId, tenantId });
  if (!member) throw AppError.notFound('Team member not found');

  const leadCount = await Lead.countDocuments({
    tenant_id:        String(tenantId),
    assigned_user_id: String(memberId),
    archived:         false,
  });

  return {
    ...member.getPublicProfile(),
    assignedLeads: leadCount,
  };
};

// =============================================================================
// PRIVATE UTILITIES
// =============================================================================

/**
 * generateTempPassword — creates a temp password for invited team members.
 *
 * ⚠️ TEMPORARY TESTING OVERRIDE ⚠️
 * Currently returns a FIXED password instead of a random one, purely so
 * you can predict new team members' login credentials while testing
 * locally (no real email sending is wired up yet -- see team.service.js
 * addTeamMember()'s comment about sendTeamInvite() only logging to
 * console right now). REVERT THIS before any real/shared use -- a fixed,
 * predictable password for every new account is a genuine security
 * issue the moment more than one person can reach this app.
 *
 * To revert: restore the random generation below (kept, just commented
 * out) and delete the fixed return.
 */
const generateTempPassword = () => {
  return 'Test@1234'; // TEMP: fixed for local testing only -- see warning above

  // Original random version -- restore this, delete the line above, when done testing:
  // const chars  = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  // let password = '';
  // for (let i = 0; i < 12; i++) {
  //   password += chars.charAt(Math.floor(Math.random() * Math.random()));
  // }
  // return password;
};
const isValidRole = (role) =>
  Object.values(ROLES).includes(role);