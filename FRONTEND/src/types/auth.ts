/**
 * Real auth types — match the ACTUAL backend response shapes exactly.
 *
 * These are intentionally separate from the legacy `User` type in
 * `@/types/index.ts`, which describes the old client-side demo user
 * (has a plaintext `password` field, Title-Case role, single `name` field --
 * none of which exist on the real backend). That legacy type is still used
 * by every other page's mock `db.users` lookups and will be retired
 * module-by-module as each page is rewired to the real API.
 *
 * SOURCE OF TRUTH: src/modules/auth/models/User.js toJSON() transform
 * (strips password/loginAttempts/lockUntil, renames _id -> id) and
 * src/config/jwt.js token payload comment.
 */

/**
 * The 5 real roles, exactly as stored on the backend (lowercase snake_case).
 * SOURCE: src/modules/auth/constants/roles.js
 */
export type AuthRole =
  | 'super_admin'
  | 'tenant_owner'
  | 'tenant_admin'
  | 'sales_user'
  | 'read_only_user';

/**
 * AuthUser -- the `user` object returned by /auth/login, /auth/register,
 * /auth/refresh, and /auth/me. tenantId is null only for super_admin.
 */
export interface AuthUser {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phoneNumber: string | null;
  role: AuthRole;
  tenantId: string | null;
  profileImage: string | null;
  status: 'active' | 'inactive' | 'suspended' | 'pending' | 'deleted';
  isActive: boolean;
  isEmailVerified: boolean;
  permissions: string[];
  lastLogin: string | null;
  createdAt: string;
}

/** Shared envelope for every backend response -- see src/utils/apiResponse.js */
export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
  errors?: { field: string; message: string }[];
  meta?: { pagination?: unknown };
}

export interface LoginPayload {
  email: string;
  password: string;
}

/**
 * RegisterPayload -- matches auth.validator.js's validateRegister exactly.
 * SECURITY: role is now restricted to tenant_owner (self-registration) or
 * super_admin (requires superAdminSecret) -- tenant_admin/sales_user/
 * read_only_user were removed from this public endpoint entirely (real
 * security fix: it used to accept a bare tenantId with no real invitation
 * check). Those roles are added via the Team page instead.
 */
export interface RegisterPayload {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  role?: 'tenant_owner' | 'super_admin';
  workspaceName?: string;
  superAdminSecret?: string;
}

export interface AuthResult {
  user: AuthUser;
  accessToken: string;
}

/** One entry in the workspace switcher — either at login-selection time or the Topbar dropdown. */
export interface WorkspaceOption {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  logoUrl: string | null;
  role: AuthRole;
}

/**
 * The new branch of /auth/login's response, returned instead of AuthResult
 * when a user has more than one active Membership. No token is issued yet
 * -- selectionToken proves the password step already happened, and gets
 * passed to /auth/switch-workspace once the user picks one.
 * SOURCE: src/modules/auth/services/auth.service.js login()'s comment --
 * every account that existed before this feature shipped has at most one
 * Membership, so this branch is genuinely new behavior, not a change to
 * how existing accounts log in.
 */
export interface WorkspaceSelectionResult {
  requiresWorkspaceSelection: true;
  selectionToken: string;
  user: AuthUser;
  workspaces: WorkspaceOption[];
}

export type LoginResult = AuthResult | WorkspaceSelectionResult;

export function isWorkspaceSelectionResult(result: LoginResult): result is WorkspaceSelectionResult {
  return 'requiresWorkspaceSelection' in result && result.requiresWorkspaceSelection === true;
}

/** Human-readable label for a role -- UI display only, never sent to the backend. */
export const ROLE_LABELS: Record<AuthRole, string> = {
  super_admin: 'Super Admin',
  tenant_owner: 'Tenant Owner',
  tenant_admin: 'Tenant Admin',
  sales_user: 'Sales User',
  read_only_user: 'Read-Only User',
};

/** SOURCE: auth.service.js listSessions() -- one real active RefreshToken document per device/session. */
export interface Session {
  id: string;
  sessionId: string;
  isCurrent: boolean;
  deviceInfo: { userAgent: string | null; ip: string | null };
  createdAt: string;
  expiresAt: string;
}