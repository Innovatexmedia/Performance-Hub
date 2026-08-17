import mongoose                           from 'mongoose';
import config                             from '../../../config/config.js';
import * as userRepo                      from '../repositories/user.repository.js';
import * as tenantRepo                    from '../repositories/tenant.repository.js';
import * as tokenRepo                     from '../repositories/token.repository.js';
import * as tokenSvc                      from './token.service.js';
import { comparePassword, hashPassword }  from '../../../utils/password.js';
import { generateSecureToken, hashToken } from '../../../utils/crypto.js';
import { verifyRefreshToken, signWorkspaceSelectionToken, verifyWorkspaceSelectionToken } from '../../../config/jwt.js';
import AppError                           from '../../../utils/AppError.js';
import LoginAudit                         from '../models/LoginAudit.js';
import Tenant                             from '../models/Tenant.js';
import { getOrCreateAccountForUser } from '../../plans/plan.service.js';
import Membership, { MEMBERSHIP_STATUS }  from '../models/Membership.js';
import {
  AUDIT_EVENTS,
  TOKEN_EXPIRY,
  USER_STATUS,
}                                         from '../constants/auth.constants.js';
import { ROLES, TENANT_SCOPED_ROLES }     from '../constants/roles.js';
import {
  sendEmailVerification,
  sendWelcomeEmail,
}                                         from './email.service.js';

// =============================================================================
// PRIVATE HELPERS
// =============================================================================

/** Extract IP and User-Agent from Express request for audit logs. Exported for reuse. */
export const getClientMeta = (req) => ({
  ip:        req.ip || req.socket?.remoteAddress || null,
  userAgent: req.headers?.['user-agent'] || null,
});

/**
 * createAuditLog — writes a login audit entry.
 * Non-blocking: errors are swallowed so audit failures never crash auth flows.
 * Exported so other auth-adjacent services (e.g. invitation.service.js) can
 * reuse the exact same helper instead of duplicating it.
 */
export const createAuditLog = (data) =>
  LoginAudit.create(data).catch(() => {});

/**
 * issueVerificationEmail — creates and sends an email verification token.
 * Extracted as a helper to avoid duplication between register() and resend().
 */
const issueVerificationEmail = async (user) => {
  const plainToken = generateSecureToken(32);
  const expiresAt  = new Date(
    Date.now() + TOKEN_EXPIRY.EMAIL_VERIFICATION_SECONDS * 1000
  );

  await tokenRepo.createEmailVerificationToken({
    userId:    user._id,
    email:     user.email,
    tokenHash: hashToken(plainToken),
    expiresAt,
  });

  await sendEmailVerification({
    email:     user.email,
    firstName: user.firstName,
    token:     plainToken,
  });
};

// =============================================================================
// REGISTER
// =============================================================================

/**
 * register — creates a new user account with correct SaaS onboarding flow.
 *
 * Request payload expectations by role:
 *
 *   tenant_owner (self-registration):
 *     { firstName, lastName, email, password, role: "tenant_owner", workspaceName }
 *     → Creates Tenant first, then User with tenantId
 *
 *   super_admin (platform bootstrap):
 *     { firstName, lastName, email, password, role: "super_admin" }
 *     → No Tenant created, tenantId stays null
 *
 *   tenant_admin | sales_user | read_only_user (invitation):
 *     { firstName, lastName, email, password, role, tenantId }
 *     → tenantId must already exist and be active
 *     → Typically called by an existing tenant_owner/admin, not public-facing
 *
 * @param {Object} data — validated request body
 * @param {Object} req  — Express request object
 * @returns {{ user, accessToken, refreshToken, tenant }}
 */
export const register = async (data, req) => {
  const {
    firstName,
    lastName,
    email,
    password,
    role         = ROLES.TENANT_OWNER,
    workspaceName,
    superAdminSecret,
  } = data;

  const meta = getClientMeta(req);

  // ── Step 1: Check email uniqueness ──────────────────────────────────────────
  const existing = await userRepo.existsByEmail(email);
  if (existing) {
    throw new AppError(
      'An account with this email address already exists',
      409
    );
  }

  // ── Step 2: Route by role ────────────────────────────────────────────────────

  // ── PATH A: super_admin ──────────────────────────────────────────────────────
  // SECURITY: this used to have NO protection at all -- anyone could POST
  // role: 'super_admin' to this public endpoint and get full platform
  // access. Now requires a real, private secret (SUPER_ADMIN_SECRET env
  // var) that only the platform owner knows. Fails closed: if the secret
  // isn't configured on the server at all, this path is permanently
  // disabled rather than silently open.
  if (role === ROLES.SUPER_ADMIN) {
    if (!config.SUPER_ADMIN_SECRET) {
      throw new AppError('Super admin registration is not enabled on this server', 403);
    }
    if (!superAdminSecret || superAdminSecret !== config.SUPER_ADMIN_SECRET) {
      throw new AppError('Invalid or missing super admin secret', 403);
    }
    return _registerSuperAdmin(
      { firstName, lastName, email, password },
      meta
    );
  }

  // ── PATH B: tenant_owner (self-registration — creates new workspace) ─────────
  if (role === ROLES.TENANT_OWNER) {
    if (!workspaceName || !workspaceName.trim()) {
      throw new AppError(
        'workspaceName is required when registering as a tenant owner',
        400
      );
    }
    return _registerTenantOwner(
      { firstName, lastName, email, password, workspaceName: workspaceName.trim() },
      meta
    );
  }

  // ── tenant_admin | sales_user | read_only_user — NOT available here ──────────
  // SECURITY: this path used to accept a bare tenantId with zero real
  // invitation check -- anyone who discovered or guessed a tenant's ID
  // could self-register as an admin on someone else's workspace. Removed
  // entirely. The real, secure way to add a team member is
  // team.service.js's addTeamMember() -- it requires the caller to
  // already be authenticated as tenant_admin+ on that specific tenant,
  // generates a real temp password, and sends a real invite.
  if (TENANT_SCOPED_ROLES.includes(role)) {
    throw new AppError(
      'This role cannot self-register. Ask a tenant admin or owner to add you from the Team page.',
      403
    );
  }

  // Should never reach here — role enum validation catches invalid roles upstream
  throw new AppError(`Unhandled role in registration: ${role}`, 400);
};

// =============================================================================
// PRIVATE REGISTRATION PATHS
// =============================================================================

/**
 * _registerSuperAdmin — creates a super_admin with no tenant.
 */
async function _registerSuperAdmin({ firstName, lastName, email, password }, meta) {
  const user = await userRepo.create({
    firstName,
    lastName,
    email,
    password,    // hashed by User.js pre-save Hook 2
    role:        ROLES.SUPER_ADMIN,
    tenantId:    null,
    status:      USER_STATUS.ACTIVE,
  });

  await issueVerificationEmail(user);

  const { accessToken, refreshToken } = await tokenSvc.issueTokenPair(user, meta);

  await createAuditLog({
    userId:  user._id,
    tenantId: null,
    email:   user.email,
    event:   AUDIT_EVENTS.LOGIN_SUCCESS,
    success: true,
    ...meta,
  });

  return {
    user:         user.getPublicProfile(),
    accessToken,
    refreshToken,
    tenant:       null,
  };
}

/**
 * _registerTenantOwner — creates Tenant + User atomically, then links them.
 *
 * TRANSACTION FLOW:
 *   session.startTransaction()
 *     1. Tenant.create()      → tenant._id available
 *     2. User.create()        → user._id available, tenantId = tenant._id
 *     3. Tenant.ownerUserId   → back-reference to user
 *   session.commitTransaction()
 *
 * If any step throws, the entire transaction rolls back.
 */
async function _registerTenantOwner(
  { firstName, lastName, email, password, workspaceName },
  meta
) {
  let tenant;
  let user;

  try {
    tenant = await Tenant.create({
      name: workspaceName,
      ownerName: `${firstName} ${lastName}`.trim(),
      ownerEmail: email.toLowerCase().trim(),
    });

    user = await userRepo.create({
      firstName,
      lastName,
      email,
      password,
      role: ROLES.TENANT_OWNER,
      tenantId: tenant._id,
      status: USER_STATUS.ACTIVE,
    });

    // Every tenant needs an owning Account for billing (see
    // plans/account.model.js) -- a fresh signup always gets a brand-new
    // one, since this is necessarily their first-ever workspace.
    const account = await getOrCreateAccountForUser(user._id);

    tenant.ownerUserId = user._id;
    tenant.accountId = account._id;
    tenant.currentUserCount = 1;

    await tenant.save();

    // Mirror this as the user's first Membership row -- see Membership.js
    // header comment: User.tenantId/role stays the "primary" membership,
    // this makes "how many workspaces does this user belong to" always
    // answerable by counting Membership rows, from day one.
    await Membership.create({
      userId: user._id,
      tenantId: tenant._id,
      role: ROLES.TENANT_OWNER,
      status: MEMBERSHIP_STATUS.ACTIVE,
      joinedAt: new Date(),
    });
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.slug) {
      throw new AppError(
        'A workspace with a similar name already exists. Please try a different workspace name.',
        409
      );
    }

    throw error;
  }

  await issueVerificationEmail(user);

  const { accessToken, refreshToken } =
    await tokenSvc.issueTokenPair(user, meta);

  await createAuditLog({
    userId: user._id,
    tenantId: tenant._id,
    email: user.email,
    event: AUDIT_EVENTS.LOGIN_SUCCESS,
    success: true,
    ...meta,
  });

  return {
    user: user.getPublicProfile(),
    accessToken,
    refreshToken,
    tenant: {
      id: tenant._id,
      name: tenant.name,
      slug: tenant.slug,
      plan: tenant.plan,
      subscriptionStatus: tenant.subscriptionStatus,
      trialEndsAt: tenant.trialEndsAt,
    },
  };
}

// =============================================================================
// LOGIN
// =============================================================================

/**
 * login — authenticates a user with email + password.
 *
 * @param {{ email: string, password: string }}
 * @param {Object} req
 * @returns {{ user, accessToken, refreshToken }}
 */
export const login = async ({ email, password }, req) => {
  const meta = getClientMeta(req);

  // Find user with password and lockout fields selected
  const user = await userRepo.findByEmailWithPassword(email);

  if (!user) {
    await createAuditLog({
      email,
      event:         AUDIT_EVENTS.LOGIN_FAILED,
      success:       false,
      failureReason: 'USER_NOT_FOUND',
      ...meta,
    });
    // Generic message — do not reveal whether email exists (anti-enumeration)
    throw new AppError('Invalid email or password', 401);
  }

  // Check account status
  if (user.status === USER_STATUS.SUSPENDED) {
    throw new AppError(
      'Your account has been suspended. Please contact support.',
      403
    );
  }
  if (user.status === USER_STATUS.INACTIVE) {
    throw new AppError(
      'Your account is inactive. Please contact your workspace owner.',
      403
    );
  }
  if (user.status === USER_STATUS.PENDING) {
    throw new AppError(
      'Your account is pending activation. Please check your email for an invitation link, or ask whoever invited you to resend it.',
      403
    );
  }
  if (user.status === USER_STATUS.DELETED) {
    // Deliberately the same generic message as "user not found" -- a
    // deleted account existing at all shouldn't be revealed via login.
    throw new AppError('Invalid email or password', 401);
  }

  // Check lockout
  if (user.isLocked && user.lockUntil && user.lockUntil > Date.now()) {
    const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
    throw new AppError(
      `Account temporarily locked. Try again in ${minutesLeft} minute(s).`,
      423
    );
  }

  // Verify password
  const isPasswordValid = await comparePassword(password, user.password);

  if (!isPasswordValid) {
    await user.incrementLoginAttempts();
    await createAuditLog({
      userId:        user._id,
      tenantId:      user.tenantId,
      email,
      event:         AUDIT_EVENTS.LOGIN_FAILED,
      success:       false,
      failureReason: 'INVALID_PASSWORD',
      ...meta,
    });
    throw new AppError('Invalid email or password', 401);
  }

  // Successful login — reset lockout state
  await user.resetLoginAttempts();
  await userRepo.updateLastLogin(user._id);

  // ── Multi-workspace check ────────────────────────────────────────────────
  // 0 or 1 active memberships -> proceed exactly as before (this covers
  // EVERY account that existed before this feature shipped, since none of
  // them have more than one Membership row -- the mechanism didn't exist
  // yet to create a second one). Only 2+ triggers the new flow. This is
  // deliberately the safest possible branch condition: no existing login
  // behavior changes unless a user was actually invited to a second
  // workspace, which can only happen going forward from here.
  const activeMemberships = await Membership.find({
    userId: user._id,
    status: MEMBERSHIP_STATUS.ACTIVE,
  }).populate('tenantId', 'name slug branding.logoUrl');

  if (activeMemberships.length > 1) {
    await createAuditLog({
      userId:   user._id,
      tenantId: user.tenantId,
      email,
      event:    AUDIT_EVENTS.LOGIN_SUCCESS,
      success:  true,
      ...meta,
    });

    return {
      requiresWorkspaceSelection: true,
      selectionToken: signWorkspaceSelectionToken({ userId: user._id.toString() }),
      user: user.getPublicProfile(),
      workspaces: activeMemberships.map((m) => ({
        tenantId: String(m.tenantId._id),
        tenantName: m.tenantId.name,
        tenantSlug: m.tenantId.slug,
        logoUrl: m.tenantId.branding?.logoUrl || null,
        role: m.role,
      })),
    };
  }

  const { accessToken, refreshToken } = await tokenSvc.issueTokenPair(user, meta);

  await createAuditLog({
    userId:   user._id,
    tenantId: user.tenantId,
    email,
    event:    AUDIT_EVENTS.LOGIN_SUCCESS,
    success:  true,
    ...meta,
  });

  return { user: user.getPublicProfile(), accessToken, refreshToken };
};

// =============================================================================
// SWITCH WORKSPACE
// =============================================================================

/**
 * switchWorkspace — the counterpart to login()'s multi-membership branch,
 * AND the mid-session "switch workspace" action from an already-logged-in
 * user (e.g. the Topbar dropdown). Two different callers, two different
 * ways of proving identity, same result:
 *
 *   - Right after login: no real access token exists yet (login() didn't
 *     issue one for the multi-membership case) -- proves identity via the
 *     short-lived selectionToken instead.
 *   - Mid-session: the user already has a real, valid access token --
 *     req.user (from the authenticate middleware) is trusted directly,
 *     no selectionToken needed or expected.
 *
 * Both paths converge on the same userId before the rest of the function
 * (membership check, token issuance) runs identically either way.
 *
 * @param {{ selectionToken?: string, tenantId: string }} params
 * @param {Object} req
 */
export const switchWorkspace = async ({ selectionToken, tenantId }, req) => {
  const meta = getClientMeta(req);

  let userId;
  if (req.user?.sub) {
    // Mid-session case -- authenticate middleware already verified a real access token.
    userId = req.user.sub;
  } else if (selectionToken) {
    // Post-login case -- no real access token exists yet.
    let decoded;
    try {
      decoded = verifyWorkspaceSelectionToken(selectionToken);
    } catch {
      throw new AppError('Workspace selection expired or invalid -- please log in again', 401);
    }
    userId = decoded.sub;
  } else {
    throw new AppError('Not authenticated', 401);
  }

  const membership = await Membership.findOne({
    userId,
    tenantId,
    status: MEMBERSHIP_STATUS.ACTIVE,
  });
  if (!membership) {
    throw new AppError('You do not have access to this workspace', 403);
  }

  const user = await userRepo.findById(userId);
  if (!user) throw new AppError('User not found', 404);
  if (user.status === USER_STATUS.SUSPENDED) {
    throw new AppError('Your account has been suspended. Please contact support.', 403);
  }
  if (user.status === USER_STATUS.INACTIVE) {
    throw new AppError('Your account is inactive. Please contact your workspace owner.', 403);
  }
  if (user.status === USER_STATUS.PENDING) {
    throw new AppError('Your account is pending activation.', 403);
  }
  if (user.status === USER_STATUS.DELETED) {
    throw new AppError('Account not found', 404);
  }

  // issueTokenPair only reads ._id / .tenantId / .role off whatever object
  // it's given -- this overrides those two to the CHOSEN membership
  // without touching the real User document at all.
  const scopedUser = { _id: user._id, tenantId: membership.tenantId, role: membership.role };
  const { accessToken, refreshToken } = await tokenSvc.issueTokenPair(scopedUser, meta);

  await createAuditLog({
    userId: user._id,
    tenantId: membership.tenantId,
    email: user.email,
    event: AUDIT_EVENTS.WORKSPACE_SWITCHED,
    success: true,
    ...meta,
  });

  return {
    user: { ...user.getPublicProfile(), tenantId: String(membership.tenantId), role: membership.role },
    accessToken,
    refreshToken,
  };
};

/**
 * createWorkspace — self-serve "add another company" for an agency-style
 * user managing multiple, fully separate client workspaces from one login.
 * Mirrors superAdmin.service.js's createTenant (same real Tenant +
 * Membership transaction), adapted for an already-existing, already-
 * logged-in user instead of provisioning a brand new one:
 *   - Gated to tenant_owner/tenant_admin at the route layer (requireRole).
 *   - The requester becomes tenant_owner of the NEW workspace regardless
 *     of their role in the CURRENT one -- they're the one creating it.
 *   - Capped by tenant.maxWorkspaces (denormalized from the tenant's real
 *     Plan document -- see Tenant.js's pre-save hook), counting this
 *     user's total active memberships across every tenant (not just ones
 *     they own) -- ties workspace count to billing plan as intended, even
 *     though no real payment processor is wired up yet (see Settings >
 *     Billing's placeholder note).
 *   - New Tenant starts on the platform's current default plan and
 *     completely empty -- no
 *     leads/deals/campaigns/etc. carry over; only isolation, by design.
 *   - Returns a fresh token pair already scoped to the new workspace, same
 *     shape as switchWorkspace, so the frontend can drop the user straight
 *     into it without a second round-trip.
 */
export const createWorkspace = async (ctx, { name }, req) => {
  const meta = getClientMeta(req);

  const trimmedName = (name || '').trim();
  if (!trimmedName) throw new AppError('Workspace name is required', 400);
  if (trimmedName.length > 100) throw new AppError('Workspace name must be 100 characters or fewer', 400);

  const user = await userRepo.findById(ctx.userId);
  if (!user) throw new AppError('User not found', 404);

  // getOrCreateAccountForUser reuses the SAME account this user already
  // has (found via any of their existing tenants) -- this is the whole
  // point of account-level billing: an additional company shares the
  // owner's existing subscription, it doesn't get a fresh trial/plan of
  // its own. See plan.service.js's comment on why lookup is by
  // ownerUserId, not by the current tenant specifically.
  const account = await getOrCreateAccountForUser(user._id);

  // Workspace-count limit is now scoped to the ACCOUNT (how many
  // tenants already share this subscription), not counted via
  // Membership rows -- a user who's merely been invited as owner into
  // someone ELSE's unrelated account shouldn't have that count against
  // THIS account's limit, which counting all their memberships globally
  // would have incorrectly done.
  const tenantCount = await Tenant.countDocuments({ accountId: account._id });
  const limit = account.maxWorkspaces ?? 1;
  if (tenantCount >= limit) {
    throw new AppError(
      `Your plan allows up to ${limit} workspace${limit === 1 ? '' : 's'}. Upgrade your plan to add more.`,
      403,
    );
  }

  const session = await mongoose.startSession();
  let tenant;
  try {
    await session.withTransaction(async () => {
      tenant = (await Tenant.create([{
        name: trimmedName,
        ownerName: user.fullName || `${user.firstName} ${user.lastName}`.trim(),
        ownerEmail: user.email,
        accountId: account._id, // pre-save hook syncs plan/limits from this account, not an independent default
      }], { session }))[0];

      tenant.ownerUserId = user._id;
      tenant.currentUserCount = 1;
      await tenant.save({ session });

      await Membership.create([{
        userId: user._id,
        tenantId: tenant._id,
        role: ROLES.TENANT_OWNER,
        status: MEMBERSHIP_STATUS.ACTIVE,
        invitedBy: user._id, // self -- created it, not invited into it
        joinedAt: new Date(),
      }], { session });
    });
  } finally {
    await session.endSession();
  }

  const scopedUser = { _id: user._id, tenantId: tenant._id, role: ROLES.TENANT_OWNER };
  const { accessToken, refreshToken } = await tokenSvc.issueTokenPair(scopedUser, meta);

  await createAuditLog({
    userId: user._id,
    tenantId: tenant._id,
    email: user.email,
    event: AUDIT_EVENTS.WORKSPACE_CREATED,
    success: true,
    ...meta,
  });

  return {
    user: { ...user.getPublicProfile(), tenantId: String(tenant._id), role: ROLES.TENANT_OWNER },
    accessToken,
    refreshToken,
  };
};

/**
 * listMyWorkspaces — all ACTIVE memberships for the currently authenticated
 * user, for rendering the workspace switcher dropdown at any time (not
 * just at login).
 */
export const listMyWorkspaces = async (userId) => {
  const memberships = await Membership.find({
    userId,
    status: MEMBERSHIP_STATUS.ACTIVE,
  }).populate('tenantId', 'name slug branding.logoUrl');

  if (memberships.length > 0) {
    return memberships
      .filter((m) => m.tenantId) // skip any membership whose tenant was deleted
      .map((m) => ({
        tenantId: String(m.tenantId._id),
        tenantName: m.tenantId.name,
        tenantSlug: m.tenantId.slug,
        logoUrl: m.tenantId.branding?.logoUrl || null,
        role: m.role,
      }));
  }

  // Self-heal: every account created before this feature shipped has zero
  // Membership rows, but DOES have a real tenantId/role on the User
  // document itself -- that's still their real, current workspace. Treat
  // it as an implicit membership, and persist a real Membership row right
  // now so this fallback only ever runs once per account, not every call.
  const user = await userRepo.findById(userId);
  if (!user?.tenantId) return []; // super_admin, or a genuinely broken account -- nothing to show either way

  const tenant = await tenantRepo.findById(user.tenantId);
  if (!tenant) return [];

  await Membership.create({
    userId: user._id,
    tenantId: tenant._id,
    role: user.role,
    status: MEMBERSHIP_STATUS.ACTIVE,
    joinedAt: user.createdAt || new Date(),
  }).catch(() => null); // duplicate-key race is fine, just means another request already healed it

  return [{
    tenantId: String(tenant._id),
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
    logoUrl: tenant.branding?.logoUrl || null,
    role: user.role,
  }];
};

// =============================================================================
// LOGOUT
// =============================================================================

/**
 * logout — revokes the current device session.
 * @param {string} plainRefreshToken — from HttpOnly cookie
 * @param {Object} req
 */
export const logout = async (plainRefreshToken, req) => {
  if (plainRefreshToken) {
    await tokenSvc.revokeSession(plainRefreshToken);
  }

  const userId = req.user?.sub;
  if (userId) {
    await createAuditLog({
      userId,
      tenantId: req.user?.tenantId,
      event:    AUDIT_EVENTS.LOGOUT,
      success:  true,
      ...getClientMeta(req),
    });
  }
};

/**
 * logoutAll — revokes every active session for the requesting user
 * (logout everywhere). Reuses tokenSvc.revokeAllSessions, which already
 * existed and already backs the replay-attack response in
 * refreshTokens() -- this just exposes the same real logic as a
 * deliberate user action instead of only an automatic security response.
 */
export const logoutAll = async (req) => {
  await tokenSvc.revokeAllSessions(req.user.sub);

  await createAuditLog({
    userId:   req.user.sub,
    tenantId: req.user.tenantId,
    event:    AUDIT_EVENTS.LOGOUT_ALL,
    success:  true,
    ...getClientMeta(req),
  });
};

/**
 * listSessions — returns the requesting user's active sessions, with
 * device/IP info and a flag marking which one is the current request's
 * own session (compared by sessionId from the JWT, not guessed).
 */
export const listSessions = async (req) => {
  const sessions = await tokenSvc.getActiveSessions(req.user.sub);
  return sessions.map((s) => ({
    id:          s._id,
    sessionId:   s.sessionId,
    isCurrent:   s.sessionId === req.user.sessionId,
    deviceInfo:  s.deviceInfo,
    createdAt:   s.createdAt,
    expiresAt:   s.expiresAt,
  }));
};

/**
 * revokeUserSession — logs out ONE specific other session from the list
 * (see token.service.js's revokeSessionById for why this is a different
 * path than the plain-token-based revokeSession above).
 */
export const revokeUserSession = async (req, sessionId) => {
  try {
    await tokenSvc.revokeSessionById(req.user.sub, sessionId);
  } catch (err) {
    if (err.message === 'SESSION_NOT_FOUND') {
      throw new AppError('Session not found or already logged out', 404);
    }
    throw err;
  }

  await createAuditLog({
    userId:   req.user.sub,
    tenantId: req.user.tenantId,
    event:    AUDIT_EVENTS.SESSION_REVOKED,
    success:  true,
    ...getClientMeta(req),
  });
};

// =============================================================================
// REFRESH TOKENS
// =============================================================================

/**
 * refreshTokens — validates refresh token and issues a new pair (rotation).
 *
 * @param {string} plainRefreshToken — from HttpOnly cookie
 * @param {Object} req
 * @returns {{ user, accessToken, refreshToken }}
 */
export const refreshTokens = async (plainRefreshToken, req) => {
  if (!plainRefreshToken) {
    throw new AppError('Refresh token is required', 401);
  }

  // Verify JWT signature and expiry
  let decoded;
  try {
    decoded = verifyRefreshToken(plainRefreshToken);
  } catch {
    throw new AppError('Invalid or expired refresh token', 401);
  }

  // Find stored token record
  const tokenRecord = await tokenSvc.validateRefreshToken(plainRefreshToken);
  if (!tokenRecord) {
    // Not in DB — possible replay attack: revoke all sessions for this user
    await tokenSvc.revokeAllSessions(decoded.sub);
    throw new AppError('Refresh token has been revoked', 401);
  }

  // Load user
  const user = await userRepo.findById(decoded.sub);
  if (!user || user.status !== USER_STATUS.ACTIVE) {
    throw new AppError('User account is not active', 401);
  }

  // Rotate: delete old token, issue new pair
  const meta = getClientMeta(req);
  let result;

  try {
    result = await tokenSvc.rotateRefreshToken(plainRefreshToken, user, meta);
  } catch (error) {
    if (error.message === 'REFRESH_TOKEN_REUSE_DETECTED') {
      throw new AppError(
        'Security alert: refresh token reuse detected. All sessions have been revoked.',
        401
      );
    }
    throw error;
  }

  await createAuditLog({
    userId:   user._id,
    tenantId: user.tenantId,
    event:    AUDIT_EVENTS.TOKEN_REFRESHED,
    success:  true,
    ...meta,
  });

  return { user: user.getPublicProfile(), ...result };
};

// =============================================================================
// GET CURRENT USER
// =============================================================================

/**
 * getCurrentUser — returns the authenticated user's public profile.
 * @param {string} userId — from req.user.sub (JWT payload)
 */
export const getCurrentUser = async (userId) => {
  const user = await userRepo.findById(userId);
  if (!user) throw new AppError('User not found', 404);
  return user.getPublicProfile();
};

/**
 * updateProfile — updates the authenticated user's own editable profile
 * fields. Only these 4 fields are genuinely editable on the User schema
 * (firstName, lastName, phoneNumber, profileImage) -- nothing else is
 * accepted here, and nothing invented beyond what the schema already has.
 *
 * profileImage is the schema's real String field (a URL), accepted as
 * such here -- there is no real file-upload/persistent-storage
 * infrastructure anywhere in this codebase (upload.middleware.js's
 * multer instance uses memoryStorage and is only ever used for CSV
 * parsing in Leads, never to persist a file anywhere retrievable), so
 * genuine "upload a photo" support isn't implemented -- this lets a real
 * URL be set/updated, matching exactly what the field already is.
 *
 * @param {string} userId
 * @param {{ firstName?, lastName?, phoneNumber?, profileImage? }} data
 */
export const updateProfile = async (userId, data) => {
  const allowedFields = ['firstName', 'lastName', 'phoneNumber', 'profileImage'];
  const update = {};
  for (const field of allowedFields) {
    if (data[field] !== undefined) update[field] = data[field];
  }

  if (Object.keys(update).length === 0) {
    throw new AppError('No valid fields to update', 400);
  }

  const user = await userRepo.updateById(userId, { $set: update });
  if (!user) throw new AppError('User not found', 404);
  return user.getPublicProfile();
};

// =============================================================================
// CHANGE PASSWORD
// =============================================================================

/**
 * changePassword — updates password for an authenticated user.
 * Requires current password verification.
 * Revokes all other active sessions after change.
 *
 * @param {{ userId: string, currentPassword: string, newPassword: string }}
 * @param {Object} req
 */
export const changePassword = async (
  { userId, currentPassword, newPassword },
  req
) => {
  const user = await userRepo.findByIdWithPassword(userId);
  if (!user) throw new AppError('User not found', 404);

  const isValid = await comparePassword(currentPassword, user.password);
  if (!isValid) throw new AppError('Current password is incorrect', 400);

  const hashed = await hashPassword(newPassword);
  await userRepo.updatePassword(userId, hashed);

  // Force re-login on all other devices for security
  await tokenSvc.revokeAllSessions(userId);

  await createAuditLog({
    userId,
    tenantId: user.tenantId,
    event:    AUDIT_EVENTS.PASSWORD_CHANGED,
    success:  true,
    ...getClientMeta(req),
  });
};

// =============================================================================
// EMAIL VERIFICATION
// =============================================================================

/**
 * verifyEmail — validates the email verification token, marks email as verified.
 * @param {string} plainToken — from URL query param
 */
export const verifyEmail = async (plainToken) => {
  const tokenRecord = await tokenRepo.findEmailVerificationToken(plainToken);
  if (!tokenRecord) {
    throw new AppError('Invalid or expired verification link', 400);
  }

  const user = await userRepo.findById(tokenRecord.userId);
  if (!user)               throw new AppError('User not found', 404);
  if (user.isEmailVerified) throw new AppError('Email is already verified', 400);

  await userRepo.verifyEmail(user._id);
  await tokenRepo.markEmailVerificationTokenUsed(tokenRecord._id);

  await sendWelcomeEmail({ email: user.email, firstName: user.firstName });

  return user.getPublicProfile();
};

/**
 * resendVerificationEmail — sends a new verification link.
 * Invalidates any existing unused verification tokens first.
 * @param {string} userId — from req.user.sub
 */
export const resendVerificationEmail = async (userId) => {
  const user = await userRepo.findById(userId);
  if (!user)               throw new AppError('User not found', 404);
  if (user.isEmailVerified) throw new AppError('Email is already verified', 400);

  await tokenRepo.invalidateExistingVerificationTokens(userId);
  await issueVerificationEmail(user);
};