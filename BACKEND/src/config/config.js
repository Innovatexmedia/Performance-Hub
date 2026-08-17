/**
 * App configuration.
 * FILE: src/config/config.js
 *
 * WHAT CHANGED:
 *   - Removed JWT_SECRET check (old — never existed in this project)
 *   - JWT is validated by env.js using JWT_ACCESS_SECRET + JWT_REFRESH_SECRET
 */

import dotenv from 'dotenv';
dotenv.config();

if (!process.env.PORT) {
  throw new Error('PORT not found in environment variables');
}

if (!process.env.MONGODB_URI) {
  throw new Error('MONGODB_URI not found in environment variables');
}

const config = {
  PORT:        process.env.PORT || 4000,
  MONGODB_URI: process.env.MONGODB_URI,
  NODE_ENV:    process.env.NODE_ENV || 'development',
  // The backend's own PUBLIC-facing URL -- used to construct the real Meta
  // webhook URL (/api/whatsapp/webhooks/meta/:tenantId) shown in Settings.
  // NOT the same as CLIENT_URL (that's the frontend's origin) and NOT
  // derivable from a browser request (the frontend only knows ITS OWN
  // origin, not the backend's -- which could be an ngrok tunnel or a
  // separate production domain entirely). Falls back to localhost for
  // local dev, but that fallback genuinely won't work as a real webhook
  // target -- Meta can't reach localhost. Set this explicitly (e.g. your
  // ngrok URL, or your real domain) for the webhook to actually function.
  API_BASE_URL: process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 4000}`,
  // Required to create a super_admin account via /auth/register -- without
  // this set, super_admin registration is permanently blocked (fails
  // closed, not open). Set this to a real, private secret and share it
  // only with whoever needs to create the first platform-staff account.
  SUPER_ADMIN_SECRET: process.env.SUPER_ADMIN_SECRET || null,
  // Real transactional email via SendGrid's REST API. Without this set,
  // email sending falls back to logging to console (safe for local dev,
  // but real users can't receive password resets, invites, or
  // verification emails until this is configured).
  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY || null,
  // SendGrid needs a bare email address (its API wants {email: "..."}),
  // not the "Display Name <email>" SMTP-style string an older EMAIL_FROM
  // var used. Also must be a verified sender in your SendGrid account,
  // or every send will fail with a real 403 -- this is SendGrid's own
  // requirement, not something this app can work around.
  EMAIL_FROM_ADDRESS: process.env.EMAIL_FROM_ADDRESS || 'noreply@innovatex.io',
  EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME || 'InnovateX',
  // Team member limits per plan -- configurable via env instead of a fixed
  // number in code. Defaults match the existing PLAN_LIMITS values, so
  // nothing changes unless these are explicitly set.
  PLAN_MAX_USERS_FREE:       parseInt(process.env.PLAN_MAX_USERS_FREE ?? '3', 10),
  PLAN_MAX_USERS_STARTER:    parseInt(process.env.PLAN_MAX_USERS_STARTER ?? '5', 10),
  PLAN_MAX_USERS_GROWTH:     parseInt(process.env.PLAN_MAX_USERS_GROWTH ?? '15', 10),
  PLAN_MAX_USERS_SCALE:      parseInt(process.env.PLAN_MAX_USERS_SCALE ?? '50', 10),
  PLAN_MAX_USERS_ENTERPRISE: parseInt(process.env.PLAN_MAX_USERS_ENTERPRISE ?? '999', 10),

  // Real Google Ads API access. The developer token and manager account
  // are platform-level (InnovateX applies for ONE developer token,
  // representing the whole product -- Google's real, documented model
  // is "one token per company", not one per tenant). Each tenant then
  // connects their OWN Google Ads account via OAuth2, using this shared
  // developer token + manager account to actually reach it.
  GOOGLE_ADS_DEVELOPER_TOKEN:    process.env.GOOGLE_ADS_DEVELOPER_TOKEN || null,
  GOOGLE_ADS_MANAGER_CUSTOMER_ID: process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID || null,
  GOOGLE_ADS_OAUTH_CLIENT_ID:     process.env.GOOGLE_ADS_OAUTH_CLIENT_ID || null,
  GOOGLE_ADS_OAUTH_CLIENT_SECRET: process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET || null,
  // Must exactly match a URI registered in Google Cloud Console's OAuth
  // client "Authorized redirect URIs" -- see the setup steps delivered
  // alongside this integration.
  GOOGLE_ADS_OAUTH_REDIRECT_URI:  process.env.GOOGLE_ADS_OAUTH_REDIRECT_URI || `${process.env.API_BASE_URL || 'http://localhost:4000'}/api/integrations/google-ads/oauth/callback`,

  // Real Shopify Partner app credentials -- platform-level, InnovateX
  // applies for ONE Shopify app (via a Partner account), and each
  // tenant then connects their own store to it via real OAuth.
  SHOPIFY_CLIENT_ID:     process.env.SHOPIFY_CLIENT_ID || null,
  SHOPIFY_CLIENT_SECRET: process.env.SHOPIFY_CLIENT_SECRET || null,
  SHOPIFY_OAUTH_REDIRECT_URI: process.env.SHOPIFY_OAUTH_REDIRECT_URI || `${process.env.API_BASE_URL || 'http://localhost:4000'}/api/shopify/oauth/callback`,
};

if (!process.env.SUPER_ADMIN_SECRET) {
  console.warn(
    '\n⚠️  SUPER_ADMIN_SECRET is not set.' +
    '\n   Creating a super_admin account via /auth/register is disabled until this is set.' +
    '\n   Set it to a real, private secret you control.\n'
  );
}

if (!process.env.SENDGRID_API_KEY) {
  console.warn(
    '\n⚠️  SENDGRID_API_KEY is not set.' +
    '\n   Emails (password reset, verification, team invites) will only log to console, not actually send.' +
    '\n   Set SENDGRID_API_KEY (and EMAIL_FROM_ADDRESS, verified in your SendGrid account) for real email delivery.\n'
  );
}

if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN || !process.env.GOOGLE_ADS_OAUTH_CLIENT_ID || !process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET) {
  console.warn(
    '\n⚠️  Google Ads API is not fully configured.' +
    '\n   Set GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_MANAGER_CUSTOMER_ID, GOOGLE_ADS_OAUTH_CLIENT_ID, and GOOGLE_ADS_OAUTH_CLIENT_SECRET.' +
    '\n   Until all four are set, tenants cannot connect a real Google Ads account -- the Connect button will show a clear setup-required error.\n'
  );
}

if (!process.env.SHOPIFY_CLIENT_ID || !process.env.SHOPIFY_CLIENT_SECRET) {
  console.warn(
    '\n⚠️  Shopify is not fully configured.' +
    '\n   Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET (from your Shopify Partner app).' +
    '\n   Until both are set, tenants cannot connect a real Shopify store -- the Connect button will show a clear setup-required error.\n'
  );
}

if (!process.env.API_BASE_URL) {
  console.warn(
    '\n⚠️  API_BASE_URL is not set.' +
    '\n   Falling back to http://localhost:' + (process.env.PORT || 4000) + ' -- Meta cannot reach this.' +
    '\n   Set API_BASE_URL to your public URL (ngrok tunnel or real domain) for the WhatsApp webhook to work.\n'
  );
}

export default config;