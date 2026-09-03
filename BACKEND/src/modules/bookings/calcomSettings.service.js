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
import { BOOKING_STATUS, MEETING_TYPE_VALUES } from './booking.constants.js';
import { Lead } from '../leads/lead/lead.model.js';
import { Booking } from './booking.model.js';
import Tenant from '../auth/models/Tenant.js';
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

  /**
   * getPublicWorkspaceInfo -- real, non-sensitive tenant identity for the
   * public booking page header (workspace name, logo, brand color) plus
   * whether Cal.com is actually connected. No API keys or any other
   * credential ever included -- only what a customer-facing page needs
   * to look like it belongs to this business rather than a generic tool.
   */
  async getPublicWorkspaceInfo(tenantId) {
    const tenant = await Tenant.findById(tenantId).select('name branding');
    if (!tenant) throw AppError.notFound('This booking page does not exist');

    const doc = await CalcomSettings.findOne({ tenantId, connected: true });

    return {
      name: tenant.name,
      logoUrl: tenant.branding?.logoUrl || null,
      primaryColor: tenant.branding?.primaryColor || '#6366f1',
      bookingAvailable: !!(doc && doc.apiKey),
    };
  },

  /**
   * getPublicProvider -- looks up a CONNECTED tenant's Cal.com credentials
   * for unauthenticated/public callers (the booking widget). Never
   * returns the key itself -- only a ready-to-use provider instance, so
   * the raw decrypted key never leaves this service.
   */
  async getPublicProvider(tenantId) {
    const doc = await CalcomSettings.findOne({ tenantId, connected: true });
    if (!doc || !doc.apiKey) return null;
    return new CalcomProvider({ apiKey: decrypt(doc.apiKey) });
  },

  /**
   * listPublicEventTypes -- real GET /v2/event-types for the public
   * booking widget. No mock/hardcoded event types -- if the tenant isn't
   * connected, this throws rather than fabricating a fallback list.
   */
  async listPublicEventTypes(tenantId) {
    const provider = await this.getPublicProvider(tenantId);
    if (!provider) throw AppError.notFound('Online booking is not available for this workspace');
    return provider.listEventTypes();
  },

  /**
   * listPublicSlots -- real GET /v2/slots for a specific event type +
   * date range, for the public booking widget's calendar picker.
   */
  async listPublicSlots(tenantId, { eventTypeId, start, end, timeZone }) {
    if (!eventTypeId || !start || !end) {
      throw AppError.badRequest('eventTypeId, start and end are required');
    }
    const provider = await this.getPublicProvider(tenantId);
    if (!provider) throw AppError.notFound('Online booking is not available for this workspace');
    return provider.getAvailableSlots({ eventTypeId, start, end, timeZone });
  },

  /**
   * createPublicBooking -- the customer-facing "book this slot" action.
   * Real POST /v2/bookings against Cal.com, THEN an immediate real sync
   * into InnovateX via the same applyCalcomBooking() the webhook uses --
   * not a separate, parallel creation path. This makes the InnovateX
   * /bookings record appear right away instead of depending entirely on
   * webhook delivery latency/availability; applyCalcomBooking's existing
   * dedup (tenant + external_source + external_id) makes it genuinely
   * safe if the real webhook for this same uid also arrives afterward --
   * that becomes a no-op/reschedule-check, never a duplicate booking.
   */
  async createPublicBooking(tenantId, { eventTypeId, start, name, email, timeZone }) {
    if (!eventTypeId || !start || !name || !email) {
      throw AppError.badRequest('eventTypeId, start, name and email are required');
    }
    const provider = await this.getPublicProvider(tenantId);
    if (!provider) throw AppError.notFound('Online booking is not available for this workspace');

    const calBooking = await provider.createBooking({
      eventTypeId,
      start,
      attendee: { name, email, timeZone },
    });

    await this.applyCalcomBooking(tenantId, calBooking).catch((err) => {
      console.warn(`[calcom public booking] immediate sync failed for tenant ${tenantId}, uid ${calBooking.uid}: ${err.message}`);
    });

    return calBooking;
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

    // Real, confirmed field-name divergence between Cal.com's two data
    // sources that both funnel into this one function: REST GET /v2/bookings
    // (used by syncBookings) returns `start`/`end`, but real Cal.com
    // WEBHOOK payloads (used by calcomWebhook.controller.js) use
    // `startTime`/`endTime` instead -- confirmed against Cal.com's own
    // documented webhook payload examples. Without normalizing both
    // shapes here, every webhook-driven call silently produced
    // null meeting_date/meeting_time and failed Booking's required-field
    // validation, while the manual Sync button (REST shape) worked fine.
    const startRaw = calBooking.start || calBooking.startTime;
    const endRaw = calBooking.end || calBooking.endTime;

    const attendee = calBooking.attendees?.[0] || {};
    const meetingDate = startRaw ? new Date(startRaw).toISOString().slice(0, 10) : null;
    const meetingTime = startRaw ? new Date(startRaw).toISOString().slice(11, 16) : null;
    const durationMinutes = startRaw && endRaw
      ? Math.round((new Date(endRaw) - new Date(startRaw)) / 60000)
      : 30;

    // Real, confirmed casing divergence between the same two sources:
    // REST /v2/bookings returns lowercase status ('accepted', 'cancelled',
    // 'pending', 'rejected'), but real webhook payloads use uppercase
    // ('ACCEPTED', 'CANCELLED', ...). Normalizing case here so a real
    // BOOKING_CANCELLED webhook is actually recognized as a cancellation
    // instead of silently falling through to the "new booking" branch below.
    const normalizedStatus = String(calBooking.status || '').toLowerCase();
    const isCancelled = normalizedStatus === 'cancelled' || normalizedStatus === 'rejected';

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

    // Real constraint: Booking.model.js's meeting_type is a closed enum
    // (Discovery Call, Proposal Review, Strategy Call, Demo, Follow Up,
    // Onboarding Call, Closing Call) used elsewhere for reporting/pipeline
    // logic -- it can't just accept arbitrary free text. Cal.com's real
    // `title` is auto-generated per booking (e.g. "15 min meeting between
    // X and Y") and will essentially never match one of those 7 fixed
    // values, which was silently failing Mongoose's enum validation on
    // every real Cal.com booking. Only use the Cal.com title as
    // meeting_type when it happens to exactly match an allowed value;
    // otherwise fall back to the same default booking.service.js already
    // uses for natively-created bookings, and preserve the real Cal.com
    // event name in notes (where it belongs, as free text) either way.
    const calcomTitle = calBooking.title || calBooking.eventType?.title || null;
    const meetingType = MEETING_TYPE_VALUES.includes(calcomTitle) ? calcomTitle : undefined;

    const created = await bookingService.createBooking({
      lead_id:          lead._id,
      meeting_type:      meetingType, // undefined -> createBooking's own 'Discovery Call' default
      meeting_date:      meetingDate,
      meeting_time:      meetingTime,
      duration_minutes:  durationMinutes,
      meeting_link:      calBooking.meetingUrl || calBooking.location || null,
      notes:             `Synced from Cal.com: "${calcomTitle || 'booking'}"`,
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