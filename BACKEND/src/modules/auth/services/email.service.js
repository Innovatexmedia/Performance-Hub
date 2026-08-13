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
const sendMail = async ({ to, subject, html }) => {
  if (!config.SENDGRID_API_KEY) {
    console.log('\n================================================');
    console.log('📧 EMAIL SIMULATION (SENDGRID_API_KEY not set)');
    console.log('================================================');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log('Content:\n', html);
    console.log('================================================\n');
    return { success: true, simulated: true };
  }

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
};


// ─── Email Templates ──────────────────────────────────────────────────────────

/**
 * sendEmailVerification — sends the email verification link.
 * @param {{ email: string, firstName: string, token: string }}
 */
export const sendEmailVerification = async ({ email, firstName, token }) => {
  const link = `${CLIENT_URL()}/verify-email?token=${token}`;
  await sendMail({
    to:      email,
    subject: 'Verify your InnovateX email address',
    html: `
      <h2>Welcome to InnovateX, ${firstName}!</h2>
      <p>Please verify your email address by clicking the link below:</p>
      <a href="${link}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;">
        Verify Email
      </a>
      <p>This link expires in 24 hours.</p>
      <p>If you did not create an account, you can safely ignore this email.</p>
    `,
  });
};

/**
 * sendPasswordReset — sends the password reset link.
 * @param {{ email: string, firstName: string, token: string }}
 */
export const sendPasswordReset = async ({ email, firstName, token }) => {
  const link = `${CLIENT_URL()}/reset-password?token=${token}`;
  await sendMail({
    to:      email,
    subject: 'Reset your InnovateX password',
    html: `
      <h2>Password Reset Request</h2>
      <p>Hello ${firstName},</p>
      <p>Click the button below to reset your password:</p>
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