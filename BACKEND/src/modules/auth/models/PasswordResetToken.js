/**
 * =============================================================================
 * InnovateX Revenue OS — PasswordResetToken Model
 * =============================================================================
 *
 * FILE: src/modules/auth/models/PasswordResetToken.js
 *
 * COLLECTION: password_reset_tokens
 * TTL: 15 minutes (via expiresAt TTL index)
 * =============================================================================
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

const passwordResetTokenSchema = new Schema(
  {
    userId: {
      type:     Schema.Types.ObjectId,
      ref:      'User',
      required: true,
      index:    true,
    },
    email: {
      type:     String,
      required: true,
      lowercase: true,
    },
    // SHA-256 hash of the token sent to the user's email
    tokenHash: {
      type:     String,
      required: true,
      unique:   true,
    },
    expiresAt: {
      type:     Date,
      required: true,
    },
    isUsed: {
      type:    Boolean,
      default: false,
    },
    usedAt: {
      type:    Date,
      default: null,
    },
    // Real OTP support, alongside the existing link -- same document,
    // same TTL/isUsed lifecycle, not a separate collection.
    otpHash: {
      type:    String,
      default: null,
    },
    otpAttempts: {
      type:    Number,
      default: 0,
    },
    // IP that requested the reset (for security logging)
    requestedFromIp: {
      type:    String,
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

// TTL — auto-delete after expiresAt
passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Find latest token for a user quickly
passwordResetTokenSchema.index({ userId: 1, isUsed: 1 });

export default mongoose.model('PasswordResetToken', passwordResetTokenSchema, 'password_reset_tokens');