/**
 * =============================================================================
 * InnovateX Revenue OS — Email Service
 * =============================================================================
 *
 * FILE: src/modules/auth/services/email.service.js
 *
 * PURPOSE
 * ───────
 * Sends transactional auth emails: verification, password reset.
 * Uses nodemailer with SMTP. Swap to SES/SendGrid by changing the transport.
 *
 * PACKAGES REQUIRED
 * ─────────────────
 * npm install nodemailer
 *
 * ENVIRONMENT VARIABLES REQUIRED
 * ───────────────────────────────
 * EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS, EMAIL_FROM, CLIENT_URL
 * =============================================================================
 */

// NOTE: nodemailer is not in current package.json — add it:
// npm install nodemailer
// For now we log to console in dev if nodemailer is unavailable.

let nodemailer;
try {
  nodemailer = (await import('nodemailer')).default;
} catch {
  nodemailer = null;
}

const createTransport = () => {
  if (!nodemailer) return null;
  return nodemailer.createTransport({
    host:   process.env.EMAIL_HOST   || 'smtp.mailtrap.io',
    port:   parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_PORT === '465',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

const FROM = () => process.env.EMAIL_FROM || '"InnovateX" <noreply@innovatex.io>';
const CLIENT_URL = () => process.env.CLIENT_URL || 'http://localhost:3000';

//right now due to testing purpose we are not using nodemailer and just logging the email content to console. In production we can remove the comment line below and use nodemailer to send the email.
// const sendMail = async ({ to, subject, html }) => {
//   const transport = createTransport();
//   if (!transport) {
//     // Dev fallback — log to console
//     console.log(`\n📧 [DEV EMAIL]\nTo: ${to}\nSubject: ${subject}\n${html}\n`);
//     return;
//   }
//   await transport.sendMail({ from: FROM(), to, subject, html });
// };


//after testing remove this code section and uncomment the above code section to use nodemailer to send the email.
const sendMail = async ({ to, subject, html }) => {
const isDevelopment = process.env.NODE_ENV !== 'production';

// Development Mode
if (isDevelopment) {
console.log('\n================================================');
console.log('📧 EMAIL SIMULATION (Development Mode)');
console.log('================================================');
console.log('To:', to);
console.log('Subject:', subject);
console.log('Content:\n', html);
console.log('================================================\n');


return {
  success: true,
  simulated: true,
};


}

// Production Mode
if (!process.env.EMAIL_HOST ||
!process.env.EMAIL_USER ||
!process.env.EMAIL_PASS) {
throw new Error(
'Email configuration missing. Check EMAIL_HOST, EMAIL_USER and EMAIL_PASS.'
);
}

const transport = createTransport();

await transport.sendMail({
from: FROM(),
to,
subject,
html,
});

return {
success: true,
simulated: false,
};
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