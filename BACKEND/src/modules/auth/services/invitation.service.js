/**
 * =============================================================================
 * InnovateX Revenue OS — Invitation Service
 * =============================================================================
 *
 * FILE: src/modules/auth/services/invitation.service.js
 *
 * PURPOSE
 * ───────
 * Invitation preview and acceptance flows. Mirrors password.service.js's
 * structure exactly (token generation lives in team.service.js's
 * addTeamMember, same as password reset's token generation lives in
 * requestPasswordReset -- this file owns the OTHER half: validating a
 * token and completing the flow it started).
 *
 * COORDINATES: token validation → password set → user/membership
 * activation → real login token issuance → audit log.
 * =============================================================================
 */

import { hashPassword }        from '../../../utils/password.js';
import * as tokenRepo          from '../repositories/token.repository.js';
import * as userRepo           from '../repositories/user.repository.js';
import * as tenantRepo         from '../repositories/tenant.repository.js';
import * as tokenSvc           from './token.service.js';
import { createAuditLog, getClientMeta } from './auth.service.js';
import Membership, { MEMBERSHIP_STATUS } from '../models/Membership.js';
import { INVITATION_STATUS }   from '../models/InvitationToken.js';
import { USER_STATUS, AUDIT_EVENTS } from '../constants/auth.constants.js';
import AppError                from '../../../utils/AppError.js';

/**
 * getInvitationPreview — validates a token and returns just enough for the
 * Accept Invitation page to show "You're invited to join {tenant} as
 * {role}" before the person sets a password. Read-only -- does not
 * consume or modify the token.
 *
 * @param {string} plainToken
 * @returns {{ email, role, tenantName, expiresAt }}
 */
export const getInvitationPreview = async (plainToken) => {
  const tokenRecord = await tokenRepo.findInvitationToken(plainToken);

  if (!tokenRecord) {
    const anyRecord = await tokenRepo.findInvitationTokenIncludingExpired(plainToken);
    if (anyRecord?.status === INVITATION_STATUS.ACCEPTED) {
      throw new AppError('This invitation has already been accepted. Please sign in instead.', 400);
    }
    throw new AppError('This invitation link is invalid or has expired. Ask your workspace admin to resend it.', 400);
  }

  const tenant = await tenantRepo.findById(tokenRecord.tenantId);
  if (!tenant) throw new AppError('Workspace not found', 404);

  return {
    email:      tokenRecord.email,
    role:       tokenRecord.role,
    tenantName: tenant.name,
    expiresAt:  tokenRecord.expiresAt,
  };
};

/**
 * acceptInvitation — completes the invitation: sets a real password,
 * activates the pending User and Membership, increments the tenant's
 * real user count (only NOW -- see team.service.js addTeamMember's note
 * on why this isn't incremented at invite time), marks the invitation
 * accepted, and logs the person straight in with real tokens so they
 * land on the dashboard immediately, same as register()'s flow.
 *
 * @param {{ token: string, password: string }} data
 * @param {Object} req — for audit meta (ip/userAgent)
 * @returns {{ user, accessToken, refreshToken }}
 */
export const acceptInvitation = async ({ token, password }, req) => {
  const meta = getClientMeta(req);

  const tokenRecord = await tokenRepo.findInvitationToken(token);
  if (!tokenRecord) {
    throw new AppError('This invitation link is invalid or has expired. Ask your workspace admin to resend it.', 400);
  }

  const user = await userRepo.findById(tokenRecord.userId);
  if (!user) throw new AppError('User not found', 404);

  if (user.status !== USER_STATUS.PENDING) {
    throw new AppError('This invitation has already been used or is no longer valid.', 400);
  }

  const tenant = await tenantRepo.findById(tokenRecord.tenantId);
  if (!tenant) throw new AppError('Workspace not found', 404);

  const access = tenant.isAccessible();
  if (!access.allowed) {
    throw new AppError(`Cannot accept this invitation: ${access.reason}`, 403);
  }
  if (!tenant.canCreateUser()) {
    throw new AppError(
      `This workspace has reached its maximum user limit (${tenant.maxUsers}) since this invitation was sent. Ask your workspace owner to upgrade the plan.`,
      403
    );
  }

  const hashedPassword = await hashPassword(password);
  await userRepo.updatePassword(user._id, hashedPassword);

  const activatedUser = await userRepo.updateById(user._id, {
    $set: { status: USER_STATUS.ACTIVE },
  });

  await Membership.updateOne(
    { userId: user._id, tenantId: tokenRecord.tenantId },
    { $set: { status: MEMBERSHIP_STATUS.ACTIVE, joinedAt: new Date() } }
  );

  // Team membership is shared across the WHOLE billing account, not
  // siloed to the single workspace this invitation was sent for (see
  // team.service.js's getAccountTenantIds comment for the full
  // reasoning) -- so accepting an invite grants access to every OTHER
  // workspace the account already covers too, not just this one. Each
  // is upserted individually (not a single updateMany) because a sibling
  // Membership might already exist in an unexpected state from some
  // other flow, and upserting per-tenant is the safe way to guarantee
  // every one of them ends up ACTIVE regardless of its prior state,
  // without a unique-index collision on tenants that don't have a row
  // yet. Reuses the `tenant` doc already loaded above (not a fresh
  // lookup) -- it's the same tenant this invitation was for.
  if (tenant.accountId) {
    const siblingTenants = await tenantRepo.findAll({ accountId: tenant.accountId });
    const otherTenantIds = siblingTenants
      .map((t) => t._id)
      .filter((id) => String(id) !== String(tokenRecord.tenantId));

    await Promise.all(otherTenantIds.map((siblingTenantId) =>
      Membership.updateOne(
        { userId: user._id, tenantId: siblingTenantId },
        { $set: { status: MEMBERSHIP_STATUS.ACTIVE, joinedAt: new Date() }, $setOnInsert: { userId: user._id, tenantId: siblingTenantId, role: tokenRecord.role, invitedBy: tokenRecord.invitedBy } },
        { upsert: true }
      )
    ));
  }

  await tenantRepo.incrementUsageCounter(tokenRecord.tenantId, 'currentUserCount', 1);

  await tokenRepo.markInvitationAccepted(tokenRecord._id);

  const { accessToken, refreshToken } = await tokenSvc.issueTokenPair(activatedUser, meta);

  await createAuditLog({
    userId:   activatedUser._id,
    tenantId: tokenRecord.tenantId,
    email:    activatedUser.email,
    event:    AUDIT_EVENTS.INVITATION_ACCEPTED,
    success:  true,
    ...meta,
  });

  return {
    user: activatedUser.getPublicProfile(),
    accessToken,
    refreshToken,
  };
};