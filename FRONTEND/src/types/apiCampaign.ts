/**
 * API Campaigns — frontend types.
 *
 * SOURCE (verified against the real backend files, not assumed):
 *   BACKEND/src/modules/whatsapp/submodules/apiCampaigns/{campaignRun.model.js, apiCampaign.service.js}
 *   BACKEND/src/modules/apiKeys/apiKey.model.js
 *
 * An "API campaign" is NOT a separate entity. It is an ordinary
 * WhatsAppCampaign with type: 'API' — same model, same collection, same
 * lifecycle. What differs is how it is triggered and that each trigger
 * produces a CampaignRun.
 */

/** Mirrors RUN_STATUS in campaignRun.model.js. */
export type CampaignRunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';

/** Mirrors RUN_SOURCE. */
export type CampaignRunSource = 'API' | 'DASHBOARD';

export interface RejectedRecipient {
  phone: string;
  reason: string;
  code: string;
}

export interface CampaignRun {
  id: string;
  campaignId: string;
  source: CampaignRunSource;
  status: CampaignRunStatus;
  /** Which key fired it — the visible half only; the secret is never stored. */
  apiKeyPrefix: string;
  idempotencyKey: string | null;

  /** What the caller sent. */
  requestedCount: number;
  /** What passed validation and reached the queue. */
  queuedCount: number;
  /** Dropped before queueing — see rejectedRecipients for why. */
  rejectedCount: number;

  /** Filled in by the worker as the run drains. */
  sentCount: number;
  failedCount: number;
  skippedCount: number;

  rejectedRecipients: RejectedRecipient[];
  failureReason: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface CampaignRunListResult {
  runs: CampaignRun[];
  total: number;
  page: number;
  limit: number;
}

// ── API keys ────────────────────────────────────────────────────────────────

export type ApiKeyScope = 'campaigns:send';

export interface ApiKey {
  id: string;
  name: string;
  /** First 12 chars of the key, e.g. "ixk_live_a1b". The rest is hashed and
   *  unrecoverable — this is what the UI shows in the list. */
  prefix: string;
  scopes: ApiKeyScope[];
  createdBy: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  isActive: boolean;
  createdAt: string;
}

/**
 * The create response. `key` is the full plaintext and is returned exactly
 * once, by design — there is no endpoint that can return it again, so the UI
 * must make copying it feel final.
 */
export interface CreatedApiKey {
  apiKey: ApiKey;
  key: string;
}

/**
 * runProgress — how far along a run is, 0–1.
 *
 * Denominator is queuedCount, not requestedCount: rejected recipients never
 * entered the queue, so counting them would leave a completed run stuck short
 * of 100% with nothing left to process.
 */
export function runProgress(run: CampaignRun): number {
  if (run.queuedCount <= 0) return 1;
  const processed = run.sentCount + run.failedCount + run.skippedCount;
  return Math.min(processed / run.queuedCount, 1);
}