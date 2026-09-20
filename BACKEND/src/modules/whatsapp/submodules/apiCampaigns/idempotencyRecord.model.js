/**
 * IdempotencyRecord — makes a retried API trigger safe.
 *
 * WHY THE QUEUE'S GUARD ISN'T ENOUGH
 * ──────────────────────────────────
 * enqueueCampaignSend already builds a deterministic BullMQ jobId, which stops
 * the same lead being sent twice within ONE run. It cannot help across calls:
 * a client whose connection drops after we enqueued but before our response
 * arrived will retry, and that retry is a brand-new run with brand-new job ids.
 * The customer's contacts get the message twice — the single worst failure mode
 * for a messaging API, since it costs the customer money and annoys their
 * customers.
 *
 * HOW IT WORKS
 * ────────────
 * The caller sends `Idempotency-Key: <their own unique string>`. The unique
 * index on (tenantId, key) means the FIRST request to insert wins; a duplicate
 * insert throws E11000, and the service replays the stored response instead of
 * starting a second run.
 *
 * The record is inserted BEFORE any work is done, precisely so a crash halfway
 * through leaves a claimed key rather than an unclaimed one. `response` is
 * filled in once the run is created; a retry arriving in that gap gets a 409
 * telling it to retry shortly, which is correct — we genuinely don't know yet
 * whether the first attempt succeeded.
 *
 * Records expire after 24h via a TTL index, the same window Stripe uses. Long
 * enough to cover any sane retry policy, short enough that this collection
 * never grows without bound.
 */

import mongoose from 'mongoose';
const { Schema } = mongoose;

const idempotencyRecordSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    key:      { type: String, required: true },

    /** Endpoint the key was used against. A key reused on a different endpoint
     *  is a client bug worth reporting rather than silently replaying an
     *  unrelated response. */
    scope: { type: String, required: true },

    /** SHA-256 of the request body. Lets us detect a client reusing one key
     *  for two genuinely different requests — replaying the first response
     *  there would silently drop the second send. */
    requestHash: { type: String, required: true },

    /** The response to replay. Null while the first request is still in
     *  flight. */
    response: { type: Schema.Types.Mixed, default: null },

    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, versionKey: false }
);

// The guard itself. Everything above depends on this being unique.
idempotencyRecordSchema.index({ tenantId: 1, key: 1 }, { unique: true });

// Mongo removes expired records on its own; no cleanup job to maintain.
idempotencyRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const IdempotencyRecord = mongoose.model('IdempotencyRecord', idempotencyRecordSchema);
export default IdempotencyRecord;