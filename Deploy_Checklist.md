# InnovateX Revenue OS — v1 (WhatsApp Workspace) Deployment Checklist

Everything below came out of a real debugging/build session. Each item exists
because it either broke something in testing, or would break silently in
production if skipped. Go through this top to bottom, in order, before
every deploy that touches the backend.

---

## 1. Environment variables

- [ ] **`CLIENT_URL`** is set to your frontend's *exact* production origin
      (e.g. `https://app.yourdomain.com`), with **no trailing spaces** in the
      `.env` file. A trailing space here silently breaks CORS for
      credentialed requests, which breaks session refresh -- every user
      gets logged out on page reload with no obvious error.
- [ ] `MONGODB_URI` points to the production Atlas cluster (not the dev one).
- [ ] `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`,
      `COOKIE_SECRET` are real production secrets, not the dev placeholders.
- [ ] `NODE_ENV=production` is set (this also switches the refresh-token
      cookie to `secure: true`, which requires the app to actually be
      served over HTTPS).
- [ ] If deploying on Windows/a network with flaky `mongodb+srv://` DNS
      resolution: the DNS-override fix (`dns.setServers(['1.1.1.1','8.8.8.8'])`)
      is in `server.js` for the main app -- if you run any one-off script
      against the DB, it needs the same fix (see `scripts/backfill-consent-sync.mjs`
      for the pattern).

## 2. Redis + the send queue (broadcasts/campaigns)

- [ ] **Redis is running and reachable** before starting the API server --
      BullMQ (the queue behind Campaign/Broadcast sending) needs it.
- [ ] **The worker process is running as its own, separate process**:
      `npm run worker`. This is easy to miss -- `npm run dev`/the API
      server does NOT process the send queue by itself. If the worker
      isn't running, "Start Broadcast"/"Start Campaign" will accept the
      request and do nothing: jobs sit in Redis, nothing ever sends.
- [ ] **`CAMPAIGN_SEND_RATE_MAX`** (messages/sec, default 20) is tuned to
      match your WhatsApp Business number's actual Meta messaging tier
      (250 / 1K / 10K / 100K unique recipients per 24h, which increases
      automatically as your number's quality rating improves). Sending
      faster than Meta's real allowed rate risks throttling or a quality
      rating hit -- this is an operational tuning step, not a one-time
      "set and forget" default.

## 3. One-time migration scripts (run once, in this order, before the new code goes live)

- [ ] `node scripts/backfill-consent-sync.mjs --dry-run` -- review the
      output (how many Consent records will be created, how many Leads
      updated).
- [ ] `node scripts/backfill-consent-sync.mjs` (no `--dry-run`) -- apply it
      for real. **Do this before deploying the new consent-guard code** --
      the guard blocks sends to any contact with no Consent record, so
      running this after deploy means real sends silently fail for a
      window.
- [ ] `node scripts/dedupe-consent-numbers.mjs --dry-run`, then without
      `--dry-run` -- merges any duplicate Consent records for the same
      phone number in different formats (e.g. `8660898992` vs
      `918660898992`).
- [ ] Both scripts are safe to re-run (idempotent) if you're ever unsure
      whether they already ran.

## 4. Boot-time sanity check (watch the server logs on first startup)

Confirm these lines appear when the API server starts:
- [ ] `[nurture scheduler] started` (only relevant once Nurture is
      re-enabled in the UI for a future plan/version -- the scheduler
      itself runs regardless of whether the tab is visible)
- [ ] `[consent reconciliation] started`
- [ ] No `⚠️ CLIENT_URL is not set` warning
- [ ] MongoDB connects successfully (no `querySrv ECONNREFUSED` loop)

## 5. v1 scope notes (intentional, not bugs)

- [ ] Nurture Messages tab is hidden from the WhatsApp Workspace sidebar
      for v1 (see `WhatsAppPanel.tsx`'s `TABS` array) -- the backend
      feature is fully intact underneath (scheduler, Automation Rules'
      Start/Stop Nurture actions, Booking/Lead auto-enroll all still
      work); only the tab is hidden.
- [ ] The following Automation Rules triggers are NOT yet wired to a real
      event and will never fire if selected: Booking confirmed, Payment
      pending, No reply, Contact created, Contact updated, Custom event.
- [ ] `CREATE_TASK` action is simulated (no Task feature exists in the
      product yet).

## 6. Post-deploy smoke test

- [ ] Log in, refresh the page -- confirm the session survives (this is
      the CLIENT_URL/CORS check, done live).
- [ ] Send a manual WhatsApp message from the Inbox to a real test number.
- [ ] Text "STOP" from that test number -- confirm its Consent status
      flips to Opted Out automatically (Opt-Out/Consent tab), and that a
      Campaign/Broadcast to that number is now blocked.
- [ ] Create one Automation Rule (e.g. Lead created → Add tag) and create
      a new lead -- confirm the tag appears and the rule's "Ran Nx" count
      increments.
- [ ] Start one real Broadcast with a tiny test audience (1-2 contacts)
      and confirm delivery, with the worker process running.