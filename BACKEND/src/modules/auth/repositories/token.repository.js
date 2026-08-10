/**
 * =============================================================================
 * InnovateX Revenue OS — Token Repository
 * =============================================================================
 *
 * FILE: src/modules/auth/repositories/token.repository.js
 *
 * PURPOSE
 * ───────
 * All database operations for RefreshToken, PasswordResetToken,
 * and EmailVerificationToken in one place.
 * =============================================================================
 */

import RefreshToken          from '../models/RefreshToken.js';
import PasswordResetToken    from '../models/PasswordResetToken.js';
import EmailVerificationToken from '../models/EmailVerificationToken.js';
import InvitationToken, { INVITATION_STATUS } from '../models/InvitationToken.js';
import { hashToken }         from '../../../utils/crypto.js';

// ─── Refresh Token ────────────────────────────────────────────────────────────

export const createRefreshToken = (data) =>
  RefreshToken.create(data);

/**
 * findRefreshToken — finds a non-revoked refresh token by its plain value.
 * Hashes the plain token before querying (we only store hashes).
 */
export const findRefreshToken = (plainToken) =>
  RefreshToken.findOne({
    tokenHash: hashToken(plainToken),
    isRevoked: false,
    expiresAt: { $gt: new Date() },
  });

export const findRefreshTokenByHash = (tokenHash) =>
  RefreshToken.findOne({ tokenHash, isRevoked: false, expiresAt: { $gt: new Date() } });

export const revokeRefreshToken = (tokenHash) =>
  RefreshToken.findOneAndUpdate(
    { tokenHash },
    { $set: { isRevoked: true, revokedAt: new Date() } }
  );

/**
 * revokeAllUserRefreshTokens — log out all devices for a user.
 */
export const revokeAllUserRefreshTokens = (userId) =>
  RefreshToken.updateMany(
    { userId, isRevoked: false },
    { $set: { isRevoked: true, revokedAt: new Date() } }
  );

export const getActiveSessionsByUser = (userId) =>
  RefreshToken.find({ userId, isRevoked: false, expiresAt: { $gt: new Date() } });

export const countActiveSessionsByUser = (userId) =>
  RefreshToken.countDocuments({ userId, isRevoked: false, expiresAt: { $gt: new Date() } });

export const deleteRefreshTokenByHash = (tokenHash) =>
  RefreshToken.deleteOne({ tokenHash });

/**
 * revokeRefreshTokenBySessionId — revokes ONE specific session by its
 * sessionId, scoped to a specific userId. Deliberately scoped by BOTH
 * fields, not sessionId alone -- a user must only ever be able to revoke
 * their OWN sessions, never someone else's by guessing/enumerating a
 * sessionId. Returns the updated doc, or null if no matching active
 * session existed for that user (used by the service layer to return a
 * real 404 instead of a false "success").
 */
export const revokeRefreshTokenBySessionId = (userId, sessionId) =>
  RefreshToken.findOneAndUpdate(
    { userId, sessionId, isRevoked: false },
    { $set: { isRevoked: true, revokedAt: new Date() } }
  );

// ─── Password Reset Token ─────────────────────────────────────────────────────

export const createPasswordResetToken = (data) =>
  PasswordResetToken.create(data);

export const findPasswordResetToken = (plainToken) =>
  PasswordResetToken.findOne({
    tokenHash: hashToken(plainToken),
    isUsed:    false,
    expiresAt: { $gt: new Date() },
  });

export const markPasswordResetTokenUsed = (id) =>
  PasswordResetToken.findByIdAndUpdate(id, {
    $set: { isUsed: true, usedAt: new Date() },
  });

export const invalidateExistingResetTokens = (userId) =>
  PasswordResetToken.updateMany(
    { userId, isUsed: false },
    { $set: { isUsed: true, usedAt: new Date() } }
  );

// ─── Email Verification Token ─────────────────────────────────────────────────

export const createEmailVerificationToken = (data) =>
  EmailVerificationToken.create(data);

export const findEmailVerificationToken = (plainToken) =>
  EmailVerificationToken.findOne({
    tokenHash: hashToken(plainToken),
    isUsed:    false,
    expiresAt: { $gt: new Date() },
  });

export const markEmailVerificationTokenUsed = (id) =>
  EmailVerificationToken.findByIdAndUpdate(id, {
    $set: { isUsed: true, usedAt: new Date() },
  });

export const invalidateExistingVerificationTokens = (userId) =>
  EmailVerificationToken.updateMany(
    { userId, isUsed: false },
    { $set: { isUsed: true, usedAt: new Date() } }
  );

// ─── Invitation Token ──────────────────────────────────────────────────────────

export const createInvitationToken = (data) =>
  InvitationToken.create(data);

/**
 * findInvitationToken — looks up a PENDING, non-expired invitation by its
 * plain token. Returns null for an expired or already-accepted one, same
 * shape of check as findPasswordResetToken/findEmailVerificationToken.
 */
export const findInvitationToken = (plainToken) =>
  InvitationToken.findOne({
    tokenHash: hashToken(plainToken),
    status:    INVITATION_STATUS.PENDING,
    expiresAt: { $gt: new Date() },
  });

/**
 * findInvitationTokenIncludingExpired — same lookup but without the status/
 * expiry filter, so the accept-invitation page can distinguish "genuinely
 * doesn't exist" from "exists but expired/already accepted" and show the
 * right message instead of a generic error either way.
 */
export const findInvitationTokenIncludingExpired = (plainToken) =>
  InvitationToken.findOne({ tokenHash: hashToken(plainToken) });

export const markInvitationAccepted = (id) =>
  InvitationToken.findByIdAndUpdate(id, {
    $set: { status: INVITATION_STATUS.ACCEPTED, acceptedAt: new Date() },
  });

/**
 * invalidateExistingInvitations — marks any still-pending invitation for
 * this user as expired. Used when re-inviting someone (see
 * team.service.js resendInvitation) so an old link can't be used
 * alongside a freshly issued one -- same "invalidate the old one first"
 * approach as invalidateExistingResetTokens/invalidateExistingVerificationTokens.
 */
export const invalidateExistingInvitations = (userId) =>
  InvitationToken.updateMany(
    { userId, status: INVITATION_STATUS.PENDING },
    { $set: { status: INVITATION_STATUS.EXPIRED } }
  );

export const findPendingInvitationByEmail = (tenantId, email) =>
  InvitationToken.findOne({
    tenantId,
    email:     String(email).toLowerCase(),
    status:    INVITATION_STATUS.PENDING,
    expiresAt: { $gt: new Date() },
  });