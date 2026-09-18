/**
 * =============================================================================
 * InnovateX Revenue OS — Token Repository
 * =============================================================================
 *
 * FILE: src/modules/auth/repositories/token.repository.js
 *
 * PURPOSE
 * ───────
 * NOTE ON `isRotated: { $ne: true }`
 * ──────────────────────────────────
 * Every active-token query below matches on { $ne: true }, never on `false`.
 * Rows written before the isRotated field existed don't carry the field at
 * all, and MongoDB's { isRotated: false } does NOT match a document where the
 * field is missing -- so a plain `false` would stop matching every session
 * that was already live when this shipped, logging all existing users out on
 * their next refresh. Mongoose schema defaults don't cover this: they apply to
 * documents in memory, not to the query the database actually runs.
 *
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
    isRotated: { $ne: true },
    expiresAt: { $gt: new Date() },
  });

export const findRefreshTokenByHash = (tokenHash) =>
  RefreshToken.findOne({ tokenHash, isRevoked: false, isRotated: { $ne: true }, expiresAt: { $gt: new Date() } });

/**
 * findAnyRefreshTokenByHash — lookup WITHOUT the isRotated/expiry filters.
 * Used only by the rotation-grace check in auth.service.js, which genuinely
 * needs to see a row that findRefreshToken deliberately hides (a token that
 * was rotated moments ago). Never use this to authenticate a request.
 */
export const findAnyRefreshTokenByHash = (tokenHash) =>
  RefreshToken.findOne({ tokenHash });

/**
 * markRefreshTokenRotated — atomically claims a refresh token for rotation.
 *
 * The condition { isRotated: { $ne: true }, isRevoked: false } is the whole point:
 * MongoDB applies findOneAndUpdate atomically, so when two concurrent refresh
 * calls race, exactly ONE gets the document back and the other gets null. The
 * winner rotates; the loser is handled by the grace path instead of being
 * treated as an attacker. The previous implementation used deleteOne() and
 * then checked the result object for truthiness -- which is always true in
 * Mongoose, even when deletedCount is 0 -- so it could never detect the race
 * at all.
 *
 * expiresAt is shortened to the end of the grace window so the TTL index
 * cleans these rows up on its own instead of leaving 7 days of dead rotated
 * tokens behind.
 *
 * @returns {Promise<RefreshToken|null>} the claimed doc, or null if another
 *          request already claimed it (or it was revoked)
 */
export const markRefreshTokenRotated = (tokenHash, { replacedByTokenHash = null, graceSeconds = 30 } = {}) =>
  RefreshToken.findOneAndUpdate(
    { tokenHash, isRotated: { $ne: true }, isRevoked: false },
    {
      $set: {
        isRotated:           true,
        rotatedAt:           new Date(),
        replacedByTokenHash,
        expiresAt:           new Date(Date.now() + graceSeconds * 1000),
      },
    },
    { new: true }
  );

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

/**
 * getActiveSessionsByUser — real device sessions, oldest first.
 *
 * isRotated is excluded so a token that's only alive for the grace window
 * never shows up in the user's "active devices" list or counts against
 * MAX_ACTIVE_SESSIONS. Sorted by createdAt because issueTokenPair evicts
 * oldest[0] when the session limit is hit -- without an explicit sort that
 * was whatever order Mongo happened to return, so the "oldest" session
 * evicted could just as easily have been the newest one.
 */
export const getActiveSessionsByUser = (userId) =>
  RefreshToken.find({ userId, isRevoked: false, isRotated: { $ne: true }, expiresAt: { $gt: new Date() } })
    .sort({ createdAt: 1 });

export const countActiveSessionsByUser = (userId) =>
  RefreshToken.countDocuments({ userId, isRevoked: false, isRotated: { $ne: true }, expiresAt: { $gt: new Date() } });

/**
 * deleteRefreshTokenByHash — hard-deletes a token row.
 *
 * Returns a real boolean, not Mongoose's { acknowledged, deletedCount }
 * result object. Callers used to do `if (!deleted)` against that object,
 * which is truthy even when deletedCount is 0, so a failed delete read as a
 * successful one.
 *
 * No longer used by rotation (see markRefreshTokenRotated) -- kept for any
 * caller that genuinely wants the row gone.
 */
export const deleteRefreshTokenByHash = async (tokenHash) => {
  const result = await RefreshToken.deleteOne({ tokenHash });
  return (result?.deletedCount ?? 0) > 0;
};

/**
 * linkRotatedToken — records which token replaced a rotated one.
 * Audit/debug only; nothing authenticates against this field.
 */
export const linkRotatedToken = (oldTokenHash, newTokenHash) =>
  RefreshToken.updateOne({ tokenHash: oldTokenHash }, { $set: { replacedByTokenHash: newTokenHash } });

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

/**
 * findLatestPasswordResetOtpRecord -- looks up by EMAIL, not by hashing a
 * submitted value, because the real OTP-entry form only has the user's
 * email + the 6-digit code they typed, not the original 32-byte link
 * token this same document also stores. Returns the newest matching
 * unused, unexpired record with an OTP actually issued on it.
 */
export const findLatestPasswordResetOtpRecord = (email) =>
  PasswordResetToken.findOne({
    email:     String(email).toLowerCase(),
    isUsed:    false,
    expiresAt: { $gt: new Date() },
    otpHash:   { $ne: null },
  }).sort({ createdAt: -1 });

export const incrementPasswordResetOtpAttempts = (id) =>
  PasswordResetToken.findByIdAndUpdate(id, { $inc: { otpAttempts: 1 } }, { new: true });

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

/**
 * findLatestEmailVerificationOtpRecord -- same real reasoning as
 * findLatestPasswordResetOtpRecord above: looked up by email, since the
 * OTP-entry form doesn't have the original link token to hash-match.
 */
export const findLatestEmailVerificationOtpRecord = (email) =>
  EmailVerificationToken.findOne({
    email:     String(email).toLowerCase(),
    isUsed:    false,
    expiresAt: { $gt: new Date() },
    otpHash:   { $ne: null },
  }).sort({ createdAt: -1 });

export const incrementEmailVerificationOtpAttempts = (id) =>
  EmailVerificationToken.findByIdAndUpdate(id, { $inc: { otpAttempts: 1 } }, { new: true });

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