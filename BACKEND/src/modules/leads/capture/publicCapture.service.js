/**
 * =============================================================================
 * InnovateX Revenue OS — Public Lead Capture Service
 * =============================================================================
 *
 * FILE: src/modules/leads/capture/publicCapture.service.js
 *
 * REAL FIX (confirmed by direct audit): the public Capture Form
 * previously created leads in a browser-only localStorage mock store
 * (src/store/store.ts, a leftover of this app's original
 * frontend-only-prototype phase -- see DEVELOPER_HANDOFF.md) that never
 * reached the real backend at all. Every ad campaign's tracking link
 * (campaigns/campaign.service.js's generateUtmLink) pointed at this
 * same broken page, meaning NO ad-driven lead ever reached MongoDB, the
 * Attribution dashboard, or Nurture's condition-based auto-enrollment.
 * This file is the real, tenant-scoped, unauthenticated backend those
 * flows now actually hit.
 *
 * DESIGN
 * ──────
 * - Tenant-scoped via a real tenantId in the URL (mirrors the existing
 *   public booking pattern: /book/:tenantId ->
 *   calcomPublicBooking.*), NOT a single implicit tenant -- a real
 *   multi-tenant capture page must know whose lead this is.
 * - Reuses leadService.createLead() for the ACTUAL creation, not a
 *   parallel/duplicate creation path -- so a publicly-captured lead
 *   gets every real side effect an authenticated one does for free:
 *   Nurture LEAD_CREATED condition-matched auto-enroll, Automation
 *   Rules dispatch, consent handling, the LEAD_CREATED tracking event.
 * - FIRST-TOUCH ATTRIBUTION: if a visitor re-submits (same email/phone,
 *   already a lead for this tenant), their ORIGINAL source/medium/
 *   campaign/utm_* fields are preserved, not overwritten by whatever
 *   campaign brought them back this time -- this is what "preserve
 *   attribution from the first visit" actually requires. The repeat
 *   visit is still recorded as a real activity-timeline entry, just
 *   without changing the lead's attribution of record.
 */

import { Types } from 'mongoose';
import Tenant from '../../auth/models/Tenant.js';
import GoogleAdsCampaignMetric from '../../attribution/googleAdsCampaignMetric.model.js';
import MetaAdsCampaignMetric from '../../attribution/metaAdsCampaignMetric.model.js';
import { leadService } from '../lead/lead.service.js';
import { AppError } from '../../../shared/helpers/lead.helpers.js';

/**
 * assertRealActiveTenant -- the public form must never leak WHICH
 * tenants exist or their real names to an anonymous caller (a 404 from
 * a bad tenantId looks identical to one from a suspended tenant), same
 * "don't leak existence" treatment calcomPublicBooking.service.js
 * already applies to its own tenant lookups.
 */
async function assertRealActiveTenant(tenantId) {
  if (!Types.ObjectId.isValid(tenantId)) {
    throw AppError.notFound('This form link is no longer valid.');
  }
  const tenant = await Tenant.findById(tenantId).select('isActive');
  if (!tenant || !tenant.isActive) {
    throw AppError.notFound('This form link is no longer valid.');
  }
  return tenant;
}

/**
 * resolveRealCampaignName -- REAL FIX for automatic (not manual)
 * cross-platform attribution.
 *
 * Google Ads' own ValueTrack parameters ({campaignid}) only ever
 * substitute a numeric ID, never a human-readable name -- confirmed via
 * Google's own documentation, no per-campaign "custom parameter" setup
 * exists by default. If left as a raw ID, Attribution's ROAS-matching
 * (which keys off Lead.campaign equalling the ad platform's real
 * campaignName -- see attribution.service.js's getAdSpendSummary) would
 * never match a numeric ID against a real campaign name.
 *
 * Since this app ALREADY syncs Google Ads / Meta Ads campaigns (real
 * campaignId -> campaignName pairs, via the existing OAuth
 * integrations), a raw numeric ID arriving via utm_campaign can be
 * resolved to the REAL campaign name automatically, with zero extra
 * setup beyond the tenant having connected + synced that platform once.
 *
 * Meta's own dynamic macros ({{campaign.name}}) already give a real
 * name directly (confirmed via Meta's own developer docs) -- this
 * function only does anything when the incoming value looks like a
 * bare numeric ID, so a tenant using Meta's name macro is left
 * untouched, and one using Meta's ID macro ({{campaign.id}}) still gets
 * resolved correctly, same as Google.
 *
 * Falls through to the raw incoming value unchanged if no match is
 * found (e.g. that platform was never connected, or the ID predates the
 * most recent sync) -- never blocks lead creation on a resolution miss.
 */
async function resolveRealCampaignName(tenantId, rawCampaignValue) {
  if (!rawCampaignValue || !/^\d+$/.test(rawCampaignValue)) {
    return rawCampaignValue; // not a bare numeric ID -- already a real name (or empty), nothing to resolve
  }

  const [googleMatch, metaMatch] = await Promise.all([
    GoogleAdsCampaignMetric.findOne({ tenantId, campaignId: rawCampaignValue }).select('campaignName').sort({ syncedAt: -1 }),
    MetaAdsCampaignMetric.findOne({ tenantId, campaignId: rawCampaignValue }).select('campaignName').sort({ syncedAt: -1 }),
  ]);

  return googleMatch?.campaignName || metaMatch?.campaignName || rawCampaignValue;
}

export const publicCaptureService = {
  /**
   * captureLead -- real find-or-create against the real Lead collection
   * for this real tenant.
   *
   * @param {string} tenantId
   * @param {object} payload  -- { name, email, phone, company, notes,
   *   source, medium, campaign, utm_source, utm_medium, utm_campaign,
   *   utm_content, utm_term, ad_group_id, ad_id, click_id }
   */
  async captureLead(tenantId, payload) {
    await assertRealActiveTenant(tenantId);

    const email = payload.email ? String(payload.email).toLowerCase().trim() : null;
    const phone = payload.phone ? String(payload.phone).trim() : null;
    if (!email && !phone) {
      throw AppError.badRequest('Enter an email or phone number so we can reach you.');
    }

    // Real automatic ID->name resolution -- see resolveRealCampaignName's
    // own header comment. Resolved once and REUSED when `campaign` and
    // `utm_campaign` carry the identical raw value (the common case with
    // this app's own dynamic tracking templates, which only ever
    // populate utm_campaign -- CaptureForm.tsx's own `campaign` fallback
    // then reads that same value) -- two separate DB round-trips for
    // what is provably the same input would double real database load
    // on every single ad-driven lead capture for zero benefit.
    let resolvedCampaign;
    let resolvedUtmCampaign;
    if (payload.campaign && payload.campaign === payload.utm_campaign) {
      resolvedCampaign = resolvedUtmCampaign = await resolveRealCampaignName(tenantId, payload.campaign);
    } else {
      [resolvedCampaign, resolvedUtmCampaign] = await Promise.all([
        resolveRealCampaignName(tenantId, payload.campaign),
        resolveRealCampaignName(tenantId, payload.utm_campaign),
      ]);
    }

    const claimFilter = email
      ? { tenant_id: String(tenantId), email, archived: false }
      : { tenant_id: String(tenantId), phone, archived: false };

    // REAL race-condition-safe find-or-create -- see
    // lead.service.js's createLead() (atomicClaimFilter branch) and
    // lead.repository.js's findOneAndUpsert for the full reasoning.
    // A plain findOne-then-create here would leave a genuine gap a
    // double-clicked submit button (or a client-side retry) could land
    // in, producing two duplicate Leads for the same visitor.
    //
    // FIRST-TOUCH ATTRIBUTION: $setOnInsert means a losing/duplicate
    // call NEVER overwrites the winning call's source/utm_* fields --
    // this is what actually implements "preserve attribution from the
    // first visit" (see file header), for free, from the same atomicity
    // mechanism that closes the race condition.
    const lead = await leadService.createLead(
      { tenantId: String(tenantId), userId: null, role: null },
      {
        name:         payload.name || 'Unnamed Lead',
        email:        email || undefined,
        phone:        phone || undefined,
        company:      payload.company || '',
        notes:        payload.notes || '',
        segment:      payload.segment || '',
        source:       payload.source || 'Direct',
        medium:       payload.medium || '',
        campaign:     resolvedCampaign || '',
        utm_source:   payload.utm_source || '',
        utm_medium:   payload.utm_medium || '',
        utm_campaign: resolvedUtmCampaign || '',
        utm_content:  payload.utm_content || '',
        utm_term:     payload.utm_term || '',
        // Real ad-group/ad-set and ad identifiers -- captured
        // automatically via each platform's own dynamic URL parameters
        // (see campaign.service.js's generateGoogleAdsUrlSuffix /
        // generateMetaAdsUrlTags), not typed manually per lead.
        ad_group_id:  payload.ad_group_id || null,
        ad_id:        payload.ad_id || null,
        click_id:     payload.click_id || null,
        consent_status: 'granted', // a visitor submitting their own contact form is real, active opt-in
      },
      { skipDuplicateCheck: true, atomicClaimFilter: claimFilter },
    );

    // Reliable signal straight from the atomic claim itself (Mongoose's
    // own $locals scratch space -- see createLead's own comment) --
    // NOT a heuristic guess based on timestamps, which would be fragile
    // and version/driver-behavior-dependent.
    const isNew = Boolean(lead.$locals?.isNewlyCreated);

    return { lead, isNew };
  },
};
