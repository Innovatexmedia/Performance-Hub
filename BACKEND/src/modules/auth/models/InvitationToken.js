/**
 * =============================================================================
 * InnovateX Revenue OS — InvitationToken Model
 * =============================================================================
 *
 * FILE: src/modules/auth/models/InvitationToken.js
 *
 * Mirrors PasswordResetToken.js's exact pattern (hashed token storage, TTL
 * auto-cleanup, toJSON stripping the hash) -- this is the same established
 * token pattern used for password reset and email verification, extended
 * with the fields an invitation genuinely needs (tenantId, role, status,
 * invitedBy) that those simpler tokens don't.
 *
 * COLLECTION: invitation_tokens
 * TTL: cleaned up 7 days after expiresAt (kept slightly past expiry, unlike
 * password reset's immediate cleanup, so an expired invitation can still be
 * looked up long enough to show a clear "this invite expired" message
 * rather than a generic "not found").
 * =============================================================================
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

export const INVITATION_STATUS = Object.freeze({
  PENDING:  'pending',
  ACCEPTED: 'accepted',
  EXPIRED:  'expired',
});
export const INVITATION_STATUS_VALUES = Object.freeze(Object.values(INVITATION_STATUS));

const invitationTokenSchema = new Schema(
  {
    userId: {
      // The PENDING User record this invitation is for -- created
      // alongside the invitation (see team.service.js addTeamMember),
      // not created at acceptance time.
      type:     Schema.Types.ObjectId,
      ref:      'User',
      required: true,
      index:    true,
    },
    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      'Tenant',
      required: true,
      index:    true,
    },
    email: {
      type:      String,
      required:  true,
      lowercase: true,
    },
    role: {
      type:     String,
      required: true,
    },
    invitedBy: {
      type:     Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },
    // SHA-256 hash of the token sent in the invitation email link --
    // same hashing approach as PasswordResetToken/RefreshToken, never
    // store the plain token.
    tokenHash: {
      type:     String,
      required: true,
      unique:   true,
    },
    status: {
      type:    String,
      enum:    INVITATION_STATUS_VALUES,
      default: INVITATION_STATUS.PENDING,
      index:   true,
    },
    expiresAt: {
      type:     Date,
      required: true,
    },
    acceptedAt: {
      type:    Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        delete ret.tokenHash;
        return ret;
      },
    },
  }
);

// Cleaned up 7 days after expiry -- kept slightly past expiresAt (unlike
// password reset's immediate TTL) so an expired invite can still be
// looked up long enough to show a real "this invite expired" message.
invitationTokenSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 7 }
);
// One pending invitation per user at a time -- look up quickly, and this
// also backs the "invalidate the old one when re-inviting" flow.
invitationTokenSchema.index({ userId: 1, status: 1 });

export default mongoose.model('InvitationToken', invitationTokenSchema, 'invitation_tokens');