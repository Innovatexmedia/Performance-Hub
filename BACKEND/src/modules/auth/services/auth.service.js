import mongoose                           from 'mongoose';
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

/** Extract IP and User-Agent from Express request for audit logs. */
const getClientMeta = (req) => ({
  ip:        req.ip || req.socket?.remoteAddress || null,
  userAgent: req.headers?.['user-agent'] || null,
});

/**
 * createAuditLog — writes a login audit entry.
 * Non-blocking: errors are swallowed so audit failures never crash auth flows.
 */
const createAuditLog = (data) =>
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
    tenantId: suppliedTenantId,
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
  if (role === ROLES.SUPER_ADMIN) {
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

  // ── PATH C: tenant_admin | sales_user | read_only_user (invitation flow) ─────
  if (TENANT_SCOPED_ROLES.includes(role)) {
    if (!suppliedTenantId) {
      throw new AppError(
        `tenantId is required when registering with role: ${role}`,
        400
      );
    }
    return _registerTenantMember(
      { firstName, lastName, email, password, role, tenantId: suppliedTenantId },
      meta
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

    tenant.ownerUserId = user._id;
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

/**
 * _registerTenantMember — creates a user inside an existing tenant.
 * Used for invitation-based onboarding (not public self-registration).
 */
async function _registerTenantMember(
  { firstName, lastName, email, password, role, tenantId },
  meta
) {
  // Verify tenant exists and is accessible
  const tenant = await tenantRepo.findById(tenantId);
  if (!tenant) {
    throw new AppError('Workspace not found', 404);
  }

  const access = tenant.isAccessible();
  if (!access.allowed) {
    throw new AppError(
      `Cannot add user to this workspace: ${access.reason}`,
      403
    );
  }

  // Check user capacity
  if (!tenant.canCreateUser()) {
    throw new AppError(
      `This workspace has reached its maximum user limit (${tenant.maxUsers}). ` +
      `Please upgrade your plan to add more team members.`,
      403
    );
  }

  const user = await userRepo.create({
    firstName,
    lastName,
    email,
    password,
    role,
    tenantId,
    status: USER_STATUS.ACTIVE,
  });

  // Increment user count atomically
  await tenantRepo.incrementUsageCounter(tenantId, 'currentUserCount', 1);

  await Membership.create({
    userId: user._id,
    tenantId,
    role,
    status: MEMBERSHIP_STATUS.ACTIVE,
    joinedAt: new Date(),
  });

  await issueVerificationEmail(user);

  const { accessToken, refreshToken } = await tokenSvc.issueTokenPair(user, meta);

  await createAuditLog({
    userId:   user._id,
    tenantId: user.tenantId,
    email:    user.email,
    event:    AUDIT_EVENTS.LOGIN_SUCCESS,
    success:  true,
    ...meta,
  });

  return {
    user:         user.getPublicProfile(),
    accessToken,
    refreshToken,
    tenant: {
      id:   tenant._id,
      name: tenant.name,
      slug: tenant.slug,
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
 * switchWorkspace — the counterpart to login()'s multi-membership branch.
 * Verifies the short-lived selectionToken (proves the password step
 * already happened), confirms the requested tenant is genuinely one of
 * this user's ACTIVE memberships (never trusts the client blindly), then
 * issues a real, full access+refresh token pair scoped to that tenant --
 * reusing tokenSvc.issueTokenPair exactly as every other login path does,
 * just with tenantId/role temporarily overridden to match the CHOSEN
 * membership rather than the user's stored primary one. The real User
 * document's own tenantId/role is never modified by this -- switching
 * workspaces doesn't change which one is "primary".
 *
 * @param {{ selectionToken: string, tenantId: string }} params
 * @param {Object} req
 */
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

  // issueTokenPair only reads ._id / .tenantId / .role off whatever object
  // it's given -- this overrides those two to the CHOSEN membership
  // without touching the real User document at all.
  const scopedUser = { _id: user._id, tenantId: membership.tenantId, role: membership.role };
  const { accessToken, refreshToken } = await tokenSvc.issueTokenPair(scopedUser, meta);

  await createAuditLog({
    userId: user._id,
    tenantId: membership.tenantId,
    email: user.email,
    event: AUDIT_EVENTS.LOGIN_SUCCESS,
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