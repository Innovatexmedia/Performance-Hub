/**
 * =============================================================================
 * InnovateX Revenue OS — Express Application
 * =============================================================================
 *
 * FILE: src/app.js
 * =============================================================================
 */

import express     from 'express';
import helmet      from 'helmet';
import cors        from 'cors';
import compression from 'compression';
import morgan      from 'morgan';
import cookieParser from 'cookie-parser';

// ── Route Imports ─────────────────────────────────────────────────────────────
import dashboardRoutes from './modules/dashboard/dashboard.routes.js';
import notificationRoutes from './modules/leads/notifications/notification.routes.js';
import settingsRoutes from './modules/settings/settings.routes.js';
import planRoutes from './modules/plans/plan.routes.js';
import authRoutes     from './modules/auth/routes/auth.routes.js';
import leadRoutes     from './modules/leads/lead/lead.routes.js';
import pipelineRouter from './modules/pipeline/pipeline.routes.js';
import whatsappRouter from './modules/whatsapp/whatsapp.routes.js';
import nurtureWebhookTriggerRoutes from './modules/whatsapp/submodules/nurtures/nurtureWebhookTrigger.routes.js';
import callRoutes          from './modules/calls/call.routes.js';
import qualificationRoutes from './modules/qualification/qualification.routes.js';
import attributionRoutes from './modules/attribution/attribution.routes.js';
import paymentRoutes   from './modules/payments/payment.routes.js';
import campaignRoutes  from './modules/campaigns/campaign.routes.js';
import bookingRoutes from './modules/bookings/booking.routes.js';
import calcomWebhookRoutes from './modules/bookings/calcomWebhook.routes.js';
import calcomPublicBookingRoutes from './modules/bookings/calcomPublicBooking.routes.js';
import reportRoutes  from './modules/reports/report.routes.js';
import automationRoutes from './modules/automations/automation.routes.js';
import teamRoutes from './modules/team/team.routes.js';
import superAdminRoutes from './modules/superAdmin/superAdmin.routes.js';
import nurtureRoutes from './modules/nurture/nurture.routes.js';
import templateRoutes from './modules/templates/template.routes.js';
import integrationRoutes from './modules/integrations/integration.routes.js';
import googleAdsOAuthRoutes from './modules/attribution/googleAdsOAuth.routes.js';
import shopifyWebhookRoutes from './modules/shopify/shopifyWebhook.routes.js';
import sendgridWebhookRoutes from './modules/email/sendgridWebhook.routes.js';
import cashfreeWebhookRoutes from './modules/plans/cashfreeWebhook.routes.js';
import billingReturnRoutes from './modules/plans/billingReturn.routes.js';
import shopifyOAuthRoutes from './modules/shopify/shopifyOAuth.routes.js';
// WhatsApp submodules (contacts, templates, template-approval, campaigns,
// broadcasts, nurtures, ai, automation-rules, delivery-logs, consent,
// analytics, settings) are composed entirely inside whatsappRouter --
// see src/modules/whatsapp/whatsapp.routes.js. No direct imports needed here.


// ── Middleware Imports ────────────────────────────────────────────────────────
import { errorHandler, notFoundHandler } from './shared/middlewares/errorHandler.middleware.js';
import { generalApiRateLimit }           from './shared/middlewares/rateLimit.middleware.js';

const app = express();

// Render (like Heroku/Railway) sits the app behind a reverse proxy --
// the real client IP arrives via X-Forwarded-For, not the raw socket
// connection. Express doesn't trust that header by default (a genuine
// security default: blindly trusting it would let any client spoof
// their own IP by just setting the header themselves, if the app
// WEREN'T actually behind a real proxy). Confirmed in practice on
// Render's own logs: express-rate-limit refused to start correctly and
// logged "X-Forwarded-For header is set but trust proxy is false",
// meaning every one of this app's rate limiters (general API, login,
// public booking) was NOT reliably identifying real per-client IPs in
// production -- 1 trusts exactly one hop, the right, standard setting
// for this exact single-reverse-proxy deployment shape.
app.set('trust proxy', 1);

// PUBLIC, mounted BEFORE helmet/cors/body-parsers -- this is Cashfree's
// hosted checkout page redirecting the customer's browser back after
// the mandate flow. Confirmed in practice: that redirect is a genuine
// cross-origin form POST from https://payments-test.cashfree.com (or
// the production equivalent), which the global CORS policy below
// correctly rejects for every other route -- but this one specifically
// needs to accept it. Mounting it ahead of cors() means it's handled
// (and a redirect response sent) before that middleware ever runs,
// rather than trying to carve out a same-policy exception inside it.
// The handler only reads req.query (never req.body) for exactly this
// reason -- body-parser middleware hasn't run yet at this point either.
app.use('/api/billing/cashfree-return', billingReturnRoutes);

/*
|--------------------------------------------------------------------------
| Security Middleware
|--------------------------------------------------------------------------
*/
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

// Allowed origins: the real configured CLIENT_URL, plus (in
// development only) any ngrok tunnel domain -- needed for testing
// things that genuinely require a real HTTPS origin (e.g. Meta
// Embedded Signup), since ngrok's free-tier subdomain changes every
// time you restart it and can't be hardcoded into CLIENT_URL. A
// function (not a static string/array) so this dynamic ngrok check
// only ever applies outside production -- production stays locked to
// exactly CLIENT_URL, nothing broader.
const ALLOWED_ORIGIN_PATTERNS = [
  /\.ngrok-free\.dev$/,
  /\.ngrok-free\.app$/,
  /\.ngrok\.io$/,
];
function corsOriginCheck(origin, callback) {
  if (!origin) return callback(null, true); // same-origin / non-browser requests (curl, server-to-server) send no Origin header at all
  if (origin === process.env.CLIENT_URL) return callback(null, true);
  if (process.env.NODE_ENV !== 'production' && ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin))) {
    return callback(null, true);
  }
  callback(new Error(`CORS: origin "${origin}" is not allowed`));
}

app.use(
  cors({
    origin:      process.env.CLIENT_URL ? corsOriginCheck : '*',
    credentials: true, // Required for HttpOnly cookies
  })
);

/*
|--------------------------------------------------------------------------
| Cookie Parser — Required for HttpOnly refresh token cookies
|--------------------------------------------------------------------------
*/
app.use(cookieParser());

/*
|--------------------------------------------------------------------------
| Logging
|--------------------------------------------------------------------------
*/
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

/*
|--------------------------------------------------------------------------
| Compression
|--------------------------------------------------------------------------
*/
app.use(compression());

/*
|--------------------------------------------------------------------------
| Body Parsers
|--------------------------------------------------------------------------
*/
app.use(express.json({
  limit: '1mb',
  // Captures the exact raw bytes alongside the parsed body. Needed for
  // src/modules/whatsapp/webhooks/metaWebhook -- verifying Meta's
  // X-Hub-Signature-256 header requires HMAC-ing the ORIGINAL request
  // bytes; re-serializing req.body with JSON.stringify() would not
  // reliably reproduce the same bytes (key order, whitespace). Every
  // other route is unaffected -- req.body is still parsed exactly as
  // before, this only adds req.rawBody alongside it.
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

/*
|--------------------------------------------------------------------------
| Health Check (unauthenticated)
|--------------------------------------------------------------------------
*/
app.get('/', (req, res) => {
  return res.status(200).json({
    success: true,
    service: 'InnovateX Revenue OS API',
    version: '1.0.0',
    status:  'healthy',
    timestamp: new Date().toISOString(),
  });
});

/*
|--------------------------------------------------------------------------
| API Rate Limiting (global)
|--------------------------------------------------------------------------
*/
app.use('/api', generalApiRateLimit);

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------

*/
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/settings',   settingsRoutes);
// NOTE: this file (plan.routes.js -- GET/POST/PATCH/DELETE /api/plans)
// existed but was never actually mounted anywhere in this app, exactly
// like the old razorpayWebhook.routes.js gap found earlier -- both
// Settings > Billing's plan list AND the Super Admin Plans/Tenants tabs
// call plansApi.list(), which was 404ing the whole time ("Could not
// load tenants" on the Tenants tab is the SAME root cause, not a
// separate bug -- it loads tenants and plans together via Promise.all,
// so the plans 404 fails that whole call too).
app.use('/api/plans',      planRoutes);
app.use('/api/auth',      authRoutes);
app.use('/api/leads',     leadRoutes);
app.use('/api/pipeline',  pipelineRouter);
app.use('/api/whatsapp/nurtures/webhook-trigger', nurtureWebhookTriggerRoutes);
app.use('/api/whatsapp',  whatsappRouter);
app.use('/api/calls',          callRoutes);
app.use('/api/qualification', qualificationRoutes);
app.use('/api/attribution',  attributionRoutes);
app.use('/api/payments',   paymentRoutes);
app.use('/api/campaigns',  campaignRoutes);
app.use('/api/bookings/calcom/webhook', calcomWebhookRoutes);
app.use('/api/public/calcom', calcomPublicBookingRoutes);
app.use('/api/bookings',   bookingRoutes);
app.use('/api/reports',    reportRoutes);
app.use('/api/automations', automationRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/nurture', nurtureRoutes);
app.use('/api/templates', templateRoutes);
// Mounted BEFORE integrationRoutes and at a more specific sub-path so
// Express's route matching hits this first -- otherwise integration.routes.js's
// generic GET /:id pattern would treat "google-ads" as an integration ID.
app.use('/api/integrations/google-ads/oauth', googleAdsOAuthRoutes);
app.use('/api/shopify/webhook', shopifyWebhookRoutes);
// NOTE: the old '/api/webhooks/razorpay' equivalent (razorpayWebhook.routes.js)
// was never actually mounted here -- that endpoint didn't exist in the
// running app. Fixed for Cashfree: this one is real. Point Cashfree's
// dashboard webhook config (Subscriptions section) at
// `${API_BASE_URL}/api/webhooks/cashfree`.
app.use('/api/webhooks/cashfree', cashfreeWebhookRoutes);
app.use('/api/shopify/oauth', shopifyOAuthRoutes);
app.use('/api/integrations', integrationRoutes);

// NOTE: the WhatsApp submodules (contacts, templates, template-approval,
// campaigns, broadcasts, nurtures, ai, automation-rules, delivery-logs,
// consent, analytics, settings) are NOT mounted here individually.
// whatsappRouter (mounted above at '/api/whatsapp') already composes every
// one of them internally with the correct kebab-case paths and applies
// authenticate + resolveTenant + withContext once, globally, before
// delegating to each submodule. Mounting them again here was dead/duplicate
// code -- two of them (automationRules, deliveryLogs) even used mismatched
// camelCase paths that do not match the canonical ones inside whatsappRouter.
// See src/modules/whatsapp/whatsapp.routes.js for the real mount list.
/*
|--------------------------------------------------------------------------
| 404 Handler — MUST come after all routes
|--------------------------------------------------------------------------
*/
app.use(notFoundHandler);

/*
|--------------------------------------------------------------------------
| Global Error Handler — MUST be last middleware (4 params)
|--------------------------------------------------------------------------
*/
app.use(errorHandler);

export default app;