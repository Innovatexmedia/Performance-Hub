
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
  /** Individual permission overrides beyond role defaults -- see
   * rolePermissions.js / team.service.js's updateMemberPermissions. */
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
  /** Stable machine-readable error code (e.g. 'PLAN_LIMIT_EXCEEDED') --
   * see BACKEND's errorHandler.middleware.js's `response.code` passthrough.
   * Lets the frontend reliably detect a specific error kind without
   * fragile string-matching on `message`. */
  code?: string;
  resource?: string;
  limit?: number;
  current?: number;
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

export type LoginResult = AuthResult | WorkspaceSelectionResult | EmailVerificationRequiredResult;

export function isWorkspaceSelectionResult(result: LoginResult): result is WorkspaceSelectionResult {
  return 'requiresWorkspaceSelection' in result && result.requiresWorkspaceSelection === true;
}

/**
 * The branch of /auth/login AND /auth/register's response returned when
 * the account exists but hasn't proven ownership of its email yet -- no
 * token issued, same "prove identity before granting access" principle
 * as WorkspaceSelectionResult, just for a different gate. SOURCE:
 * src/modules/auth/services/auth.service.js's real isEmailVerified check
 * in login(), and register() no longer issuing a session at all.
 */
export interface EmailVerificationRequiredResult {
  requiresEmailVerification: true;
  email: string;
}

export type RegisterResult = AuthResult | EmailVerificationRequiredResult;

export function isEmailVerificationRequiredResult(
  result: LoginResult | RegisterResult,
): result is EmailVerificationRequiredResult {
  return 'requiresEmailVerification' in result && result.requiresEmailVerification === true;
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