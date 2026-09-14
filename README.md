# Complete Changes — Nurture + Attribution + Google Ads + Meta Ads + UTM + Currency

Everything built/fixed across the full arc, starting from the Nurture
condition-builder request through the final currency-conversion audit.
Folder structure matches your project exactly — copy each file to the
same relative path in your project (create new ones, overwrite existing
ones).

## Deploy checklist (do these too, not just copy files)

1. **Every existing Campaign's `utm_tracking_link` needs regenerating** — old links point at `/capture?...` (no tenant ID) and are permanently broken. Re-save/re-create each real Campaign.
2. **Existing Google/Meta Ads campaigns synced before this update won't have a `currency` field** — resync them once (click Sync in Integrations) so ROAS can be computed for them; until then they're safely excluded from totals, not silently wrong.
3. No new environment variables required. Frankfurter (currency API) needs no key. 

---

## Backend (32 files)

### Nurture — condition-based automatic enrollment
| File | Status |
|---|---|
| `BACKEND/src/shared/services/conditionEngine.js` | **NEW** — shared condition-matching engine (extracted from Automation Rules) |
| `BACKEND/src/modules/whatsapp/submodules/automationRules/automationRules.service.js` | MODIFIED — now imports the shared engine, zero behavior change |
| `BACKEND/src/modules/whatsapp/submodules/nurtures/nurtures.constants.js` | MODIFIED — real curated Lead condition fields, incl. `ad_group_id`/`ad_id` |
| `BACKEND/src/modules/whatsapp/submodules/nurtures/nurtures.model.js` | MODIFIED — real `conditions[]` + `conditionLogic` on sequences |
| `BACKEND/src/modules/whatsapp/submodules/nurtures/nurtures.service.js` | MODIFIED — `enrollMatchingLeads()`, auto-runs on activation |
| `BACKEND/src/modules/whatsapp/submodules/nurtures/nurtures.validator.js` | MODIFIED — validates new condition fields |
| `BACKEND/src/modules/whatsapp/submodules/nurtures/nurtures.controller.js` | MODIFIED — new `enrollMatching` handler |
| `BACKEND/src/modules/whatsapp/submodules/nurtures/nurtures.routes.js` | MODIFIED — new `/enroll-matching` route |
| `BACKEND/src/modules/leads/lead/lead.service.js` | MODIFIED — LEAD_CREATED auto-enroll now evaluates real conditions; also has the atomic race-condition-safe `atomicClaimFilter` option (see Lead/Capture below) |

### Lead / Public Capture Pipeline
| File | Status |
|---|---|
| `BACKEND/src/modules/leads/lead/lead.model.js` | MODIFIED — added `ad_group_id`, `ad_id`, `click_id` fields |
| `BACKEND/src/modules/leads/lead/lead.repository.js` | MODIFIED — new `findOneAndUpsert` (real atomic race-condition fix) |
| `BACKEND/src/modules/leads/capture/publicCapture.service.js` | **NEW** — real, tenant-scoped, unauthenticated lead capture; real Google-ID→campaign-name auto-resolution |
| `BACKEND/src/modules/leads/capture/publicCapture.controller.js` | **NEW** |
| `BACKEND/src/modules/leads/capture/publicCapture.validator.js` | **NEW** |
| `BACKEND/src/modules/leads/capture/publicCapture.routes.js` | **NEW** |

### Shared infrastructure
| File | Status |
|---|---|
| `BACKEND/src/shared/services/exchangeRate.service.js` | **NEW** — real currency conversion via Frankfurter (free, no API key) |
| `BACKEND/src/shared/middlewares/rateLimit.middleware.js` | MODIFIED — new tenant-scoped `publicCaptureRateLimit` (IPv6-safe) |
| `BACKEND/src/app.js` | MODIFIED — mounts the new public capture route |

### Campaigns — automatic ad-platform tracking setup
| File | Status |
|---|---|
| `BACKEND/src/modules/campaigns/campaign.service.js` | MODIFIED — tenant-scoped tracking links; new `getAdPlatformTrackingSetup` (real Google ValueTrack / Meta dynamic macros) |
| `BACKEND/src/modules/campaigns/campaign.controller.js` | MODIFIED — new endpoint handler |
| `BACKEND/src/modules/campaigns/campaign.routes.js` | MODIFIED — new route |

### Attribution / Google Ads / Meta Ads
| File | Status |
|---|---|
| `BACKEND/src/modules/attribution/attribution.repository.js` | MODIFIED — new `getRevenueByCampaign` (real ROAS-matching fix) |
| `BACKEND/src/modules/attribution/attribution.service.js` | MODIFIED — real currency conversion, campaign-name ROAS matching, dedup guard, mixed-currency total fix |
| `BACKEND/src/modules/attribution/attribution.constants.js` | MODIFIED — shared `DEFAULT_AD_SYNC_DATE_RANGE` |
| `BACKEND/src/modules/attribution/googleAdsCampaignMetric.model.js` | MODIFIED — added `currency` field |
| `BACKEND/src/modules/attribution/metaAdsCampaignMetric.model.js` | MODIFIED — added `currency` field |
| `BACKEND/src/modules/attribution/googleAdsAdGroupMetric.model.js` | **NEW** — real ad-group-level sync storage |
| `BACKEND/src/modules/attribution/metaAdsAdSetMetric.model.js` | **NEW** — real ad-set-level sync storage |
| `BACKEND/src/modules/attribution/providers/googleAds.provider.js` | MODIFIED — real currency capture + `getAdGroupPerformance` |
| `BACKEND/src/modules/attribution/providers/metaAds.provider.js` | MODIFIED — real currency capture + `getAdSetPerformance` |
| `BACKEND/src/modules/attribution/googleAdsSettings.service.js` | MODIFIED — syncs ad-group data too |
| `BACKEND/src/modules/attribution/metaAdsSettings.service.js` | MODIFIED — syncs ad-set data too |

---

## Frontend (10 files)

| File | Status |
|---|---|
| `FRONTEND/src/App.tsx` | MODIFIED — route: `/capture` → `/capture/:tenantId` |
| `FRONTEND/src/pages/Auth/CaptureForm.tsx` | MODIFIED — real backend (not localStorage), reads `ad_group_id`/`ad_id`/`click_id` |
| `FRONTEND/src/lib/publicCaptureApi.ts` | **NEW** |
| `FRONTEND/src/pages/Attribution/Attribution.tsx` | MODIFIED — currency display, ROAS-unavailable badge, excluded-from-total banner |
| `FRONTEND/src/types/attribution.ts` | MODIFIED — new currency/conversion fields |
| `FRONTEND/src/types/nurture.ts` | MODIFIED — real condition types + curated field list |
| `FRONTEND/src/lib/nurtureApi.ts` | MODIFIED — `enrollMatching` API call |
| `FRONTEND/src/pages/Nurture/Nurture.tsx` | MODIFIED — real multi-condition builder UI |
| `FRONTEND/src/lib/campaignsApi.ts` | MODIFIED — `getAdPlatformTrackingSetup` |
| `FRONTEND/src/pages/Campaigns/Campaigns.tsx` | MODIFIED — one-time ad-platform tracking setup UI |

---

## What each major feature does (quick reference)

1. **Nurture**: sequences can now target multiple leads automatically via real conditions (source, UTM fields, ad IDs, tags, etc.) instead of manual one-by-one enrollment. Existing leads can be bulk-enrolled; new leads auto-enroll on creation.
2. **Public Capture Form**: fixed from a broken localStorage-only mock to a real, tenant-scoped, race-condition-safe backend endpoint.
3. **Automatic UTM attribution**: Google Ads ValueTrack parameters + Meta's dynamic URL macros are set ONCE per platform (not per-ad) and automatically carry real campaign/ad-group/ad IDs into every lead — no manual link-crafting per ad.
4. **Attribution/ROAS**: matches by real campaign name (not generic source) for a real chance of matching; genuinely converts ad spend into the tenant's workspace currency via a real, free exchange-rate API, never silently guessing or double-converting.
5. **Google Ads / Meta Ads**: now sync ad-group/ad-set-level data in addition to campaign-level.

## Full list of bugs found and fixed across every audit pass (for your own record)

- LEAD_CREATED nurture auto-enroll had no condition matching (enrolled into every sequence unconditionally)
- Public Capture Form was 100% disconnected from the real backend (localStorage mock)
- Tracking links had no tenant ID (permanently broken multi-tenant)
- ROAS matched against generic `source`, not real campaign name (essentially never matched in practice)
- Ad-account currency was never captured, risking silent ~83x-wrong ROAS on currency mismatch
- Race condition could create duplicate leads on double-submit
- A `rawResult:true` fix returned a plain object instead of a Mongoose document
- A fragile `isNew` heuristic depended on unverified Mongoose internals
- My own rate-limiter fix would have crashed the server at boot (`ERR_ERL_KEY_GEN_IPV6`)
- Latent double-counting in ad spend totals (no dateRange filter)
- **Currency-unknown campaigns silently computed ROAS as if already in workspace currency** (boolean logic gap)
- **Mixed-currency totals** summed unconverted + converted spend together
- Redundant/racy duplicate DB calls resolving the same campaign ID twice

## What still requires a real production test (cannot be verified without live network access)

See the step-by-step test script (real Google ad + real Meta ad + real lead + real Nurture sequence) from the prior audit message — regenerate it on request if you no longer have it.
