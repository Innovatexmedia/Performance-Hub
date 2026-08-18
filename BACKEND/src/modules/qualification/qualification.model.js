/**
 * AI Qualification model — stores every qualification result permanently.
 *
 * PURPOSE:
 *   One lead can be qualified multiple times over time.
 *   Each run creates one Qualification record (applied: false initially).
 *   When the sales rep clicks "Apply", applied → true and lead is updated.
 *   Human override stores the manually adjusted score alongside the AI score.
 *
 * SOURCE: DEVELOPER_HANDOFF.md aiService.qualifyLead() return shape:
 *   {fitScore, temperature, quality, buyingIntent, urgency, painPoints,
 *    recommendedOffer, nextAction, followUpDraft, isLive, reason}
 *
 * SOURCE: FRONTEND_SPEC §6:
 *   "fit score (1–10), temperature, quality, buying intent, urgency,
 *    pain points, recommended offer, next action, AI follow-up draft.
 *    Applying updates lead score/temperature/status + timeline + (if hot) notification.
 *    Human override supported."
 *
 * NAMING: snake_case — matches Lead, Deal, Booking, Call models exactly.
 * TIMESTAMPS: { createdAt: 'created_at', updatedAt: 'updated_at' }, versionKey: false
 * EXPORT: named export — matches Lead, Call, Booking patterns
 *
 * COLLECTION: qualifications
 */

import mongoose from 'mongoose';
import {
  QUALITY_GRADE,
  BUYING_INTENT,
  QUALIFICATION_ROUTE,
} from './qualification.constants.js';
import { LEAD_TEMPERATURE_VALUES } from '../leads/lead/lead.constants.js';

const { Schema } = mongoose;

const qualificationSchema = new Schema(
  {
    // ── Tenant scope ──────────────────────────────────────────────────────────
    // Type String — matches lead.model.js (uses String, not ObjectId)
    tenant_id: {
      type:     String,
      required: [true, 'tenant_id is required'],
      index:    true,
    },

    // ── Core relation ─────────────────────────────────────────────────────────
    /**
     * lead_id — the lead this qualification belongs to.
     * On apply: lead.qualification_score, lead_temperature, status updated.
     */
    lead_id: {
      type:     Schema.Types.ObjectId,
      ref:      'Lead',
      required: [true, 'lead_id is required'],
      index:    true,
    },

    /**
     * answered_by — userId of the sales rep who ran this qualification.
     * From req.user.sub (JWT).
     */
    answered_by: {
      type:    String,
      default: null,
    },

    // ── Discovery answers (flexible — set by tenant's qualification questions) ─
    /**
     * answers — the discovery question answers submitted by the sales rep.
     * Structure is flexible; tenant controls questions from settings.
     * Typical keys: budget, timeline, authority, challenge, pain_points
     * SOURCE: FRONTEND_SPEC §6 "questionnaire (left column)"
     *         DEVELOPER_HANDOFF.md aiService.qualifyLead(lead, answers)
     */
    answers: {
      type:    Schema.Types.Mixed,
      default: {},
    },

    // ── AI Assessment output ──────────────────────────────────────────────────
    // All populated by qualificationAiService.assess(lead, answers)

    /**
     * fit_score — AI-computed qualification score 0–10.
     * SOURCE: FRONTEND_SPEC §6 "fit score (1–10)"
     *         DEVELOPER_HANDOFF.md qualifyLead {score}
     */
    fit_score: {
      type:    Number,
      min:     0,
      max:     10,
      default: 0,
    },

    /**
     * temperature — Hot | Warm | Cold derived from fit_score.
     * SOURCE: DEVELOPER_HANDOFF.md qualifyLead {temperature}
     *         FRONTEND_SPEC §6 "temperature"
     */
    temperature: {
      type:    String,
      enum:    LEAD_TEMPERATURE_VALUES,
      default: null,
    },

    /**
     * quality — A | B | C grade.
     * SOURCE: DEVELOPER_HANDOFF.md aiService.qualifyLead() → quality
     */
    quality: {
      type:    String,
      enum:    Object.values(QUALITY_GRADE),
      default: null,
    },

    /*
     * buying_intent — high | medium | low.
     * SOURCE: DEVELOPER_HANDOFF.md aiService.qualifyLead() → buyingIntent
     */
    buying_intent: {
      type:    String,
      enum:    Object.values(BUYING_INTENT),
      default: null,
    },

    /**
     * urgency — high | medium | low (mirrors buying_intent in mock).
     * SOURCE: DEVELOPER_HANDOFF.md aiService.qualifyLead() → urgency
     */
    urgency: {
      type:    String,
      enum:    Object.values(BUYING_INTENT),
      default: null,
    },

    /**
     * pain_points — list of pain points extracted from answers.
     * SOURCE: DEVELOPER_HANDOFF.md aiService.qualifyLead() → painPoints
     *         FRONTEND_SPEC §6 "pain points"
     */
    pain_points: {
      type:    [String],
      default: [],
    },

    /**
     * recommended_offer — AI-suggested offer to present.
     * SOURCE: DEVELOPER_HANDOFF.md aiService.qualifyLead() → recommendedOffer
     *         FRONTEND_SPEC §6 "recommended offer"
     */
    recommended_offer: {
      type:    String,
      default: '',
    },

    /**
     * next_action — AI-recommended next step (book call / add to nurture).
     * SOURCE: DEVELOPER_HANDOFF.md aiService.qualifyLead() → nextAction
     *         FRONTEND_SPEC §6 "next action"
     */
    next_action: {
      type:    String,
      default: '',
    },

    /**
     * follow_up_draft — AI-generated follow-up message.
     * SOURCE: DEVELOPER_HANDOFF.md aiService.qualifyLead() → followUpDraft
     *         FRONTEND_SPEC §6 "AI follow-up draft"
     */
    follow_up_draft: {
      type:    String,
      default: '',
    },

    /**
     * reason — AI reasoning summary.
     * SOURCE: DEVELOPER_HANDOFF.md qualifyLead({reason}) param
     */
    reason: {
      type:    String,
      default: '',
    },

    /**
     * is_ai_live — whether real AI was used (true) or mock (false).
     * SOURCE: DEVELOPER_HANDOFF.md isAiLive() flag
     *         FRONTEND_SPEC §6 "Live/Mock AI badge"
     */
    is_ai_live: {
      type:    Boolean,
      default: false,
    },

    /**
     * suggested_route — what the AI recommends to do with this lead.
     * SOURCE: FRONTEND_SPEC §6 "apply & route (booking / nurture / sales)"
     */
    suggested_route: {
      type:    String,
      enum:    Object.values(QUALIFICATION_ROUTE),
      default: null,
    },

    // ── Application state ──────────────────────────────────────────────────────
    /**
     * applied — true when sales rep clicks "Apply to Lead".
     * Starts as false — sales rep reviews result before committing.
     * SOURCE: FRONTEND_SPEC §6 "Applying updates the lead score/temperature/status"
     */
    applied: {
      type:    Boolean,
      default: false,
      index:   true,
    },
    applied_at: { type: Date,   default: null },
    applied_by: { type: String, default: null },

    // ── Human override ────────────────────────────────────────────────────────
    /**
     * override_score — sales rep's manual score adjustment.
     * SOURCE: FRONTEND_SPEC §6 "Human override supported"
     * When set: overrides fit_score on the lead record.
     */
    override_score: { type: Number, min: 0, max: 10, default: null },
    override_at:    { type: Date,   default: null },
    override_by:    { type: String, default: null },

    // ── Audit ─────────────────────────────────────────────────────────────────
    created_by: { type: String, default: null },
    updated_by: { type: String, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
qualificationSchema.index({ tenant_id: 1, lead_id: 1 });
qualificationSchema.index({ tenant_id: 1, applied: 1 });
qualificationSchema.index({ tenant_id: 1, temperature: 1 });
qualificationSchema.index({ tenant_id: 1, lead_id: 1, created_at: -1 });

// Named export — matches Lead, Call, Booking export patterns
export const Qualification = mongoose.model('Qualification', qualificationSchema);