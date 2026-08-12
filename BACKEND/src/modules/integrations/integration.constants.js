/**
 * =============================================================================
 * InnovateX Revenue OS — Integrations Constants
 * =============================================================================
 *
 * FILE: src/modules/integrations/integration.constants.js
 *
 * SOURCE: MASTER_SPEC.md B17:
 *   "22 integration cards (WhatsApp providers, payments, AI, calendars,
 *    email, calls, CRM/ads - some 'coming soon'). Connect/disconnect
 *    toggle, sync, settings modal, error-log modal, status badges. Simulated."
 *
 * SOURCE: DEVELOPER_HANDOFF.md section 6:
 *   "Integration: name, category, status('connected'|'disconnected'|
 *    'simulation'), last_sync, description, logo_color, config, error_logs[]"
 *
 * SOURCE: MASTER_SPEC.md A4 permission matrix:
 *   "Manage integrations" = Super Admin / Tenant Owner / Tenant Admin only.
 *
 * CATALOG NOTE - the spec names 7 categories and a total of 22 cards but
 * does not enumerate the 22 provider names. The 22 entries below are this
 * implementation's catalog, built to be internally consistent with names
 * ALREADY used elsewhere in this codebase: the 7 WhatsApp providers here
 * are the exact same values as PROVIDER in
 * whatsapp/submodules/templates/templates.constants.js, so a tenant that
 * connects "WATI" here and in WhatsApp Settings is referring to the same
 * real-world provider. This is a deliberate design choice, not verbatim
 * spec text - adjust the catalog freely if you have a specific 22-item
 * list in mind.
 */

// Category - "category tabs" in the UI, 7 groups per spec wording
export const INTEGRATION_CATEGORY = Object.freeze({
  WHATSAPP:  'WhatsApp Providers',
  PAYMENTS:  'Payments',
  AI:        'AI',
  CALENDARS: 'Calendars',
  EMAIL:     'Email',
  CALLS:     'Calls',
  CRM_ADS:   'CRM/Ads',
});
export const INTEGRATION_CATEGORY_VALUES = Object.freeze(Object.values(INTEGRATION_CATEGORY));

// Status - exactly 3 badge states per DEVELOPER_HANDOFF.md section 6
export const INTEGRATION_STATUS = Object.freeze({
  CONNECTED:    'connected',
  DISCONNECTED: 'disconnected',
  SIMULATION:   'simulation',
});
export const INTEGRATION_STATUS_VALUES = Object.freeze(Object.values(INTEGRATION_STATUS));

// Error log severity - used when a future real sync layer records failures
export const ERROR_LOG_SEVERITY = Object.freeze({
  WARNING: 'warning',
  ERROR:   'error',
});
export const ERROR_LOG_SEVERITY_VALUES = Object.freeze(Object.values(ERROR_LOG_SEVERITY));

// The 22-item catalog.
// `key` is stable and used to upsert/seed one Integration doc per tenant.
// `available: false` = "coming soon" - visible as a card, but cannot be
// connected yet (matches spec: "some 'coming soon'").
export const INTEGRATION_CATALOG = Object.freeze([
  // WhatsApp Providers (7) - same provider names as the WhatsApp Templates module
  { key: 'meta_cloud', name: 'Meta Cloud API', category: INTEGRATION_CATEGORY.WHATSAPP, description: 'Official WhatsApp Business Cloud API by Meta.', logo_color: '#25D366', available: true },
  { key: 'wati',       name: 'WATI',           category: INTEGRATION_CATEGORY.WHATSAPP, description: 'WhatsApp Team Inbox for customer support and sales.', logo_color: '#00A884', available: true },
  { key: 'interakt',   name: 'Interakt',       category: INTEGRATION_CATEGORY.WHATSAPP, description: 'WhatsApp commerce and marketing platform.', logo_color: '#128C7E', available: true },
  { key: 'aisensy',    name: 'AiSensy',        category: INTEGRATION_CATEGORY.WHATSAPP, description: 'WhatsApp API platform for broadcasts and chatbots.', logo_color: '#0FA958', available: true },
  { key: 'gallabox',   name: 'Gallabox',       category: INTEGRATION_CATEGORY.WHATSAPP, description: 'Shared team inbox for WhatsApp Business.', logo_color: '#1FAB89', available: true },
  { key: 'twilio_wa',  name: 'Twilio WhatsApp', category: INTEGRATION_CATEGORY.WHATSAPP, description: 'Twilio API for WhatsApp messaging.', logo_color: '#F22F46', available: true },
  { key: '360dialog',  name: '360Dialog',      category: INTEGRATION_CATEGORY.WHATSAPP, description: 'WhatsApp Business Solution Provider (BSP).', logo_color: '#2E7D32', available: true },

  // Payments (3)
  { key: 'stripe',    name: 'Stripe',    category: INTEGRATION_CATEGORY.PAYMENTS, description: 'Online payments and subscription billing.', logo_color: '#635BFF', available: true },
  { key: 'razorpay',  name: 'Razorpay',  category: INTEGRATION_CATEGORY.PAYMENTS, description: 'Payments, invoicing, and settlements for India.', logo_color: '#0C2451', available: true },
  { key: 'paypal',    name: 'PayPal',    category: INTEGRATION_CATEGORY.PAYMENTS, description: 'Global online payments and checkout.', logo_color: '#003087', available: true },

  // AI (3)
  { key: 'openai', name: 'OpenAI',           category: INTEGRATION_CATEGORY.AI, description: 'GPT models for AI qualification and replies.', logo_color: '#10A37F', available: true },
  { key: 'gemini', name: 'Google Gemini',    category: INTEGRATION_CATEGORY.AI, description: "Google's multimodal AI model family.", logo_color: '#4285F4', available: true },
  { key: 'claude', name: 'Anthropic Claude', category: INTEGRATION_CATEGORY.AI, description: 'Claude models for reasoning and drafting.', logo_color: '#D97757', available: true },

  // Calendars (2)
  { key: 'google_calendar', name: 'Google Calendar', category: INTEGRATION_CATEGORY.CALENDARS, description: 'Sync bookings with Google Calendar.', logo_color: '#4285F4', available: true },
  { key: 'calendly',        name: 'Calendly',        category: INTEGRATION_CATEGORY.CALENDARS, description: 'Self-serve meeting scheduling.', logo_color: '#006BFF', available: true },
  { key: 'calcom',          name: 'Cal.com',          category: INTEGRATION_CATEGORY.CALENDARS, description: 'Real, free-tier scheduling sync — bookings, reschedules, and cancellations via the official Cal.com API.', logo_color: '#292929', available: true },

  // Email (3)
  { key: 'google_workspace', name: 'Google Workspace', category: INTEGRATION_CATEGORY.EMAIL, description: 'Gmail sending and inbox sync.', logo_color: '#EA4335', available: true },
  { key: 'sendgrid',         name: 'SendGrid',         category: INTEGRATION_CATEGORY.EMAIL, description: 'Platform-level transactional email — password resets, invites, and verification for every workspace.', logo_color: '#1A82E2', available: true },
  { key: 'mailchimp',        name: 'Mailchimp',        category: INTEGRATION_CATEGORY.EMAIL, description: 'Email marketing campaigns and audiences.', logo_color: '#FFE01B', available: true },

  // Calls (2)
  { key: 'twilio_voice', name: 'Twilio Voice', category: INTEGRATION_CATEGORY.CALLS, description: 'Voice calling and call recording API.', logo_color: '#F22F46', available: true },
  { key: 'exotel',       name: 'Exotel',       category: INTEGRATION_CATEGORY.CALLS, description: 'Cloud telephony for sales and support calls.', logo_color: '#FF6B35', available: true },

  // CRM/Ads (2) - "coming soon"
  { key: 'salesforce', name: 'Salesforce', category: INTEGRATION_CATEGORY.CRM_ADS, description: 'Sync leads and deals with Salesforce CRM.', logo_color: '#00A1E0', available: false },
  { key: 'google_ads',  name: 'Google Analytics 4 (GA4)', category: INTEGRATION_CATEGORY.CRM_ADS, description: 'Real-time conversion tracking via GA4 Measurement Protocol — separate from Google Ads Campaigns below.', logo_color: '#E37400', available: true },
  { key: 'meta_ads',    name: 'Meta Ads',   category: INTEGRATION_CATEGORY.CRM_ADS, description: 'Server-side conversion tracking via Meta Conversions API.', logo_color: '#0866FF', available: true },
  { key: 'google_ads_campaigns', name: 'Google Ads Campaigns', category: INTEGRATION_CATEGORY.CRM_ADS, description: 'Real campaign, spend, and conversion sync via the official Google Ads API.', logo_color: '#34A853', available: true },
]);

// Pagination / search defaults
export const DEFAULT_PAGE  = 1;
export const DEFAULT_LIMIT = 50; // 22 items total - one page comfortably covers all
export const MAX_LIMIT     = 100;

export const SEARCHABLE_FIELDS = Object.freeze(['name', 'description']);