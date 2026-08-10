export const PERMISSIONS = Object.freeze({

  // ── Platform (super_admin only) ────────────────────────────────────────────
  MANAGE_TENANTS:        "manage_tenants",
  MANAGE_SUBSCRIPTIONS:  "manage_subscriptions",
  MANAGE_PLATFORM:       "manage_platform",
  VIEW_ALL_DATA:         "view_all_data",
  MANAGE_USERS:          "manage_users",

  // ── Team ───────────────────────────────────────────────────────────────────
  MANAGE_TEAM:           "manage_team",

  // ── Leads & Pipeline ──────────────────────────────────────────────────────
  MANAGE_LEADS:          "manage_leads",
  VIEW_LEADS:            "view_leads",
  VIEW_ASSIGNED_LEADS:   "view_assigned_leads",
  UPDATE_LEADS:          "update_leads",
  UPDATE_PIPELINE:       "update_pipeline",

  // ── WhatsApp ───────────────────────────────────────────────────────────────
  MANAGE_WHATSAPP:       "manage_whatsapp",
  MANAGE_CONVERSATIONS:  "manage_conversations",
  // Deliberately separate from MANAGE_CONVERSATIONS (which every sales_user
  // has by default for their own day-to-day conversation work -- reply,
  // status, notes). Reassigning a conversation to a DIFFERENT person is a
  // more sensitive, ownership-changing action and was never meant to be
  // gated by that same broad default permission -- see rolePermissions.js,
  // ASSIGN_CONVERSATIONS is intentionally NOT in sales_user's default set.
  ASSIGN_CONVERSATIONS:  "assign_conversations",
  SUBMIT_TEMPLATES:      "submit_templates",
  APPROVE_TEMPLATES:     "approve_templates",

  // ── Campaigns ─────────────────────────────────────────────────────────────
  MANAGE_CAMPAIGNS:      "manage_campaigns",
  APPROVE_CAMPAIGNS:     "approve_campaigns",

  // ── Bookings & Calls ──────────────────────────────────────────────────────
  MANAGE_BOOKINGS:       "manage_bookings",
  MANAGE_CALLS:          "manage_calls",

  // ── Payments ──────────────────────────────────────────────────────────────
  MANAGE_PAYMENTS:       "manage_payments",

  // ── Reports & Dashboard ───────────────────────────────────────────────────
  MANAGE_REPORTS:        "manage_reports",
  VIEW_DASHBOARD:        "view_dashboard",
  VIEW_REPORTS:          "view_reports",

  // ── Settings & Integrations ───────────────────────────────────────────────
  MANAGE_INTEGRATIONS:   "manage_integrations",
  MANAGE_SETTINGS:       "manage_settings",
  MANAGE_AUTOMATIONS:    "manage_automations",

  // ── AI & Attribution ──────────────────────────────────────────────────────
  MANAGE_AI:             "manage_ai",
  VIEW_ATTRIBUTION:      "view_attribution",
  MANAGE_ATTRIBUTION:    "manage_attribution",

  // ── Templates (generic) ───────────────────────────────────────────────────
  MANAGE_TEMPLATES:      "manage_templates",

  // ── Nurture ────────────────────────────────────────────────────────────────
  MANAGE_NURTURE:        "manage_nurture",
});