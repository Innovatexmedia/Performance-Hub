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
import settingsRoutes from './modules/settings/settings.routes.js';
import authRoutes     from './modules/auth/routes/auth.routes.js';
import leadRoutes     from './modules/leads/lead/lead.routes.js';
import pipelineRouter from './modules/pipeline/pipeline.routes.js';
import whatsappRouter from './modules/whatsapp/whatsapp.routes.js';
import callRoutes          from './modules/calls/call.routes.js';
import qualificationRoutes from './modules/qualification/qualification.routes.js';
import attributionRoutes from './modules/attribution/attribution.routes.js';
import paymentRoutes   from './modules/payments/payment.routes.js';
import campaignRoutes  from './modules/campaigns/campaign.routes.js';
import bookingRoutes from './modules/bookings/booking.routes.js';
import reportRoutes  from './modules/reports/report.routes.js';
import automationRoutes from './modules/automations/automation.routes.js';
import nurtureRoutes from './modules/nurture/nurture.routes.js';
import templateRoutes from './modules/templates/template.routes.js';
import integrationRoutes from './modules/integrations/integration.routes.js';
// WhatsApp submodules (contacts, templates, template-approval, campaigns,
// broadcasts, nurtures, ai, automation-rules, delivery-logs, consent,
// analytics, settings) are composed entirely inside whatsappRouter --
// see src/modules/whatsapp/whatsapp.routes.js. No direct imports needed here.


// ── Middleware Imports ────────────────────────────────────────────────────────
import { errorHandler, notFoundHandler } from './shared/middlewares/errorHandler.middleware.js';
import { generalApiRateLimit }           from './shared/middlewares/rateLimit.middleware.js';

const app = express();

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

app.use(
  cors({
    origin:      process.env.CLIENT_URL || '*',
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
app.use('/api/settings',   settingsRoutes);
app.use('/api/auth',      authRoutes);
app.use('/api/leads',     leadRoutes);
app.use('/api/pipeline',  pipelineRouter);
app.use('/api/whatsapp',  whatsappRouter);
app.use('/api/calls',          callRoutes);
app.use('/api/qualification', qualificationRoutes);
app.use('/api/attribution',  attributionRoutes);
app.use('/api/payments',   paymentRoutes);
app.use('/api/campaigns',  campaignRoutes);
app.use('/api/bookings',   bookingRoutes);
app.use('/api/reports',    reportRoutes);
app.use('/api/automations', automationRoutes);
app.use('/api/nurture', nurtureRoutes);
app.use('/api/templates', templateRoutes);
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