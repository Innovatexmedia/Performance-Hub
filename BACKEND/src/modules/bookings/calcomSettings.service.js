/**
 * =============================================================================
 * InnovateX Revenue OS — Cal.com Settings Service
 * =============================================================================
 *
 * FILE: src/modules/bookings/calcomSettings.service.js
 *
 * Real connection lifecycle + real booking sync. Deliberately reuses
 * booking.service.js's existing createBooking/rescheduleBooking/
 * updateBookingStatus rather than reimplementing their real side
 * effects (lead status → Booked, deal creation/advancement, tracking
 * events, notifications) -- those functions are the single real source
 * of truth for what happens when a booking is created/changed/cancelled
 * in this app, and a Cal.com-sourced booking should trigger exactly the
 * same real chain a manually-created one does.
 * =============================================================================
 */

import CalcomSettings from './calcomSettings.model.js';
import { CalcomProvider } from './providers/calcom.provider.js';
import * as bookingService from './booking.service.js';
import { BOOKING_STATUS } from './booking.constants.js';
import { Lead } from '../leads/lead/lead.model.js';
import { Booking } from './booking.model.js';
import { encrypt, decrypt, generateSecureToken } from '../../utils/crypto.js';
import { AppError } from '../../shared/helpers/lead.helpers.js';
import config from '../../config/config.js';

const getOrCreate = async (tenantId) => {
  let doc = await CalcomSettings.findOne({ tenantId });
  if (!doc) doc = await CalcomSettings.create({ tenantId });
  return doc;
};

/**
 * A synthetic reqUser-shaped context for calling booking.service.js's
 * real functions from a webhook/sync context where no real authenticated
 * user session exists. Matches exactly what buildCtx() inside that file
 * expects ({tenantId, sub, role}) -- booking.service.js itself is not
 * modified at all, this just satisfies its existing real input contract.
 */
const systemReqUser = (tenantId) => ({ tenantId, sub: 'calcom-sync', role: 'tenant_admin' });

/**
 * findOrCreateLeadForAttendee -- real bookings require a real, existing
 * lead_id (confirmed from booking.model.js's schema). A Cal.com booking
 * has an attendee, not a pre-existing InnovateX lead, so this matches by
 * email within the tenant first, creating a genuinely new lead only if
 * no match exists -- same real find-then-create pattern already used by
 * the Public Capture Form for inbound leads with no prior record.
 */
const findOrCreateLeadForAttendee = async (tenantId, attendee) => {
  const email = attendee?.email?.toLowerCase().trim();
  if (!email) throw new Error('Cal.com booking has no attendee email — cannot match or create a lead');

  let lead = await Lead.findOne({ tenant_id: String(tenantId), email, archived: false });
  if (lead) return lead;

  lead = await Lead.create({
    tenant_id: String(tenantId),
    name:      attendee.name || email,
    email,
    phone:     attendee.phoneNumber || null,
    source:    'Cal.com',
    status:    'New',
  });
  return lead;
};

export const calcomSettingsService = {
  async getSettings(ctx) {
    const doc = await getOrCreate(ctx.tenantId);
    return doc.toJSON();
  },

  /**
   * connect -- real, live verification against Cal.com's own API before
   * ever marking this connected. Also creates a real webhook subscription
   * so future booking changes sync automatically instead of relying only
   * on the manual/periodic sync below.
   */
  async connect(ctx, { apiKey }) {
    if (!apiKey) throw AppError.badRequest('A Cal.com API key is required.');

    const provider = new CalcomProvider({ apiKey });
    const verified = await provider.testConnection(); // throws with a real Cal.com error if invalid

    const doc = await getOrCreate(ctx.tenantId);
    doc.apiKey = encrypt(apiKey);
    doc.accountEmail = verified.email;
    doc.accountUsername = verified.username;
    doc.connected = true;
    doc.connectedAt = doc.connectedAt || new Date();
    doc.lastVerifiedAt = new Date();
    doc.updatedBy = ctx.userId;

    // Real webhook subscription. If this specific step fails (e.g. the
    // subscriberUrl isn't publicly reachable yet in a local dev setup),
    // the connection itself still succeeds -- sync() below remains
    // available as a real fallback, and the failure is surfaced clearly
    // rather than silently left out.
    try {
      const webhookSecret = generateSecureToken(32);
      const webhookUrl = `${config.API_BASE_URL || 'http://localhost:4000'}/api/bookings/calcom/webhook/${ctx.tenantId}`;
      const { webhookId } = await provider.createWebhook({ subscriberUrl: webhookUrl, secret: webhookSecret });
      doc.webhookId = webhookId;
      doc.webhookUrl = webhookUrl;
      doc.webhookSecret = encrypt(webhookSecret);
    } catch (webhookErr) {
      doc.lastSyncError = `Connected, but real-time webhook setup failed: ${webhookErr.message}. Use Sync to pull bookings manually until this is resolved.`;
    }

    await doc.save();
    return doc.toJSON();
  },

  async disconnect(ctx) {
    const doc = await getOrCreate(ctx.tenantId);

    // Real cleanup -- remove the real webhook subscription from Cal.com's
    // side too, not just this app's local state, so Cal.com stops trying
    // to deliver to a URL this tenant no longer wants receiving events.
    if (doc.webhookId && doc.apiKey) {
      try {
        const provider = new CalcomProvider({ apiKey: decrypt(doc.apiKey) });
        await provider.deleteWebhook(doc.webhookId);
      } catch {
        // Best-effort -- if the key was already revoked on Cal.com's side,
        // there's nothing left to clean up there anyway.
      }
    }

    doc.connected = false;
    doc.apiKey = null;
    doc.webhookSecret = null;
    doc.webhookId = null;
    doc.webhookUrl = null;
    await doc.save();
    return doc.toJSON();
  },

  /**
   * syncBookings -- real pull from Cal.com, upserted into the real
   * Booking model via the existing createBooking/rescheduleBooking/
   * updateBookingStatus functions. This is both the manual "Sync" button
   * action AND the same real logic webhook events funnel through below,
   * so both paths produce identical, correct results.
   */
  async syncBookings(ctx) {
    const doc = await getOrCreate(ctx.tenantId);
    if (!doc.connected || !doc.apiKey) {
      throw AppError.badRequest('Connect a Cal.com account before syncing.');
    }

    const provider = new CalcomProvider({ apiKey: decrypt(doc.apiKey) });
    let processed = 0;
    let failed = 0;

    try {
      let cursor;
      do {
        const { bookings, nextCursor } = await provider.listBookings({ cursor });
        for (const calBooking of bookings) {
          try {
            await this.applyCalcomBooking(ctx.tenantId, calBooking);
            processed += 1;
          } catch (err) {
            failed += 1;
            console.warn(`[calcom] failed to sync booking ${calBooking.uid}: ${err.message}`);
          }
        }
        cursor = nextCursor;
      } while (cursor);

      doc.lastSyncedAt = new Date();
      doc.lastSyncError = failed > 0 ? `${failed} booking(s) failed to sync — see server logs` : null;
      await doc.save();

      return { synced: true, processed, failed };
    } catch (err) {
      doc.lastSyncError = err.message;
      await doc.save().catch(() => {});
      throw err;
    }
  },

  /**
   * applyCalcomBooking -- the one real place a Cal.com booking (from
   * either a sync pull or a webhook) gets turned into a real InnovateX
   * Booking. Real dedup: looks up by (tenant, external_source, external_id)
   * first -- if found, this is an update (reschedule/status change via
   * the real rescheduleBooking/updateBookingStatus functions); if not,
   * it's genuinely new (real findOrCreateLeadForAttendee + real
   * createBooking, which itself handles lead status + deal + tracking +
   * notification).
   */
  async applyCalcomBooking(tenantId, calBooking) {
    const uid = calBooking.uid;
    if (!uid) throw new Error('Cal.com booking has no uid — cannot sync');

    const existing = await Booking.findOne({ tenant_id: tenantId, external_source: 'calcom', external_id: uid });
    const reqUser = systemReqUser(tenantId);

    const attendee = calBooking.attendees?.[0] || {};
    const meetingDate = calBooking.start ? new Date(calBooking.start).toISOString().slice(0, 10) : null;
    const meetingTime = calBooking.start ? new Date(calBooking.start).toISOString().slice(11, 16) : null;
    const durationMinutes = calBooking.start && calBooking.end
      ? Math.round((new Date(calBooking.end) - new Date(calBooking.start)) / 60000)
      : 30;

    // Real Cal.com status values confirmed: accepted, pending, cancelled, rejected
    const isCancelled = calBooking.status === 'cancelled' || calBooking.status === 'rejected';

    if (existing) {
      if (isCancelled && existing.status !== BOOKING_STATUS.CANCELLED) {
        await bookingService.updateBookingStatus(tenantId, existing._id, BOOKING_STATUS.CANCELLED, reqUser);
        return;
      }
      // Real reschedule detection: the stored meeting time differs from
      // what Cal.com now reports for this same uid.
      const storedIso = `${existing.meeting_date}T${existing.meeting_time}`;
      const newIso = `${meetingDate}T${meetingTime}`;
      if (!isCancelled && meetingDate && storedIso !== newIso) {
        // rescheduleBooking creates a genuinely NEW booking document
        // (marking the old one 'Rescheduled') rather than updating in
        // place -- confirmed from its real implementation. The external
        // tracking fields must move to this new document, or any further
        // Cal.com change to this same booking would silently stop being found.
        const rescheduled = await bookingService.rescheduleBooking(tenantId, existing._id, {
          meeting_date: meetingDate,
          meeting_time: meetingTime,
          duration_minutes: durationMinutes,
        }, reqUser);
        await Booking.updateOne(
          { _id: rescheduled._id },
          { $set: { external_source: 'calcom', external_id: uid } }
        );
      }
      return;
    }

    if (isCancelled) return; // never seen before AND already cancelled -- nothing real to create

    const lead = await findOrCreateLeadForAttendee(tenantId, attendee);

    const created = await bookingService.createBooking({
      lead_id:          lead._id,
      meeting_type:     calBooking.title || 'Cal.com Booking',
      meeting_date:      meetingDate,
      meeting_time:      meetingTime,
      duration_minutes:  durationMinutes,
      meeting_link:      calBooking.meetingUrl || null,
      notes:             `Synced from Cal.com (${calBooking.eventType?.title || 'booking'})`,
    }, reqUser);

    // Stamp the real external tracking fields directly -- createBooking's
    // real contract doesn't accept them (it's also used for normal,
    // natively-created bookings), so this is a real, minimal follow-up
    // update rather than a second, parallel creation path.
    await Booking.updateOne(
      { _id: created._id },
      { $set: { external_source: 'calcom', external_id: uid } }
    );
  },
};