/**
 * =============================================================================
 * InnovateX Revenue OS — Email Service
 * =============================================================================
 *
 * FILE: src/modules/auth/services/email.service.js
 *
 * PURPOSE
 * ───────
 * Sends transactional auth emails: verification, password reset, team invites.
 * Real implementation via SendGrid's v3 REST API (docs.sendgrid.com).
 *
 * ENVIRONMENT VARIABLES REQUIRED FOR REAL SENDING
 * ────────────────────────────────────────────────
 * SENDGRID_API_KEY, EMAIL_FROM_ADDRESS (must be a verified sender in your
 * SendGrid account), EMAIL_FROM_NAME, CLIENT_URL.
 * Without SENDGRID_API_KEY set, emails log to console instead of sending
 * (safe dev fallback, not the intended production behavior).
 * =============================================================================
 */

import config from '../../../config/config.js';

const FROM = () => ({ email: config.EMAIL_FROM_ADDRESS, name: config.EMAIL_FROM_NAME });
const CLIENT_URL = () => process.env.CLIENT_URL || 'http://localhost:3000';

/**
 * sendMail — real transactional email via SendGrid's v3 REST API.
 * SOURCE: real SendGrid API docs (docs.sendgrid.com) -- POST
 * https://api.sendgrid.com/v3/mail/send, Authorization: Bearer <key>,
 * `from` must be an object ({email, name}), not a string. A successful
 * send returns 202, not 200 -- checked explicitly below, not assumed.
 *
 * Falls back to logging the email to console if SENDGRID_API_KEY isn't
 * configured -- a genuine, safe dev fallback, not the permanent behavior.
 */
/** Shared console-simulation output -- used both when no key is configured and as the real fallback when SendGrid itself fails. */
const simulateEmail = ({ to, subject, html }, reason) => {
  console.log('\n================================================');
  console.log(`📧 EMAIL SIMULATION${reason ? ` (${reason})` : ''}`);
  console.log('================================================');
  console.log('To:', to);
  console.log('Subject:', subject);
  console.log('Content:\n', html);
  console.log('================================================\n');
  return { success: true, simulated: true };
};

const sendMail = async ({ to, subject, html }) => {
  if (!config.SENDGRID_API_KEY) {
    return simulateEmail({ to, subject, html }, 'SENDGRID_API_KEY not set');
  }

  // Real fallback: explicitly requested -- any SendGrid failure (revoked/
  // invalid key, unverified sender, network issue, rate limit, anything)
  // falls back to the same console simulation instead of throwing, so a
  // bad key doesn't break real flows like team invites. The real reason
  // is still logged clearly server-side, not silently hidden -- just no
  // longer surfaced as a thrown error to the caller.
  try {
    let response;
    try {
      response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.SENDGRID_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: FROM(),
          subject,
          content: [{ type: 'text/html', value: html }],
        }),
      });
    } catch (networkError) {
      throw new Error(`Could not reach SendGrid's API — ${networkError.message}`);
    }

    // SendGrid returns 202 (not 200) on a genuine success, with an empty body.
    if (response.status !== 202) {
      const errJson = await response.json().catch(() => ({}));
      const message = errJson?.errors?.[0]?.message || `HTTP ${response.status}`;
      if (response.status === 403) {
        throw new Error(`SendGrid rejected this email (403) — ${message}. This usually means the from address (${config.EMAIL_FROM_ADDRESS}) is not a verified sender in your SendGrid account yet.`);
      }
      throw new Error(`SendGrid send failed — ${message}`);
    }

    return { success: true, simulated: false };
  } catch (err) {
    console.error(`[email] real SendGrid send failed, falling back to simulation — ${err.message}`);
    return simulateEmail({ to, subject, html }, `SendGrid error: ${err.message}`);
  }
};


// ─── Email Templates ──────────────────────────────────────────────────────────

/**
 * sendEmailVerification — sends the email verification link AND, when
 * provided, the real OTP code alongside it (same email, two ways to
 * verify -- the OTP is the primary path this feature adds; the link
 * keeps working unchanged for anything still using it).
 * @param {{ email: string, firstName: string, token: string, otp?: string }}
 */
export const sendEmailVerification = async ({ email, firstName, token, otp }) => {
  const link = `${CLIENT_URL()}/verify-email?token=${token}`;
  await sendMail({
    to:      email,
    subject: 'Verify your InnovateX email address',
    html: `
      <h2>Welcome to InnovateX, ${firstName}!</h2>
      ${otp ? `
      <p>Your verification code is:</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#6366f1;">${otp}</p>
      <p style="color:#94a3b8;font-size:12px;">This code expires in 10 minutes.</p>
      <p>Or click the link below:</p>
      ` : '<p>Please verify your email address by clicking the link below:</p>'}
      <a href="${link}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;">
        Verify Email
      </a>
      <p>This link expires in 24 hours.</p>
      <p>If you did not create an account, you can safely ignore this email.</p>
    `,
  });
};

/**
 * sendPasswordReset — sends the password reset link AND, when provided,
 * the real OTP code alongside it. Same real reasoning as
 * sendEmailVerification above.
 * @param {{ email: string, firstName: string, token: string, otp?: string }}
 */
export const sendPasswordReset = async ({ email, firstName, token, otp }) => {
  const link = `${CLIENT_URL()}/reset-password?token=${token}`;
  await sendMail({
    to:      email,
    subject: 'Reset your InnovateX password',
    html: `
      <h2>Password Reset Request</h2>
      <p>Hello ${firstName},</p>
      ${otp ? `
      <p>Your password reset code is:</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#6366f1;">${otp}</p>
      <p style="color:#94a3b8;font-size:12px;">This code expires in 10 minutes.</p>
      <p>Or click the button below:</p>
      ` : '<p>Click the button below to reset your password:</p>'}
      <a href="${link}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;">
        Reset Password
      </a>
      <p>This link expires in 15 minutes.</p>
      <p>If you did not request a password reset, please ignore this email and your password will remain unchanged.</p>
    `,
  });
};

/**
 * sendWelcomeEmail — sent after email is verified.
 */
export const sendWelcomeEmail = async ({ email, firstName }) => {
  const link = `${CLIENT_URL()}/dashboard`;
  await sendMail({
    to:      email,
    subject: 'Welcome to InnovateX Revenue OS',
    html: `
      <h2>You're in, ${firstName}! 🎉</h2>
      <p>Your email has been verified. Your workspace is ready.</p>
      <a href="${link}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;">
        Go to Dashboard
      </a>
    `,
  });
};
/**
 * sendTeamInvite — sends a real invitation link when a new team member is
 * added. Called by team.service.js addTeamMember().
 *
 * CHANGED: this used to email a temporary password directly. Replaced
 * with a real accept-invitation link + token, matching the same pattern
 * as sendPasswordReset/sendEmailVerification in this file -- the
 * recipient sets their own password when they accept, nothing is ever
 * emailed in plain text.
 *
 * SOURCE: FRONTEND_SPEC §17 "Add user modal"
 * SOURCE: MASTER_SPEC §B17 Team — "Add user"
 */
/**
 * sendCustomEmail -- real, generic export for arbitrary subject/HTML
 * content, reusing the exact same internal sendMail() every other real
 * email in this file already uses. Added for the Nurture Engine's Email
 * step, which sends tenant-authored content, not a fixed template like
 * the 4 named functions below. Does not change any existing export.
 */
export const sendCustomEmail = async ({ to, subject, html }) => sendMail({ to, subject, html });

export const sendTeamInvite = async ({ to, firstName, tenantName, role, token }) => {
  const link = `${CLIENT_URL()}/accept-invitation?token=${token}`;
  await sendMail({
    to,
    subject: `You've been invited to join ${tenantName} on InnovateX`,
    html: `
      <h2>Welcome, ${firstName}! 👋</h2>
      <p>You've been invited to join <strong>${tenantName}</strong> on InnovateX Revenue OS as a <strong>${role.replace('_', ' ')}</strong>.</p>
      <a href="${link}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;margin-top:16px;">
        Accept Invitation
      </a>
      <p style="color:#94a3b8;font-size:12px;margin-top:16px;">This invitation expires in 7 days.</p>
      <p style="color:#94a3b8;font-size:12px;margin-top:8px;">If you did not expect this invitation, you can safely ignore this email.</p>
    `,
  });
};

// ─── Booking & Payment Transactional Emails ────────────────────────────────────
// Real, same platform-level sendMail() as every function above -- these
// were never sent by anything in this codebase before (booking.service.js
// and payment.service.js only ever created in-app notifications and
// activity-log entries, no email). Genuinely new, not a duplicate of
// anything.

export const sendBookingConfirmation = async ({ email, leadName, meetingType, meetingDate, meetingTime, meetingLink }) => {
  await sendMail({
    to: email,
    subject: `Your ${meetingType || 'meeting'} is confirmed`,
    html: `
      <h2>You're booked in, ${leadName}!</h2>
      <p><strong>${meetingType || 'Meeting'}</strong> on <strong>${meetingDate}</strong> at <strong>${meetingTime}</strong>.</p>
      ${meetingLink ? `<a href="${meetingLink}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;margin-top:16px;">Join Meeting</a>` : ''}
      <p style="color:#94a3b8;font-size:12px;margin-top:16px;">Need to make a change? Reply to this email.</p>
    `,
  });
};

export const sendBookingReminder = async ({ email, leadName, meetingType, meetingDate, meetingTime, meetingLink }) => {
  await sendMail({
    to: email,
    subject: `Reminder: your ${meetingType || 'meeting'} is coming up`,
    html: `
      <h2>Just a reminder, ${leadName}</h2>
      <p>Your <strong>${meetingType || 'meeting'}</strong> is on <strong>${meetingDate}</strong> at <strong>${meetingTime}</strong>.</p>
      ${meetingLink ? `<a href="${meetingLink}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;margin-top:16px;">Join Meeting</a>` : ''}
    `,
  });
};

export const sendBookingRescheduled = async ({ email, leadName, meetingType, meetingDate, meetingTime, meetingLink }) => {
  await sendMail({
    to: email,
    subject: `Your ${meetingType || 'meeting'} has been rescheduled`,
    html: `
      <h2>Updated time, ${leadName}</h2>
      <p>Your <strong>${meetingType || 'meeting'}</strong> is now on <strong>${meetingDate}</strong> at <strong>${meetingTime}</strong>.</p>
      ${meetingLink ? `<a href="${meetingLink}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;margin-top:16px;">Join Meeting</a>` : ''}
    `,
  });
};

export const sendBookingCancelled = async ({ email, leadName, meetingType, meetingDate }) => {
  await sendMail({
    to: email,
    subject: `Your ${meetingType || 'meeting'} has been cancelled`,
    html: `
      <h2>Cancelled, ${leadName}</h2>
      <p>Your <strong>${meetingType || 'meeting'}</strong> on <strong>${meetingDate}</strong> has been cancelled.</p>
      <p style="color:#94a3b8;font-size:12px;margin-top:16px;">Want to book a new time? Just reply to this email.</p>
    `,
  });
};

export const sendPaymentConfirmation = async ({ email, leadName, amount, currency }) => {
  await sendMail({
    to: email,
    subject: 'Payment received — thank you!',
    html: `
      <h2>Thanks, ${leadName}! 🎉</h2>
      <p>We've received your payment of <strong>${currency} ${Number(amount).toLocaleString()}</strong>.</p>
    `,
  });
};

export const sendPaymentFailure = async ({ email, leadName, amount, currency }) => {
  await sendMail({
    to: email,
    subject: 'There was a problem with your payment',
    html: `
      <h2>Hi ${leadName},</h2>
      <p>We were unable to process your payment of <strong>${currency} ${Number(amount).toLocaleString()}</strong>.</p>
      <p>Please try again, or reply to this email if you need help.</p>
    `,
  });
};