/**
 * =============================================================================
 * InnovateX Revenue OS — Membership Model
 * =============================================================================
 *
 * FILE: src/modules/auth/models/Membership.js
 *
 * PURPOSE
 * ───────
 * Enables one User to belong to MULTIPLE Tenants (workspaces), each with
 * its own role -- the actual mechanism behind the "switch workspace"
 * dropdown. This is genuinely new; before this, User.tenantId/User.role
 * was a strict 1-to-1 relationship.
 *
 * BACKWARD COMPATIBILITY -- IMPORTANT
 * ────────────────────────────────────
 * User.tenantId / User.role are NOT removed and NOT deprecated. They
 * continue to represent the user's PRIMARY (first/default) membership --
 * every existing piece of this app that reads req.user.tenantId from the
 * JWT keeps working completely unchanged. This model is purely ADDITIVE:
 * a mechanism for a SECOND (or third, etc.) membership on top of the
 * existing primary one, not a replacement for it.
 *
 * Every registration path (_registerTenantOwner, _registerTenantMember)
 * now also creates a Membership row alongside the existing User/Tenant
 * records, so the primary membership is always mirrored here too --
 * meaning "how many workspaces does this user belong to" can always be
 * answered by counting Membership rows, without special-casing the
 * "first" one differently from later ones.
 *
 * STATUS
 * ──────
 * 'pending'  — invited, hasn't accepted yet (mirrors USER_STATUS.PENDING,
 *              same concept, already anticipated there)
 * 'active'   — accepted, can log into this workspace
 * 'revoked'  — access removed; kept for audit history, not deleted
 * =============================================================================
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

export const MEMBERSHIP_STATUS = Object.freeze({
  PENDING: 'pending',
  ACTIVE:  'active',
  REVOKED: 'revoked',
});
export const MEMBERSHIP_STATUS_VALUES = Object.freeze(Object.values(MEMBERSHIP_STATUS));

const membershipSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    role: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: MEMBERSHIP_STATUS_VALUES,
      default: MEMBERSHIP_STATUS.ACTIVE,
    },
    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    invitedAt: { type: Date, default: null },
    joinedAt:  { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    revokedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
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
        return ret;
      },
    },
  },
);

// One membership per user-per-tenant -- prevents duplicate rows if someone
// is invited twice, or re-registers the same primary membership.
membershipSchema.index({ userId: 1, tenantId: 1 }, { unique: true });

// "List all workspaces this user belongs to" -- the switch-workspace dropdown's core query.
membershipSchema.index({ userId: 1, status: 1 });

export default mongoose.model('Membership', membershipSchema);