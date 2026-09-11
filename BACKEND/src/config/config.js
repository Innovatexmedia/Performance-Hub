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
  // Redis connection for BullMQ (campaign/broadcast send queue -- see
  // src/queues/). NOT required to boot the API server (unlike
  // MONGODB_URI) since only the send-campaign feature needs it, but the
  // worker process (src/worker.js) will fail fast without a reachable
  // Redis if you actually try to send a campaign. Defaults to a local
  // Redis for dev convenience.
  REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  // How many recipient sends a single worker process handles concurrently.
  // Real concurrency (not the old sequential loop's fixed sleep) -- tune
  // based on your WhatsApp provider's actual rate limits. Run multiple
  // worker PROCESSES (not just raise this number) to scale horizontally;
  // see src/worker.js.
  CAMPAIGN_SEND_CONCURRENCY: parseInt(process.env.CAMPAIGN_SEND_CONCURRENCY ?? '5', 10),
  // BullMQ rate limiter: at most this many jobs start per
  // CAMPAIGN_SEND_RATE_DURATION_MS window, shared across all concurrent
  // workers on this queue -- the real replacement for the old fixed
  // 300ms sleep-between-sends, and actually enforced queue-wide instead
  // of per-loop.
  CAMPAIGN_SEND_RATE_MAX: parseInt(process.env.CAMPAIGN_SEND_RATE_MAX ?? '20', 10),
  CAMPAIGN_SEND_RATE_DURATION_MS: parseInt(process.env.CAMPAIGN_SEND_RATE_DURATION_MS ?? '1000', 10),
  // CSV lead import -- higher default concurrency than campaign sending
  // is fine here since each job only does DB writes (no external Meta
  // API call to rate-limit against).
  LEAD_IMPORT_CONCURRENCY: parseInt(process.env.LEAD_IMPORT_CONCURRENCY ?? '10', 10),
  // Cloudinary -- stores media (images/documents/voice notes) sent and
  // received over WhatsApp. Required for real media messaging; text-only
  // messaging works fine without it (upload attempts fail with a clear
  // error rather than the app crashing at boot).
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || '',
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY || '',
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET || '',
  // WhatsApp Embedded Signup (Meta's "Continue with Facebook" onboarding
  // flow) -- these are APP-LEVEL, shared across every tenant, NOT
  // per-tenant like the manual-connect fields in WhatsAppSettings. That's
  // a real architectural difference, not an oversight: manual connect
  // lets each tenant use their OWN independent Meta app; Embedded Signup
  // works the opposite way -- ONE Meta app (InnovateX's own, approved as
  // a Meta Tech Provider) drives onboarding for ALL tenants, and Meta
  // hands back per-tenant results (a WABA id, phone number id, and a
  // short-lived code) that get exchanged and stored into that specific
  // tenant's WhatsAppSettings -- same fields the manual flow already
  // uses, just filled in a different way.
  //
  // Genuinely optional -- Meta gates the whole flow behind Tech Provider
  // approval (a real business-verification + App Review process with
  // Meta, not something achievable by writing code alone). Until these
  // are set, the feature stays hidden/disabled in the UI and manual
  // connect remains the only path -- nothing breaks by leaving these
  // blank.
  META_TECH_PROVIDER_APP_ID: process.env.META_TECH_PROVIDER_APP_ID || '',
  META_TECH_PROVIDER_APP_SECRET: process.env.META_TECH_PROVIDER_APP_SECRET || '',
  // From a Facebook Login for Business Configuration (Meta App Dashboard
  // > Facebook Login for Business > Configurations) -- created from the
  // "WhatsApp Embedded Signup Configuration" template, per Meta's docs.
  META_EMBEDDED_SIGNUP_CONFIG_ID: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || '',
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

  // Real Meta Business app credentials for Marketing API (ads reporting)
  // access -- platform-level (InnovateX's own Meta app), NOT stored
  // per-tenant, same "one app per company" model as Google Ads above.
  // Genuinely SEPARATE app/credentials from META_TECH_PROVIDER_* above,
  // which are for WhatsApp Embedded Signup -- a different Meta product
  // with its own app registration and scopes (whatsapp_business_management/
  // whatsapp_business_messaging vs this integration's real
  // ads_management/ads_read/read_insights/business_management scopes).
  META_ADS_APP_ID:     process.env.META_ADS_APP_ID || null,
  META_ADS_APP_SECRET: process.env.META_ADS_APP_SECRET || null,
  // Must exactly match a URI registered in the Meta app's "Valid OAuth
  // Redirect URIs" (App Dashboard -> Facebook Login for Business -> Settings).
  META_ADS_OAUTH_REDIRECT_URI: process.env.META_ADS_OAUTH_REDIRECT_URI || `${process.env.API_BASE_URL || 'http://localhost:4000'}/api/integrations/meta-ads/oauth/callback`,

  // Real Shopify Partner app credentials -- platform-level, InnovateX
  // applies for ONE Shopify app (via a Partner account), and each
  // tenant then connects their own store to it via real OAuth.
  SHOPIFY_CLIENT_ID:     process.env.SHOPIFY_CLIENT_ID || null,
  SHOPIFY_CLIENT_SECRET: process.env.SHOPIFY_CLIENT_SECRET || null,
  SHOPIFY_OAUTH_REDIRECT_URI: process.env.SHOPIFY_OAUTH_REDIRECT_URI || `${process.env.API_BASE_URL || 'http://localhost:4000'}/api/shopify/oauth/callback`,

  // Cashfree Subscriptions (real recurring mandate billing -- see
  // config/cashfree.js). NOTE: the previous Razorpay integration read
  // process.env.RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET directly in a couple
  // of call sites but was NEVER assigned onto this `config` object, so
  // `config.RAZORPAY_KEY_ID` was always undefined regardless of what was
  // set in .env -- billing was silently unconfigured in every
  // deployment. Fixed here: every Cashfree var actually lives on config.
  CASHFREE_APP_ID:         process.env.CASHFREE_APP_ID || '',
  CASHFREE_SECRET_KEY:     process.env.CASHFREE_SECRET_KEY || '',
  // 'sandbox' or 'production'. Also read directly by the frontend's
  // checkout SDK init (see settings.service.js's billing response) so
  // the client-side widget and server-side API calls always target the
  // same Cashfree environment.
  CASHFREE_ENV:            process.env.CASHFREE_ENV || 'sandbox',
  CASHFREE_API_VERSION:    process.env.CASHFREE_API_VERSION || '2025-01-01',
  // Optional -- see cashfree.js's verifyWebhookSignature. Leave unset to
  // verify with CASHFREE_SECRET_KEY, which is what Cashfree's own docs
  // specify.
  CASHFREE_WEBHOOK_SECRET: process.env.CASHFREE_WEBHOOK_SECRET || '',
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

if (!process.env.META_ADS_APP_ID || !process.env.META_ADS_APP_SECRET) {
  console.warn(
    '\n⚠️  Meta Ads (Marketing API) is not fully configured.' +
    '\n   Set META_ADS_APP_ID and META_ADS_APP_SECRET (from a real Meta Business app -- separate from META_TECH_PROVIDER_* above, which is for WhatsApp Embedded Signup).' +
    '\n   Until both are set, tenants cannot connect a real Meta Ads account -- the Connect button will show a clear setup-required error.\n'
  );
}

if (!process.env.SHOPIFY_CLIENT_ID || !process.env.SHOPIFY_CLIENT_SECRET) {
  console.warn(
    '\n⚠️  Shopify is not fully configured.' +
    '\n   Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET (from your Shopify Partner app).' +
    '\n   Until both are set, tenants cannot connect a real Shopify store -- the Connect button will show a clear setup-required error.\n'
  );
}

if (!process.env.CASHFREE_APP_ID || !process.env.CASHFREE_SECRET_KEY) {
  console.warn(
    '\n⚠️  Cashfree is not configured.' +
    '\n   Set CASHFREE_APP_ID and CASHFREE_SECRET_KEY (from your Cashfree Merchant Dashboard).' +
    '\n   Until both are set, paid plan checkout will return a clear setup-required error instead of starting a subscription.\n'
  );
}

if (!process.env.API_BASE_URL) {
  console.warn(
    '\n⚠️  API_BASE_URL is not set.' +
    '\n   Falling back to http://localhost:' + (process.env.PORT || 4000) + ' -- Meta cannot reach this.' +
    '\n   Set API_BASE_URL to your public URL (ngrok tunnel or real domain) for the WhatsApp webhook to work.\n'
  );
}

// CLIENT_URL drives app.js's CORS origin check. Missing it there falls
// back to `origin: '*'` while `credentials: true` stays on -- an
// inconsistent, effectively-undefined security posture rather than an
// explicit policy (most browsers refuse to honor credentialed requests
// against a wildcard origin per the Fetch spec, so the likely real
// failure mode is a confusing outage -- cookies silently rejected --
// not a clean error pointing at the actual cause). In production this
// now fails loudly at boot instead of silently degrading; in
// development it stays a warning, since CLIENT_URL is reasonably often
// left unset while testing locally.
if (!process.env.CLIENT_URL) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'CLIENT_URL is not set. Refusing to start in production with CORS falling back to a wildcard origin -- ' +
      'set CLIENT_URL to your real frontend origin (e.g. https://app.yourdomain.com).'
    );
  }
  console.warn(
    '\n⚠️  CLIENT_URL is not set.' +
    '\n   CORS is falling back to a wildcard origin (*) with credentials enabled -- fine for quick local testing,' +
    '\n   but this will refuse to start at all in production (NODE_ENV=production) until CLIENT_URL is set.\n'
  );
}

export default config;