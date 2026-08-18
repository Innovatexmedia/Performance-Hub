Super Admin
├── Tenants
├── All Users
├── Integration Health
├── Global Activity Log
└── Global Templates


new

Tenants
All Users
Plans       ← NEW
Integration Health
Global Activity
Global Templates





P2 — Payments & calendar: Stripe/Razorpay links + webhooks




Razorpay Client
        ↓
Razorpay Plan
        ↓
Razorpay Subscription
        ↓
Checkout
        ↓
Payment verification
        ↓
Webhook
        ↓
Account
        ↓
Tenant entitlement sync



I'd update the roadmap to:
P2 — SaaS Subscription Billing
✅ Razorpay subscription checkout
✅ Payment signature verification
🟡 Webhook lifecycle handling
🟡 Cancellation / plan-change lifecycle
🔭 Billing event idempotency
🔭 Billing history / invoices






7. 🔴 There is still one real implementation bug according to your own architecture

This is the most important thing I found in the latest code.

Your architecture says:

Account = billing source of truth
Tenant = denormalized entitlement copy

But syncTenantsFromAccount() copies:

plan
planId
planTrack
maxUsers
maxLeads
maxCampaigns
maxWorkspaces

It does not copy subscriptionStatus.

Meanwhile Tenant.isAccessible() checks:

tenant.subscriptionStatus

not Account.

So you currently have:

Account
subscriptionStatus = inactive
        │
        │ sync
        ▼
Tenant
subscriptionStatus = active   ❌

This contradicts your own Account-level billing architecture.

Fix

Add:

subscriptionStatus: account.subscriptionStatus,

to the tenant synchronization.

Also consider synchronizing:

subscriptionStartDate
trialEndsAt

if those are still required by tenant-facing access logic.

This is more important than the documentation mismatch.