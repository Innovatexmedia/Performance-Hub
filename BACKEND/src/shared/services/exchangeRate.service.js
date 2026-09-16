/**
 * =============================================================================
 * InnovateX Revenue OS — Exchange Rate Service
 * =============================================================================
 *
 * FILE: src/shared/services/exchangeRate.service.js
 *
 * PURPOSE
 * ───────
 * Real currency conversion for the Attribution dashboard: a Google/Meta
 * ad account's spend is denominated in whatever currency THAT ad
 * account bills in (confirmed real, captured at sync time -- see
 * googleAdsCampaignMetric.model.js / metaAdsCampaignMetric.model.js),
 * which is genuinely NOT guaranteed to match the tenant's own workspace
 * reporting currency (Tenant.currency). Real conversion, not withholding,
 * is what lets ROAS/spend actually display correctly in the tenant's
 * chosen currency.
 *
 * SOURCE: Frankfurter (api.frankfurter.dev) -- confirmed via its own
 * real documentation: free, open-source, no API key required, no call
 * quotas, sourced from 98 real central banks (ECB and others), covering
 * 205 currencies, explicitly positioned for "SaaS billing... accounting
 * systems" (their own stated use case, not general trading). This
 * app's only 4 supported workspace currencies (USD/INR/EUR/GBP -- see
 * payment.constants.js's PAYMENT_CURRENCY enum) are all real, standard,
 * major currencies well within Frankfurter's coverage.
 *
 * CACHING: ECB-sourced rates update once per business day -- fetching
 * fresh on every dashboard load would be wasteful and slower for no
 * real accuracy gain. Cached in-memory per (base, quote) pair for 6
 * hours, real enough for daily-reporting use (their own stated FAQ:
 * "not for live trading") without re-fetching constantly.
 *
 * NO DOUBLE CONVERSION: this service is ALWAYS called with the raw,
 * never-mutated, originally-synced spend value (GoogleAdsCampaignMetric.
 * spend / MetaAdsCampaignMetric.spend, stored exactly as Google/Meta
 * reported it, in that ad account's own currency) -- conversion happens
 * fresh at READ time on every dashboard load, never persisted back onto
 * the stored document. There is nothing to accidentally convert twice.
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const rateCache = new Map(); // key: "FROM:TO" -> { rate, fetchedAt }

/**
 * getExchangeRate -- real rate to multiply a FROM-currency amount by to
 * get a TO-currency amount. Returns `null` (never a fabricated/guessed
 * number) if the pair can't be resolved right now -- callers must treat
 * null as "cannot convert" and fall back to withholding the
 * currency-dependent figure, not assume a rate of 1.
 */
export async function getExchangeRate(fromCurrency, toCurrency) {
  if (!fromCurrency || !toCurrency) return null;

  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();

  // Same currency -- real, trivial, no API call needed or made.
  if (from === to) return 1;

  const cacheKey = `${from}:${to}`;
  const cached = rateCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.rate;
  }

  let response;
  try {
    response = await fetch(`https://api.frankfurter.dev/v2/rate/${from}/${to}`);
  } catch (networkError) {
    console.warn(`[exchange-rate] Could not reach Frankfurter for ${from}->${to}: ${networkError.message}`);
    // Real, honest fallback: serve a STALE cached rate rather than
    // nothing at all, if one exists -- a same-day-old real rate is far
    // more useful for daily reporting than abruptly withholding ROAS
    // just because the FX API had a momentary blip. Still returns null
    // (forcing the caller to withhold) if there's truly nothing cached yet.
    return cached ? cached.rate : null;
  }

  if (!response.ok) {
    console.warn(`[exchange-rate] Frankfurter rejected ${from}->${to}: HTTP ${response.status}`);
    return cached ? cached.rate : null;
  }

  const data = await response.json().catch(() => null);
  const rate = data?.rate;
  if (typeof rate !== 'number' || !Number.isFinite(rate)) {
    console.warn(`[exchange-rate] Frankfurter returned no usable rate for ${from}->${to}`);
    return cached ? cached.rate : null;
  }

  rateCache.set(cacheKey, { rate, fetchedAt: Date.now() });
  return rate;
}

/**
 * getExchangeRates -- batched real lookup for multiple FROM currencies
 * converting to the SAME target currency, deduplicating identical pairs
 * so N campaigns sharing the same ad-account currency only trigger ONE
 * real Frankfurter call for that pair, not N.
 *
 * @param {string[]} fromCurrencies
 * @param {string} toCurrency
 * @returns {Promise<Map<string, number|null>>} keyed by uppercase FROM currency
 */
export async function getExchangeRates(fromCurrencies, toCurrency) {
  const uniqueFroms = [...new Set(fromCurrencies.filter(Boolean).map((c) => c.toUpperCase()))];
  const results = await Promise.all(uniqueFroms.map((from) => getExchangeRate(from, toCurrency)));
  return new Map(uniqueFroms.map((from, i) => [from, results[i]]));
}

/**
 * convertAndSumByCurrency -- real, shared "take a real per-currency
 * revenue breakdown and turn it into ONE genuinely correct total in the
 * target currency" helper.
 *
 * WHY THIS EXISTS: multiple independent revenue aggregations in this
 * app (Attributed Revenue KPI, Revenue by Source chart, ROAS matching)
 * were each summing TrackingEvent.revenue directly, with no awareness
 * that a tenant's own historical payments can genuinely be recorded in
 * DIFFERENT currencies (Payment.currency reflects whatever the
 * workspace currency setting was AT THE TIME each payment happened --
 * see payment.service.js -- not automatically updated when a tenant
 * later changes that setting in Settings). Summing $5,000 and ₹500,000
 * together as a single number is not just imprecise, it's meaningless.
 * This is the ONE real place that conversion logic now lives, reused by
 * every revenue aggregation instead of four independent, easy-to-miss
 * copies of the same fix.
 *
 * @param {{currency: string|null, revenue: number}[]} byCurrency
 * @param {string} targetCurrency
 * @returns {Promise<{total: number, unconverted: number, hasUnconverted: boolean}>}
 *   `total` -- the real, safely-converted sum in targetCurrency.
 *   `unconverted` -- revenue that could NOT be converted (a real rate
 *      lookup failure -- see getExchangeRate) and is EXCLUDED from
 *      `total`, exactly the same "never silently guess" treatment
 *      already applied to ad spend's currencyMismatch handling.
 *   `hasUnconverted` -- true if any real revenue had to be excluded.
 */
export async function convertAndSumByCurrency(byCurrency, targetCurrency) {
  if (!Array.isArray(byCurrency) || byCurrency.length === 0) {
    return { total: 0, unconverted: 0, hasUnconverted: false };
  }

  // Real, legacy-data-safe assumption: a row with no recorded currency
  // at all (created before the `currency` field existed on
  // TrackingEvent -- see that model's own comment) is treated as
  // already being in the CURRENT target currency, so historical revenue
  // doesn't silently vanish from totals the moment this fix deploys.
  // This is a best-effort assumption for genuinely un-tagged legacy
  // data, not a guess applied to any row that DOES have a real,
  // known-different currency recorded.
  const distinctCurrencies = byCurrency
    .map((r) => r.currency || targetCurrency)
    .filter((c) => c !== targetCurrency);
  const rates = await getExchangeRates(distinctCurrencies, targetCurrency);

  let total = 0;
  let unconverted = 0;
  for (const row of byCurrency) {
    const rowCurrency = row.currency || targetCurrency;
    if (rowCurrency === targetCurrency) {
      total += row.revenue;
      continue;
    }
    const rate = rates.get(rowCurrency.toUpperCase());
    if (rate == null) {
      unconverted += row.revenue;
      continue;
    }
    total += row.revenue * rate;
  }

  return {
    total: Number(total.toFixed(2)),
    unconverted: Number(unconverted.toFixed(2)),
    hasUnconverted: unconverted > 0,
  };
}
